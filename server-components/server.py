"""
Biome <> Python Communication Bridge

Low-latency WebSocket server that orchestrates WorldEngine and Safety modules.
This server acts as a unified interface for both world generation and safety checking.

Usage:
    python server.py --host 0.0.0.0 --port 7987

Client connects via WebSocket to ws://localhost:7987/ws
"""

import sys

from server_logging import SERVER_LOG_FILE, TeeStream, logger

logger.info(f"Python {sys.version}")
logger.info("Starting server...")

import asyncio
import json
import os
import struct
import threading
from contextlib import asynccontextmanager

# ---------------------------------------------------------------------------
from huggingface_hub import model_info as hf_model_info
from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

from action_logger import ActionLogger
from app_state import (
    AppState,
    StartupConfig,
    attach_app_state,
    attach_startup_config,
    get_app_state,
    get_app_state_ws,
    get_startup_config,
)
from hf_token import apply_resolved_token
from progress_stages import StageId
from protocol import (
    CheckSeedSafetyRequest,
    ClientMessage,
    ClientMessageAdapter,
    ControlNotif,
    GenerateSceneRequest,
    InitRequest,
    LogMessage,
    MessageId,
    PauseNotif,
    PromptNotif,
    ResetNotif,
    ResumeNotif,
    SceneEditRequest,
    StatusMessage,
    SystemInfoMessage,
    rpc_err,
    rpc_ok,
)
from safety_cache import load_safety_cache
from ws_session import (
    Connection,
    build_error_message,
    build_init_response_data,
    handle_check_seed_safety,
    handle_init,
    run_generator,
    run_receiver,
    run_sender,
)

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


try:
    logger.info("Importing torch...")
    import torch

    logger.info(f"torch {torch.__version__} imported")

    import system_info as system_info_module

    system_info_module.initialize()

    logger.info("Importing torchvision...")
    import torchvision

    logger.info(f"torchvision {torchvision.__version__} imported")

    logger.info("Importing PIL...")

    logger.info("PIL imported")

    logger.info("Importing FastAPI...")
    import uvicorn
    from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import JSONResponse

    logger.info("FastAPI imported")

    logger.info("Importing Engine Manager module...")
    from engine_manager import BUTTON_CODES, Session, WorldEngineManager

    logger.info("Engine Manager module imported")

    logger.info("Importing Safety module...")
    from safety import SafetyChecker

    logger.info("Safety module imported")

except Exception as e:
    logger.fatal(f"Import failed: {e}", exc_info=True)
    sys.exit(1)


LOG_TAIL_INITIAL_LINES = 220


def _read_log_tail_lines(max_lines: int) -> list[str]:
    """Read last non-empty lines from the canonical server log file."""
    if max_lines <= 0:
        return []
    try:
        with open(SERVER_LOG_FILE, encoding="utf-8", errors="replace") as fp:
            lines = [line.rstrip("\r\n") for line in fp if line.strip()]
        return lines[-max_lines:]
    except Exception:
        return []


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
# Application Lifecycle
# ============================================================================


async def _heavy_init(state: AppState) -> None:
    """Run heavy startup work (safety warmup, seed validation) in background."""
    try:
        _broadcast_startup_stage(state, StageId.STARTUP_BEGIN)

        # Initialize modules
        logger.info("Initializing WorldEngine...")
        _broadcast_startup_stage(state, StageId.STARTUP_ENGINE_MANAGER)
        state.world_engine = WorldEngineManager()

        from image_gen import ImageGenManager

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

# Add CORS middleware to allow frontend requests
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Utilities
# ============================================================================


# ============================================================================
# HTTP Endpoints
# ============================================================================


@app.get("/health")
async def health(state: AppState = Depends(get_app_state)):
    """Health check for Biome backend."""
    we = state.world_engine
    sc = state.safety_checker
    return JSONResponse(
        {
            "status": "ok",
            "startup_complete": state.startup_complete,
            "world_engine": {
                "loaded": we is not None and we.engine is not None,
                "warmed_up": we is not None and we.engine_warmed_up,
                "has_seed": we is not None and we.seed_frame is not None,
            },
            "safety": {"loaded": sc is not None and sc.model is not None},
        }
    )


