"""
Entry point and lifecycle for the Biome server.

Owns the process boundary: instrumented heavy-import waterfall, env
setup, parent-process watchdog, FastAPI lifespan + heavy init task,
the FastAPI `app` instance + middleware, and the uvicorn boot. Endpoint
definitions live in `server.py`.
"""

import sys

from util.server_logging import logger

logger.info(f"Python {sys.version}")
logger.info("Starting server...")

import asyncio
import os
from contextlib import asynccontextmanager

from app_state import (
    AppState,
    StartupConfig,
    attach_app_state,
    attach_startup_config,
    get_startup_config,
)
from server.protocol import StageId, StatusMessage
from util.hf_token import apply_resolved_token

apply_resolved_token()

# Reduce CUDA allocator fragmentation during repeated model loads/switches.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

logger.info("Basic imports done")

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
    from engine.manager import WorldEngineManager

    logger.info("Engine Manager module imported")

    logger.info("Importing Safety module...")
    from engine.safety import SafetyChecker, load_safety_cache

    logger.info("Safety module imported")

except Exception as e:
    logger.fatal(f"Import failed: {e}", exc_info=True)
    sys.exit(1)


# Endpoints register onto an APIRouter in `server.py`; importing it now
# is safe because the heavy import waterfall above has already completed.
from server.routes import router

# ============================================================================
# Startup broadcast helpers
# ============================================================================


def _broadcast_startup_stage(state: AppState, stage: StageId) -> None:
    """Store a startup stage on AppState and push it to any connected WS clients."""
    msg = StatusMessage(stage=stage)
    state.startup_stages.append(msg)
    # Also log to stdout so file-based logs capture it
    logger.info(f"Startup stage: {stage}")
    for q in state.ws_startup_waiters:
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            pass


def _signal_startup_done(state: AppState) -> None:
    """Wake every waiter so its replay loop exits."""
    for q in state.ws_startup_waiters:
        try:
            q.put_nowait(None)
        except asyncio.QueueFull:
            pass


# ============================================================================
# Application lifecycle
# ============================================================================


async def _heavy_init(state: AppState) -> None:
    """Run heavy startup work (engine + safety warmup) in background so
    /health responds immediately while the GPU stack initialises."""
    try:
        _broadcast_startup_stage(state, StageId.STARTUP_BEGIN)

        logger.info("Initializing WorldEngine...")
        _broadcast_startup_stage(state, StageId.STARTUP_ENGINE_MANAGER)
        state.world_engine = WorldEngineManager()

        from engine.image_gen import ImageGenManager

        state.image_gen = ImageGenManager(state.world_engine.cuda_executor)

        logger.info("Initializing Safety Checker...")
        _broadcast_startup_stage(state, StageId.STARTUP_SAFETY_CHECKER)
        state.safety_checker = SafetyChecker()
        await asyncio.to_thread(state.safety_checker.load_resident, "cuda")
        logger.info("Safety Checker loaded on GPU")
        _broadcast_startup_stage(state, StageId.STARTUP_SAFETY_READY)

        # Load hash-based safety cache
        state.safety_hash_cache = load_safety_cache()

        logger.info("=" * 60)
        logger.info("[SERVER] Ready - Safety loaded, WorldEngine will load on first client")
        logger.info(f"[SERVER] {len(state.safety_hash_cache)} safety cache entries")
        logger.info("=" * 60)
        _broadcast_startup_stage(state, StageId.STARTUP_READY)

        state.startup_complete = True
        _signal_startup_done(state)

    except Exception as exc:
        state.startup_error = str(exc)
        logger.error(f"[SERVER] Startup failed: {exc}", exc_info=True)
        state.startup_complete = True  # mark done so waiters unblock
        _signal_startup_done(state)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle handler."""
    logger.info("=" * 60)
    logger.info("BIOME SERVER STARTUP")
    logger.info("=" * 60)

    state = AppState()
    attach_app_state(app, state)

    # Start heavy init in background so /health responds immediately
    init_task = asyncio.create_task(_heavy_init(state))

    # Start parent-process watchdog if launched with --parent-pid
    cfg = get_startup_config(app)
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

    attach_startup_config(app, StartupConfig(parent_pid=args.parent_pid))
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
