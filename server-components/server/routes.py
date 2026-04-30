"""
HTTP and WebSocket endpoints for the Biome server.

Exposes a `router: APIRouter` with the `/health` probe, the
`/api/model-info/{model_id}` HF metadata proxy, and the `/ws`
WebSocket entry point. The router is mounted onto the FastAPI `app`
in `main.py`; this module is import-safe and process-agnostic.

The WebSocket endpoint stays a thin protocol shell: it owns transport
lifecycle (accept, dispatch by phase, close, top-level error reporting)
and delegates every internal concern to the module that owns it.
Phases run top-to-bottom; each is one well-named call:

  - log streaming           → `util.server_logging.stream_logs_to_client`
  - startup wait            → `ServerStartup.replay_to`
  - progress drain          → `Connection.run_progress_drain`
  - pre-init handshake      → `server.session.handlers.run_preinit_handshake`
  - warmup + init + frame   → `server.session.handlers.prepare_session`
  - recorders               → `Connection.start_recording_segments`
  - game loop               → `server.session.workers.run_session`
  - cleanup                 → `Connection.teardown`

`app.state` carries the resources the lifespan populates: `engines`
(an `Engines` bundle), `safety_cache`, `startup` (`ServerStartup`).
The typed accessors below pull each piece individually so endpoints
take only what they need rather than reaching through a god object.
"""

import asyncio
import os

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from huggingface_hub import model_info as hf_model_info
from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

from engine import Engines
from engine.safety import SafetyCacheEntry
from server.protocol import MessageId, StageId, SystemInfoMessage, rpc_ok
from server.session.connection import Connection, build_error_message
from server.session.handlers import build_init_response_data, prepare_session, run_preinit_handshake
from server.session.workers import run_session
from server.startup import ServerStartup
from util import system_info as system_info_module
from util.server_logging import logger, stream_logs_to_client

SafetyCache = dict[str, SafetyCacheEntry]

router = APIRouter()


# ============================================================================
# Typed Depends accessors
# ============================================================================


def get_engines(request: Request) -> Engines:
    engines: Engines = request.app.state.engines
    return engines


def get_engines_ws(websocket: WebSocket) -> Engines:
    engines: Engines = websocket.app.state.engines
    return engines


def get_safety_cache_ws(websocket: WebSocket) -> SafetyCache:
    cache: SafetyCache = websocket.app.state.safety_cache
    return cache


def get_startup(request: Request) -> ServerStartup:
    startup: ServerStartup = request.app.state.startup
    return startup


def get_startup_ws(websocket: WebSocket) -> ServerStartup:
    startup: ServerStartup = websocket.app.state.startup
    return startup


# ============================================================================
# HTTP Endpoints
# ============================================================================


@router.get("/health")
async def health(request: Request, startup: ServerStartup = Depends(get_startup)):
    """Health check for Biome backend. Reads through to `app.state` directly
    for engine handles since they may not be populated yet during startup."""
    engines: Engines | None = getattr(request.app.state, "engines", None)
    we = engines.world_engine if engines else None
    sc = engines.safety_checker if engines else None
    return JSONResponse(
        {
            "status": "ok",
            "startup_complete": startup.complete,
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
async def websocket_endpoint(
    websocket: WebSocket,
    startup: ServerStartup = Depends(get_startup_ws),
):
    """Per-connection lifecycle. Reads top-to-bottom as one phase per call.

    The wire format is the Pydantic discriminated union in `protocol.py`
    (`ClientMessage` / `ServerPushMessage`); the `MessageId` enum carries
    every translatable error key. Each phase's internals live in the
    module named after the phase — see this file's docstring for the map.
    """
    client_host = websocket.client.host if websocket.client else "unknown"
    logger.info(f"Client connected: {client_host}")
    conn = Connection(websocket=websocket, client_host=client_host)
    await websocket.accept()

    log_task = asyncio.create_task(stream_logs_to_client(conn))
    progress_task: asyncio.Task[None] | None = None
    # Bound after the startup gate so `teardown`'s callback-clear can no-op
    # safely when we tear down before the engines are ready.
    engines: Engines | None = None

    try:
        # Phase 1: wait for backend `_heavy_init` to finish (replay any
        # accumulated stages, then stream live ones until done).
        await startup.replay_to(conn)
        if startup.error:
            await conn.send_message(
                build_error_message(message_id=MessageId.SERVER_STARTUP_FAILED, message=str(startup.error))
            )
            return

        # Past the startup gate: engines + safety cache are populated.
        engines = get_engines_ws(websocket)
        safety_cache = get_safety_cache_ws(websocket)
        world_engine = engines.world_engine

        # Phase 2: hardware identity goes out immediately so the client has
        # it even if init crashes (e.g. CUDA graph compilation failure).
        # Reset the seed so this session must perform an explicit handshake.
        await conn.send_message(SystemInfoMessage(**system_info_module.get_system_info().model_dump()))
        world_engine.seed_frame = None
        progress_task = asyncio.create_task(conn.run_progress_drain())

        # Phase 3: pre-init message dispatch — wait for an InitRequest that
        # loads a seed frame (or 60 s timeout).
        if not await run_preinit_handshake(conn, world_engine, engines.safety_checker, safety_cache):
            return

        # Phase 4: scene-authoring + engine warmup, init session, send
        # initial frame. Surfaces typed errors and acks the deferred init
        # RPC on failure so the client always gets a definitive response.
        if not await prepare_session(conn, world_engine, engines.image_gen):
            return

        await conn.send_stage(StageId.SESSION_READY)
        logger.info(f"[{client_host}] Ready for game loop")

        # Phase 5: open recorder segments, ack the deferred init RPC.
        conn.start_recording_segments(world_engine)
        if conn.init_req_id:
            await conn.send_message(
                rpc_ok(conn.init_req_id, build_init_response_data(world_engine, system_info_module.get_system_info()))
            )
            conn.init_req_id = None

        # Phase 6: the game loop. Spawns the gen thread + receiver/sender
        # asyncio tasks; returns once any of them exits (which signals
        # disconnect or terminal error).
        await run_session(conn, engines, safety_cache)

    except WebSocketDisconnect:
        logger.info(f"[{client_host}] WebSocket disconnected")
    except Exception as e:
        # Uvicorn may surface client close as ClientDisconnected instead
        # of WebSocketDisconnect — treat both as normal disconnects to
        # avoid noisy tracebacks during intentional reconnects.
        if e.__class__.__name__ == "ClientDisconnected":
            logger.info(f"[{client_host}] Client disconnected")
        else:
            logger.error(f"[{client_host}] Error: {e}", exc_info=True)
            try:
                await conn.send_message(build_error_message(message=str(e)))
            except Exception:
                pass
    finally:
        world_engine_for_teardown = engines.world_engine if engines is not None else None
        conn.teardown(world_engine_for_teardown, log_task, progress_task)