@app.get("/api/model-info/{model_id:path}")
async def get_model_info(model_id: str):
    """Fetch model metadata from HuggingFace Hub."""

    def _fetch():
        info = hf_model_info(model_id, files_metadata=True)
        size_bytes = None
        if hasattr(info, "siblings") and info.siblings:
            excluded_basenames = {"diffusion_pytorch_model.safetensors"}
            st_files = [
                s
                for s in info.siblings
                if s.rfilename.endswith(".safetensors")
                and s.size is not None
                and os.path.basename(s.rfilename) not in excluded_basenames
            ]
            seen_blobs = set()
            for s in st_files:
                blob_key = getattr(s, "blob_id", None) or s.rfilename
                if blob_key not in seen_blobs:
                    seen_blobs.add(blob_key)
                    size_bytes = (size_bytes or 0) + s.size
        return {"id": model_id, "size_bytes": size_bytes, "exists": True, "error": None}

    try:
        data = await asyncio.to_thread(_fetch)
        return JSONResponse(data)
    except RepositoryNotFoundError:
        return JSONResponse({"id": model_id, "size_bytes": None, "exists": False, "error": "Model not found"})
    except GatedRepoError:
        return JSONResponse({"id": model_id, "size_bytes": None, "exists": True, "error": "Private or gated model"})
    except Exception as e:
        logger.warning(f"model-info error for {model_id}: {e}")
        return JSONResponse({"id": model_id, "size_bytes": None, "exists": True, "error": "Could not check model"})


