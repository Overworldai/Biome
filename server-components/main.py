"""
Entry point and lifecycle for the Biome server.

Owns the process boundary: light-only startup imports, env setup,
parent-process watchdog, FastAPI lifespan, the `app` instance +
middleware, and the uvicorn boot. The heavy GPU stack is deferred to
first WS connect via `ServerStartup.ensure_engines_loaded`. Endpoint
definitions live in `server/routes.py`.
"""

# pyright: reportMissingTypeStubs=none

import argparse
import asyncio
import os
import sys
from contextlib import asynccontextmanager
from dataclasses import dataclass

import structlog

import util.server_logging  # noqa: F401  # pyright: ignore[reportUnusedImport]  -- side-effect: install TeeStream + crash hooks before any logging happens
from util.hf_token import apply_resolved_token

logger = structlog.stdlib.get_logger(__name__)

logger.info("Python", version=sys.version)
logger.info("Starting server...")

apply_resolved_token()

logger.info("Basic imports done")


@dataclass(frozen=True)
class StartupConfig:
    """Process-launch configuration set in `__main__` and read by the
    lifespan. Lives on `app.state.startup_config` so it's available
    before the lifespan body itself runs."""

    parent_pid: int | None = None
    # True when the launching Biome instance is in standalone mode and
    # owns this process's lifecycle — set via `--launched-from-standalone`
    # so the renderer can refuse to point itself at a server it would
    # itself shut down on the next mode switch. False for any operator
    # who launched the server by hand for use as a remote backend.
    launched_from_standalone: bool = False


# If launched with --parent-pid, poll the parent PID and exit if it dies.
# Linux's prctl(PR_SET_PDEATHSIG) is the kernel-level fallback we'd ideally
# use, but Python doesn't expose it portably; the polling watchdog covers
# both Linux and Windows.


class ParentWatchdog:
    """Monitors a parent process and force-exits this process if the
    parent dies. Constructed in `__main__` (one-shot startup check),
    then run as an asyncio task by the lifespan (continuous polling)."""

    def __init__(self, parent_pid: int) -> None:
        self.parent_pid = parent_pid

    def check_alive_or_exit(self) -> None:
        """Synchronous one-shot check at startup, in case the parent
        is already gone by the time we get here."""
        try:
            os.kill(self.parent_pid, 0)
        except OSError:
            logger.error("Parent process is already gone, shutting down", parent_pid=self.parent_pid)  # noqa: TRY400  -- OSError is a "parent gone" signal, not a real exception; traceback is noise
            os._exit(1)

    async def run(self) -> None:
        """Continuous polling. Run as an asyncio task from the lifespan."""
        while True:
            await asyncio.sleep(2)
            try:
                os.kill(self.parent_pid, 0)  # signal 0 = existence check
            except OSError:
                logger.error("Parent process is gone, shutting down", parent_pid=self.parent_pid)  # noqa: TRY400  -- OSError is a "parent gone" signal, not a real exception; traceback is noise
                os._exit(1)


# ============================================================================
# Light import waterfall.
#
# Only imports needed to serve the info-only endpoints (`/health`,
# `/api/model-info`, `/api/system-info`) and to bootstrap uvicorn live
# here. The heavy GPU stack (world_engine, transformers, diffusers,
# llama_cpp, torchvision, …) is deferred to first WS connect via
# `ServerStartup.ensure_engines_loaded`, so the server can answer
# metadata requests within seconds of launch even on cold cache.
# ============================================================================

try:
    logger.info("Importing torch...")
    import torch

    logger.info("torch imported", version=torch.__version__)

    # Importing `devices` configures the torch allocator before any device
    # context is initialised. All other device-specific call sites go
    # through it too.
    from engine import devices

    logger.info("Device check", available=devices.is_available())

    from util.system_info import SystemMonitor

    logger.info("Importing FastAPI...")
    import uvicorn
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    logger.info("FastAPI imported")

except Exception:
    logger.exception("Import failed")
    sys.exit(1)


# Endpoints register onto an APIRouter in `server/routes.py`; importing it
# is safe because the route module no longer transitively pulls the heavy
# engine stack — handlers/workers defer their `world_engine` /
# `engine.manager` imports to call-time.

from server.caches import TtlCache  # noqa: E402
from server.routes import ModelSize, router  # noqa: E402
from server.startup import ServerStartup  # noqa: E402

# Cached HuggingFace metadata is stable for minutes at a time — the
# Waypoint collection and per-model file lists rarely change between
# settings-panel renders. 5 min is short enough that a freshly-uploaded
# model shows up the next time the user opens the picker, long enough
# that opening + closing settings repeatedly doesn't produce a burst of
# upstream HF traffic.
HF_METADATA_TTL_SECONDS = 5 * 60

# ============================================================================
# Application lifecycle
# ============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle handler."""
    logger.info("Biome server startup")

    startup = ServerStartup()
    app.state.startup = startup
    app.state.system_monitor = SystemMonitor.collect()
    app.state.model_size_cache = TtlCache[str, ModelSize](ttl_seconds=HF_METADATA_TTL_SECONDS)
    app.state.waypoint_models_cache = TtlCache[str, list[str]](ttl_seconds=HF_METADATA_TTL_SECONDS)
    # Single-session gate. The WS endpoint claims this slot on accept and
    # clears it on teardown; concurrent handshakes from a second client
    # are rejected with `MessageId.SERVER_BUSY`. The shared `WorldEngine`
    # is fundamentally single-tenant — its rolling frame history, seed
    # slot, and progress callback are process-wide singletons — and
    # serialising two clients through it would just produce incoherent
    # output. Reconnection (same client returning after disconnect) works
    # fine because each session clears its slot on teardown.
    app.state.active_session = None

    cfg: StartupConfig = app.state.startup_config
    watchdog_task = None
    if cfg.parent_pid is not None:
        watchdog_task = asyncio.create_task(ParentWatchdog(cfg.parent_pid).run())

    yield

    if watchdog_task is not None:
        watchdog_task.cancel()

    logger.info("Shutting down")


app = FastAPI(title="Biome Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Biome Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=7987, help="Port to bind to")
    parser.add_argument(
        "--parent-pid", type=int, default=None, help="PID of parent process; server exits if parent dies"
    )
    parser.add_argument(
        "--launched-from-standalone",
        action="store_true",
        help=(
            "Marks this server as managed by a standalone-mode Biome instance. The renderer reads it from /health"
            " to refuse server-mode URLs that would tear themselves down on the next mode switch."
        ),
    )
    args = parser.parse_args()

    app.state.startup_config = StartupConfig(
        parent_pid=args.parent_pid,
        launched_from_standalone=args.launched_from_standalone,
    )
    if args.parent_pid is not None:
        logger.info("Monitoring parent process", parent_pid=args.parent_pid)
        ParentWatchdog(args.parent_pid).check_alive_or_exit()

    try:
        uvicorn.run(
            app,
            host=args.host,
            port=args.port,
            ws_ping_interval=300,
            ws_ping_timeout=300,
            log_config=None,
        )
    except BaseException:
        logger.exception("Fatal exception at server entrypoint")
        raise
