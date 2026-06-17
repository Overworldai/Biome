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

import psutil
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


# If launched with --parent-pid, poll the parent and exit if it dies.
# Linux's prctl(PR_SET_PDEATHSIG) is the kernel-level fallback we'd ideally
# use, but Python doesn't expose it portably; the polling watchdog covers
# both Linux and Windows. A bare `os.kill(pid, 0)` check is unreliable in
# the face of PID recycling — the kernel reuses PIDs aggressively and the
# new occupant can be a different process — so the watchdog also pins the
# parent's psutil `create_time()`, captured as a baseline at startup, and
# treats a changed creation timestamp as "parent gone".


# Tolerance for the PID-recycling guard. The baseline and every poll both
# read the parent's creation time from the same source (psutil), and a
# process's create_time is immutable for its lifetime, so a live parent
# compares exactly equal — this tolerance only absorbs float round-trip
# noise. A recycled PID belongs to a process created seconds-to-hours
# later, so it lands far outside this window.
_PARENT_START_TIME_TOLERANCE_SEC = 1.0


class ParentWatchdog:
    """Monitors a parent process and force-exits this process if the
    parent dies. Constructed in `__main__` (one-shot startup check),
    then run as an asyncio task by the lifespan (continuous polling).

    The recycling guard compares the parent's *current* kernel
    creation timestamp against a baseline captured here via psutil at
    construction."""

    def __init__(self, parent_pid: int) -> None:
        self.parent_pid = parent_pid
        # Baseline from the kernel, captured now. None if the parent is
        # already gone or its metadata isn't readable (→ pid-only liveness).
        self.baseline_create_time = self._read_create_time()

    def _read_create_time(self) -> float | None:
        try:
            return psutil.Process(self.parent_pid).create_time()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return None

    def _parent_alive(self) -> bool:
        """True if a process with the parent's PID exists and its
        creation timestamp still matches the baseline (guards against
        PID recycling)."""
        try:
            current = psutil.Process(self.parent_pid).create_time()
        except psutil.NoSuchProcess:
            return False
        except psutil.AccessDenied:
            # Process exists but we can't read its metadata. Treat as alive
            # rather than self-exit on a transient permission glitch.
            return True
        if self.baseline_create_time is None:
            # No baseline (parent was gone/unreadable at construction but
            # the PID resolves now) → fall back to pid-only liveness.
            return True
        return abs(current - self.baseline_create_time) <= _PARENT_START_TIME_TOLERANCE_SEC

    def check_alive_or_exit(self) -> None:
        """Synchronous one-shot check at startup, in case the parent
        is already gone by the time we get here."""
        if not self._parent_alive():
            logger.error("Parent process is already gone, shutting down", parent_pid=self.parent_pid)
            os._exit(1)

    async def run(self) -> None:
        """Continuous polling. Run as an asyncio task from the lifespan."""
        while True:
            await asyncio.sleep(2)
            if not self._parent_alive():
                logger.error("Parent process is gone, shutting down", parent_pid=self.parent_pid)
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
from server.routes import ModelInfoResponse, ModelSize, router  # noqa: E402
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
    app.state.model_type_cache = TtlCache[str, str](ttl_seconds=HF_METADATA_TTL_SECONDS)
    app.state.model_info_cache = TtlCache[str, ModelInfoResponse](ttl_seconds=HF_METADATA_TTL_SECONDS)
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
        # The watchdog self-reads the parent's create_time as its recycling baseline.
        watchdog = ParentWatchdog(args.parent_pid)
        logger.info(
            "Monitoring parent process",
            parent_pid=args.parent_pid,
            parent_create_time=watchdog.baseline_create_time,
        )
        watchdog.check_alive_or_exit()

    # Construct the uvicorn Server explicitly (rather than via `uvicorn.run`)
    # so the `/shutdown` route can flip `should_exit` on the live instance,
    # giving the lifespan teardown a chance to run before the launcher
    # falls back to SIGKILL.
    config = uvicorn.Config(
        app,
        host=args.host,
        port=args.port,
        ws_ping_interval=300,
        ws_ping_timeout=300,
        log_config=None,
    )
    server = uvicorn.Server(config)
    app.state.uvicorn_server = server

    try:
        server.run()
    except BaseException:
        logger.exception("Fatal exception at server entrypoint")
        raise
