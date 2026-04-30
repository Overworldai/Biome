"""
Entry point and lifecycle for the Biome server.

Owns the process boundary: instrumented heavy-import waterfall, env
setup, parent-process watchdog, FastAPI lifespan + heavy init task,
the FastAPI `app` instance + middleware, and the uvicorn boot. Endpoint
definitions live in `server/routes.py`.
"""

import sys

from util.server_logging import logger

logger.info(f"Python {sys.version}")
logger.info("Starting server...")

import asyncio
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass

from server.protocol import StageId
from util.hf_token import apply_resolved_token

apply_resolved_token()

# Reduce CUDA allocator fragmentation during repeated model loads/switches.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

logger.info("Basic imports done")


@dataclass(frozen=True)
class StartupConfig:
    """Process-launch configuration set in `__main__` and read by the
    lifespan. Lives on `app.state.startup_config` so it's available
    before the lifespan body itself runs."""

    parent_pid: int | None = None


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
            logger.error(f"Parent process (PID {self.parent_pid}) is already gone, shutting down")
            os._exit(1)

    async def run(self) -> None:
        """Continuous polling. Run as an asyncio task from the lifespan."""
        while True:
            await asyncio.sleep(2)
            try:
                os.kill(self.parent_pid, 0)  # signal 0 = existence check
            except OSError:
                logger.error(f"Parent process (PID {self.parent_pid}) is gone, shutting down")
                os._exit(1)


# ============================================================================
# Heavy import waterfall (instrumented so each step is observable in the log)
# ============================================================================

try:
    logger.info("Importing torch...")
    import torch

    logger.info(f"torch {torch.__version__} imported")

    from util import system_info as system_info_module

    system_info_module.initialize()

    logger.info("Importing torchvision...")
    import torchvision

    logger.info(f"torchvision {torchvision.__version__} imported")

    logger.info("Importing FastAPI...")
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    logger.info("FastAPI imported")

    logger.info("Importing Engine Manager module...")
    from engine import Engines
    from engine.manager import WorldEngineManager

    logger.info("Engine Manager module imported")

    logger.info("Importing Safety module...")
    from engine.safety import SafetyChecker

    logger.info("Safety module imported")

except Exception as e:
    logger.fatal(f"Import failed: {e}", exc_info=True)
    sys.exit(1)


# Endpoints register onto an APIRouter in `server/routes.py`; importing it
# now is safe because the heavy import waterfall above has already completed.
from server.routes import router
from server.startup import ServerStartup

# ============================================================================
# Application lifecycle
# ============================================================================


async def _heavy_init(app: FastAPI, startup: ServerStartup) -> None:
    """Run heavy startup work (engine + safety warmup) in background so
    /health responds immediately while the GPU stack initialises. Populates
    `app.state.engines` on success."""
    try:
        startup.mark_stage(StageId.STARTUP_BEGIN)

        logger.info("Initializing WorldEngine...")
        startup.mark_stage(StageId.STARTUP_ENGINE_MANAGER)
        world_engine = WorldEngineManager()

        from engine.image_gen import ImageGenManager

        image_gen = ImageGenManager(world_engine.cuda_executor)

        logger.info("Initializing Safety Checker...")
        startup.mark_stage(StageId.STARTUP_SAFETY_CHECKER)
        safety_checker = await asyncio.to_thread(SafetyChecker, "cuda")
        startup.mark_stage(StageId.STARTUP_SAFETY_READY)

        app.state.engines = Engines(
            world_engine=world_engine,
            image_gen=image_gen,
            safety_checker=safety_checker,
        )

        logger.info("=" * 60)
        logger.info("[SERVER] Ready - Safety loaded, WorldEngine will load on first client")
        logger.info(f"[SERVER] {safety_checker.cache_size} safety cache entries")
        logger.info("=" * 60)
        startup.mark_stage(StageId.STARTUP_READY)

        startup.mark_done()

    except Exception as exc:
        logger.error(f"[SERVER] Startup failed: {exc}", exc_info=True)
        startup.mark_failed(str(exc))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle handler."""
    logger.info("=" * 60)
    logger.info("BIOME SERVER STARTUP")
    logger.info("=" * 60)

    startup = ServerStartup()
    app.state.startup = startup

    # Heavy init runs in background so /health responds immediately.
    init_task = asyncio.create_task(_heavy_init(app, startup))

    cfg: StartupConfig = app.state.startup_config
    watchdog_task = None
    if cfg.parent_pid is not None:
        watchdog_task = asyncio.create_task(ParentWatchdog(cfg.parent_pid).run())

    yield

    if watchdog_task is not None:
        watchdog_task.cancel()
    if not init_task.done():
        init_task.cancel()

    logger.info("[SERVER] Shutting down")


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
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description="Biome Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=7987, help="Port to bind to")
    parser.add_argument(
        "--parent-pid", type=int, default=None, help="PID of parent process; server exits if parent dies"
    )
    args = parser.parse_args()

    app.state.startup_config = StartupConfig(parent_pid=args.parent_pid)
    if args.parent_pid is not None:
        logger.info(f"Monitoring parent process PID {args.parent_pid}")
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
        logger.fatal("Fatal exception at server entrypoint", exc_info=True)
        raise
