"""
HTTP and WebSocket endpoints for the Biome server.

Exposes a `router: APIRouter` containing the `/health` probe, the
`/api/model-info/{model_id}` HF metadata proxy, and the `/ws`
WebSocket entry point that owns per-connection lifecycle (log
streaming, startup-progress replay, pre-init handshake, scene-
authoring + world-engine warmup, then handing off to the receiver
/ sender / generator workers in `ws_runner.py`).

The router is mounted onto the FastAPI `app` in `main.py`. All
process-level concerns (heavy imports, lifespan, env, uvicorn boot)
live there; this module is import-safe and process-agnostic.
"""

import asyncio
import json
import os
import struct
import threading

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from huggingface_hub import model_info as hf_model_info
from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

import system_info as system_info_module
from action_logger import ActionLogger
from app_state import AppState, get_app_state, get_app_state_ws
from keymap import BUTTON_CODES
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
    StageId,
    StatusMessage,
    SystemInfoMessage,
    rpc_err,
    rpc_ok,
)
from server_logging import SERVER_LOG_FILE, TeeStream, logger
from ws_handlers import build_init_response_data, handle_check_seed_safety, handle_init
from ws_runner import run_generator, run_receiver, run_sender
from ws_session import Connection, build_error_message

router = APIRouter()


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
# HTTP Endpoints
# ============================================================================


@router.get("/health")
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


@router.get("/api/model-info/{model_id:path}")
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
                    size_bytes = (size_bytes or 0) + (s.size or 0)
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


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, state: AppState = Depends(get_app_state_ws)):
    """WebSocket endpoint — wiring shell.

    Owns the per-connection lifecycle: log streaming, startup-progress
    replay, the pre-init handshake, scene-authoring warmup, world-engine
    warmup, then spawns the receiver / sender / generator workers in
    `ws_runner.py`. The wire format itself is defined in `protocol.py`
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
                        ready, _ = await handle_init(conn, world_engine, safety_checker, req)
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
            args=(conn, world_engine),
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
                BUTTON_CODES,
                system_info_module.get_system_info(),
            )
        )
        send_task = asyncio.create_task(run_sender(conn))
        _done, pending = await asyncio.wait(
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
        logger.info(f"[{client_host}] Disconnected (frames: {conn.perceptual_frame_count})")