# ============================================================================
# WorldEngine WebSocket
# ============================================================================


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, state: AppState = Depends(get_app_state_ws)):
    """WebSocket endpoint — wiring shell.

    Owns the per-connection lifecycle: log streaming, startup-progress
    replay, the pre-init handshake, scene-authoring warmup, world-engine
    warmup, then spawns the receiver / sender / generator workers in
    `ws_session.py`. The wire format itself is defined in `protocol.py`
    as a Pydantic discriminated union — see `ClientMessage` /
    `ServerPushMessage` for the canonical shape, and `MessageId` for
    the enumerated translation keys.
    """
    client_host = websocket.client.host if websocket.client else "unknown"
    logger.info(f"Client connected: {client_host}")
    conn = Connection(websocket=websocket, state=state, client_host=client_host)

    await websocket.accept()

    # Stream log lines to the client. TeeStream captures all stdout/stderr
    # output (including logger output) and pushes complete lines into per-client
    # queues, so logs arrive immediately without file polling. The queue and
    # loop reference live on `conn`.

    async def _stream_logs_to_client():
        try:
            # Replay recent log history so the client sees what happened before it connected.
            # Register for live lines only AFTER reading the tail to avoid duplicates.
            initial_lines = _read_log_tail_lines(LOG_TAIL_INITIAL_LINES)
            for line in initial_lines:
                await conn.send_message(LogMessage(line=line))
            TeeStream.register_client(conn.log_queue, conn.main_loop)

            # Stream new log lines as they arrive from TeeStream.
            while True:
                line = await conn.log_queue.get()
                await conn.send_message(LogMessage(line=line))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            # Avoid recursion — don't use logger here.
            print(f"[{client_host}] Log stream stopped: {e}", flush=True)

    log_tail_task = asyncio.create_task(_stream_logs_to_client())

    # If startup is not yet complete, replay accumulated stages and stream new ones.
    # `None` enqueued from _heavy_init signals "startup done".
    startup_queue: asyncio.Queue[StatusMessage | None] | None = None
    if not state.startup_complete:
        startup_queue = asyncio.Queue(maxsize=200)
        state.ws_startup_waiters.append(startup_queue)
        # Replay accumulated stages
        for stage_msg in state.startup_stages:
            await conn.send_message(stage_msg)
        # Stream new stages until startup is done
        while not state.startup_complete:
            try:
                next_msg = await asyncio.wait_for(startup_queue.get(), timeout=1.0)
                if next_msg is None:
                    break
                await conn.send_message(next_msg)
            except TimeoutError:
                continue
        state.ws_startup_waiters.remove(startup_queue)

    if state.startup_error:
        await conn.send_message(
            build_error_message(message_id=MessageId.SERVER_STARTUP_FAILED, message=str(state.startup_error))
        )
        log_tail_task.cancel()
        TeeStream.unregister_client(conn.log_queue)
        await websocket.close()
        return

    # Past the startup gate: these are guaranteed populated by `_heavy_init`.
    # Bind to locals so the rest of this function reads them as non-Optional;
    # the asserts also let basedpyright narrow the types downstream.
    assert state.world_engine is not None
    assert state.image_gen is not None
    assert state.safety_checker is not None
    world_engine = state.world_engine
    image_gen = state.image_gen
    safety_checker = state.safety_checker

    # Push system info immediately so the client has the hardware identity
    # even if the session crashes during init (e.g. CUDA graph compilation).
    await conn.send_message(SystemInfoMessage(**system_info_module.get_system_info().model_dump()))

    session = Session()
    # Each websocket session must perform an explicit model/seed handshake.
    world_engine.seed_frame = None

    # Progress queue: engine_manager calls progress_callback (sync, from CUDA thread)
    # which enqueues payloads; the drain task sends them over the WebSocket.
    # Queue lives on `conn` (initialised in Connection.__post_init__).

    async def _drain_progress_queue():
        try:
            while True:
                msg = await conn.progress_queue.get()
                try:
                    await conn.send_message(msg)
                except Exception:
                    break
        except asyncio.CancelledError:
            pass

    progress_drain_task = asyncio.create_task(_drain_progress_queue())

    try:
        await conn.send_stage(StageId.SESSION_WAITING_FOR_SEED)
        logger.info(f"[{client_host}] Waiting for init message...")

        while world_engine.seed_frame is None:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                try:
                    parsed: ClientMessage = ClientMessageAdapter.validate_json(raw)
                except Exception as e:
                    logger.info(f"[{client_host}] Ignoring invalid message during pre-init: {e}")
                    continue

                match parsed:
                    case CheckSeedSafetyRequest() as req:
                        result = await handle_check_seed_safety(state, req)
                        await websocket.send_text(result.model_dump_json(exclude_none=True))
                    case InitRequest() as req:
                        # init RPC: response is deferred until after warmup/session init completes
                        conn.init_req_id = req.req_id
                        ready, _ = await handle_init(conn, world_engine, safety_checker, session, req)
                        if not ready:
                            await websocket.send_text(
                                rpc_err(conn.init_req_id, error_id=MessageId.INIT_FAILED).model_dump_json(
                                    exclude_none=True
                                )
                            )
                            conn.init_req_id = None
                    case SceneEditRequest() | GenerateSceneRequest():
                        # Authoring RPCs require an active session.
                        await websocket.send_text(
                            rpc_err(parsed.req_id, error_id=MessageId.INIT_FAILED).model_dump_json(exclude_none=True)
                        )
                    case ControlNotif() | PauseNotif() | ResumeNotif() | ResetNotif() | PromptNotif():
                        logger.info(f"[{client_host}] Ignoring notification '{parsed.type}' while waiting for init")

            except TimeoutError:
                logger.error(f"[{client_host}] Timeout waiting for init")
                await conn.send_message(build_error_message(message_id=MessageId.TIMEOUT_WAITING_FOR_SEED))
                return

        # Wire progress callback so engine_manager reports granular stages
        world_engine.set_progress_callback(conn.push_progress, conn.main_loop)

        assert world_engine.engine is not None, "Client must specify a model in the init message"

        if world_engine.seed_frame is None:
            logger.info(
                f"[{client_host}] Seed frame missing before initialization; client likely disconnected/reconnected during model switch"
            )
            world_engine.set_progress_callback(None)
            if conn.init_req_id:
                await conn.send_message(rpc_err(conn.init_req_id, error_id=MessageId.INIT_FAILED))
            return

        # Load or unload scene authoring model based on flag.
        # Loading happens BEFORE WorldEngine warmup so CUDA graphs
        # are compiled with the model's memory already allocated.
        if not conn.scene_authoring_requested and image_gen is not None and image_gen.is_loaded:
            logger.info(f"[{client_host}] Scene authoring disabled — unloading model")
            await asyncio.to_thread(image_gen.unload)

        if conn.scene_authoring_requested and image_gen is not None and not image_gen.is_loaded:
            await conn.send_stage(StageId.SESSION_INPAINTING_LOAD)
            try:
                await image_gen.warmup()
                await conn.send_stage(StageId.SESSION_INPAINTING_READY)
            except Exception as e:
                logger.error(f"[{client_host}] Scene authoring warmup failed: {e}", exc_info=True)
                await conn.send_message(
                    build_error_message(message_id=MessageId.SCENE_AUTHORING_MODEL_LOAD_FAILED, message=str(e))
                )
                if conn.init_req_id:
                    await conn.send_message(
                        rpc_err(conn.init_req_id, error_id=MessageId.SCENE_AUTHORING_MODEL_LOAD_FAILED)
                    )
                return

        # Warmup on first connection AFTER seed is loaded
        if not world_engine.engine_warmed_up:
            try:
                await world_engine.warmup()
            except RuntimeError as e:
                err_str = str(e)
                if "compute capability" in err_str or "scaled_mm" in err_str:
                    logger.error(
                        f"[{client_host}] Errors running selected model, most likely selected quantization mode is unsupported on this GPU. Error message: {err_str}"
                    )
                    await conn.send_message(
                        build_error_message(
                            message_id=MessageId.QUANT_UNSUPPORTED_GPU,
                            params={"quant": world_engine.quant or "unknown"},
                        )
                    )
                    return
                raise

        # Init session (reset, seed, prompt) with granular progress
        await asyncio.to_thread(world_engine.init_session)

        # Send initial frame so client has something to display
        initial_display_frame = world_engine.seed_frame[0] if world_engine.is_multiframe else world_engine.seed_frame
        jpeg = await asyncio.to_thread(world_engine.frame_to_jpeg, initial_display_frame)
        header = json.dumps(
            {"frame_id": 0, "client_ts": 0, "gen_ms": 0},
            separators=(",", ":"),
        ).encode("utf-8")
        await websocket.send_bytes(struct.pack("<I", len(header)) + header + jpeg)

        world_engine.set_progress_callback(None)
        await conn.send_stage(StageId.SESSION_READY)
        logger.info(f"[{client_host}] Ready for game loop")

        conn.action_logger = ActionLogger(client_host) if conn.action_logging_requested else None

        conn.start_action_log_segment(world_engine)
        conn.start_video_segment(world_engine)

        # Game-loop state and scene-authoring handoff are tracked on Connection.
        # Receiver posts {"prompt": str, "future": Future} into
        # conn.scene_edit_request / conn.generate_scene_request; the generator
        # picks them up at a clean frame boundary and resolves the future.
        # Frame queue, control state, and inter-thread channels live on `conn`
        # (initialised in Connection.__post_init__).

        # Respond to init RPC with session metrics
        if conn.init_req_id:
            await conn.send_message(
                rpc_ok(conn.init_req_id, build_init_response_data(world_engine, system_info_module.get_system_info()))
            )
            conn.init_req_id = None

        gen_thread = threading.Thread(
            target=run_generator,
            args=(conn, world_engine, session),
            daemon=True,
            name=f"gen-{client_host}",
        )
        gen_thread.start()

        recv_task = asyncio.create_task(
            run_receiver(
                conn,
                world_engine,
                image_gen,
                safety_checker,
                session,
                BUTTON_CODES,
                system_info_module.get_system_info(),
            )
        )
        send_task = asyncio.create_task(run_sender(conn))
        done, pending = await asyncio.wait(
            [recv_task, send_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        conn.running = False
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    except WebSocketDisconnect:
        logger.info(f"[{client_host}] WebSocket disconnected")
    except Exception as e:
        # Uvicorn may surface client close as ClientDisconnected instead of WebSocketDisconnect.
        # Treat both as normal disconnects to avoid noisy tracebacks during intentional reconnects.
        if e.__class__.__name__ == "ClientDisconnected":
            logger.info(f"[{client_host}] Client disconnected")
        else:
            logger.error(f"[{client_host}] Error: {e}", exc_info=True)
            try:
                await conn.send_message(build_error_message(message=str(e)))
            except Exception:
                pass
    finally:
        log_tail_task.cancel()
        TeeStream.unregister_client(conn.log_queue)
        progress_drain_task.cancel()
        world_engine.set_progress_callback(None)
        if conn.action_logger is not None:
            conn.action_logger.end_segment()
        if conn.video_recorder is not None:
            conn.video_recorder.end_segment()
        logger.info(f"[{client_host}] Disconnected (frames: {session.perceptual_frame_count})")


# ============================================================================
# Entry Point
# ============================================================================

if __name__ == "__main__":
    import argparse

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
