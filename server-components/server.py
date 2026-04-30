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
import base64
import hashlib
import io
import json
import os
import pickle
import struct
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from queue import Queue

# ---------------------------------------------------------------------------
from huggingface_hub import model_info as hf_model_info
from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError
from pydantic import BaseModel

from action_logger import ActionLogger
from app_state import (
    AppState,
    SafetyCacheEntry,
    attach_app_state,
    get_app_state,
    get_app_state_ws,
)
from progress_stages import (
    SESSION_INPAINTING_LOAD,
    SESSION_INPAINTING_READY,
    SESSION_READY,
    SESSION_WAITING_FOR_SEED,
    STARTUP_BEGIN,
    STARTUP_ENGINE_MANAGER,
    STARTUP_READY,
    STARTUP_SAFETY_CHECKER,
    STARTUP_SAFETY_READY,
    Stage,
)
from protocol import (
    CheckSeedSafetyRequest,
    CheckSeedSafetyResponseData,
    ClientMessage,
    ClientMessageAdapter,
    ControlNotif,
    ErrorMessage,
    ErrorSnapshot,
    GenerateSceneRequest,
    GenerateSceneResponseData,
    InitRequest,
    InitResponseData,
    LogMessage,
    MessageId,
    PauseNotif,
    PromptNotif,
    ResetNotif,
    ResumeNotif,
    RpcError,
    RpcSuccess,
    SceneEditRequest,
    SceneEditResponseData,
    StatusMessage,
    SystemInfo,
    SystemInfoMessage,
    WarningMessage,
    rpc_err,
    rpc_ok,
)
from video_recorder import RecordingProperties, VideoRecorder

# Resolve HuggingFace token: env var > CLI-cached token file.
# Biome overrides HF_HOME to keep model cache inside world_engine/, which means
# the huggingface_hub library won't find the user's default token at
# ~/.cache/huggingface/token. We check multiple locations to match the Electron
# side's resolution order.


def resolve_hf_token() -> str | None:
    """Resolve HuggingFace token from env vars and well-known file locations.

    Mirrors the Electron-side getHfToken() resolution order so both paths
    find the same token regardless of HF_HOME overrides.
    """
    # 1. HF_TOKEN env var
    token = os.environ.get("HF_TOKEN")
    if token:
        return token
    # 2. Deprecated HUGGING_FACE_HUB_TOKEN env var
    token = os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token:
        return token
    # 3. File at HF_TOKEN_PATH env var
    token_path_env = os.environ.get("HF_TOKEN_PATH")
    if token_path_env:
        p = Path(token_path_env)
        if p.is_file():
            t = p.read_text().strip()
            if t:
                return t
    # 4. File at real user HF_HOME/token (use XDG_CACHE_HOME or ~/.cache,
    #    NOT the overridden HF_HOME which points into world_engine/)
    xdg = os.environ.get("XDG_CACHE_HOME")
    if xdg:
        p = Path(xdg) / "huggingface" / "token"
        if p.is_file():
            t = p.read_text().strip()
            if t:
                return t
    # 5. Default fallback: ~/.cache/huggingface/token
    p = Path.home() / ".cache" / "huggingface" / "token"
    if p.is_file():
        t = p.read_text().strip()
        if t:
            return t
    return None


_resolved_token = resolve_hf_token()
if _resolved_token:
    os.environ["HF_TOKEN"] = _resolved_token
    logger.info("HF token resolved and set")
else:
    logger.warning("No HuggingFace token found (set HF_TOKEN or run `huggingface-cli login`)")

# Reduce CUDA allocator fragmentation during repeated model loads/switches.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

logger.info("Basic imports done")

# If launched with --parent-pid, ask the OS to kill us when the parent dies (Linux only),
# and start a background thread to poll the parent PID as a cross-platform fallback.
_parent_pid: int | None = None


def _check_parent_alive() -> None:
    """Check if the monitored parent process is still alive. Exit if not."""
    if _parent_pid is None:
        return
    try:
        os.kill(_parent_pid, 0)
    except OSError:
        logger.error(f"Parent process (PID {_parent_pid}) is already gone, shutting down")
        os._exit(1)


async def _watch_parent_pid() -> None:
    """Periodically check if the parent process is still alive. Exit if it's gone."""
    if _parent_pid is None:
        return
    while True:
        await asyncio.sleep(2)
        try:
            os.kill(_parent_pid, 0)  # Signal 0 = check if process exists
        except OSError:
            logger.error(f"Parent process (PID {_parent_pid}) is gone, shutting down")
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
    from PIL import Image

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


def build_error_message(
    *,
    message_id: MessageId | None = None,
    message: str | None = None,
    params: dict[str, str] | None = None,
) -> ErrorMessage:
    """Build an ErrorMessage with an attached snapshot of ephemeral state
    (RAM/VRAM/GPU util at error time).  Every outgoing `error` push should
    go through this so bug reports capture what the server was actually
    doing at the failure point."""
    return ErrorMessage(
        message_id=message_id,
        message=message,
        params=params,
        snapshot=ErrorSnapshot(**system_info_module.capture_error_snapshot()),
    )


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
# Safety Cache
# ============================================================================


SAFETY_CACHE_FILE = Path(__file__).parent.parent / "world_engine" / ".safety_cache.bin"


def load_safety_cache() -> dict[str, SafetyCacheEntry]:
    """Load hash-based safety cache from binary file."""
    if not SAFETY_CACHE_FILE.exists():
        return {}
    try:
        with open(SAFETY_CACHE_FILE, "rb") as f:
            cache = pickle.load(f)
        logger.info(f"Loaded safety cache with {len(cache)} entries")
        return cache
    except Exception as e:
        logger.error(f"Failed to load safety cache: {e}")
        return {}


def save_safety_cache(cache: dict[str, SafetyCacheEntry]) -> None:
    """Save hash-based safety cache to binary file."""
    try:
        SAFETY_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(SAFETY_CACHE_FILE, "wb") as f:
            pickle.dump(cache, f)
    except Exception as e:
        logger.error(f"Failed to save safety cache: {e}")


def compute_bytes_hash(data: bytes) -> str:
    """Compute SHA256 hash of raw bytes."""
    return hashlib.sha256(data).hexdigest()


# ============================================================================
# Startup broadcast helpers
# ============================================================================


def _broadcast_startup_stage(state: AppState, stage: Stage) -> None:
    """Store a startup stage on AppState and push it to any connected WS clients."""
    msg = StatusMessage(stage=stage.id)
    state.startup_stages.append(msg)
    # Also log to stdout so file-based logs capture it
    logger.info(f"Startup stage: {stage.id}")
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
        _broadcast_startup_stage(state, STARTUP_BEGIN)

        # Initialize modules
        logger.info("Initializing WorldEngine...")
        _broadcast_startup_stage(state, STARTUP_ENGINE_MANAGER)
        state.world_engine = WorldEngineManager()

        from image_gen import ImageGenManager

        state.image_gen = ImageGenManager(state.world_engine.cuda_executor)

        logger.info("Initializing Safety Checker...")
        _broadcast_startup_stage(state, STARTUP_SAFETY_CHECKER)
        state.safety_checker = SafetyChecker()
        await asyncio.to_thread(state.safety_checker.load_resident, "cuda")
        logger.info("Safety Checker loaded on GPU")
        _broadcast_startup_stage(state, STARTUP_SAFETY_READY)

        # Load hash-based safety cache
        state.safety_hash_cache = load_safety_cache()

        logger.info("=" * 60)
        logger.info("[SERVER] Ready - Safety loaded, WorldEngine will load on first client")
        logger.info(f"[SERVER] {len(state.safety_hash_cache)} safety cache entries")
        logger.info("=" * 60)
        _broadcast_startup_stage(state, STARTUP_READY)

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

    # Start parent-process watchdog
    watchdog_task = None
    if _parent_pid is not None:
        watchdog_task = asyncio.create_task(_watch_parent_pid())

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
# WS Request Handlers
# ============================================================================


async def handle_check_seed_safety(
    state: AppState,
    req: CheckSeedSafetyRequest,
) -> RpcSuccess[CheckSeedSafetyResponseData] | RpcError:
    """Check if a seed image is safe. Server computes hash, caches result."""
    if not req.image_data:
        return rpc_err(req.req_id, error=MessageId.SEED_MISSING_DATA.value)

    try:
        image_bytes = base64.b64decode(req.image_data)
    except Exception as e:
        return rpc_err(req.req_id, error=f"Invalid base64 data: {e}")

    img_hash = compute_bytes_hash(image_bytes)

    # Check cache first
    if img_hash in state.safety_hash_cache:
        cached = state.safety_hash_cache[img_hash]
        return rpc_ok(
            req.req_id,
            CheckSeedSafetyResponseData(is_safe=cached["is_safe"], hash=img_hash),
        )

    # Run safety check (decode + inference off the event loop)
    safety_checker = state.safety_checker
    try:

        def _check_safety():
            pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            return safety_checker.check_pil_image(pil_img)

        safety_result = await asyncio.to_thread(_check_safety)
    except Exception as e:
        logger.error(f"Safety check failed: {e}")
        return rpc_err(req.req_id, error=f"Safety check failed: {e}")

    is_safe = safety_result.get("is_safe", False)
    state.safety_hash_cache[img_hash] = {
        "is_safe": is_safe,
        "scores": safety_result.get("scores", {}),
        "checked_at": time.time(),
    }
    save_safety_cache(state.safety_hash_cache)

    return rpc_ok(req.req_id, CheckSeedSafetyResponseData(is_safe=is_safe, hash=img_hash))


def _run_generate_scene_on_generator(state: AppState, prompt: str, biome_version: str | None) -> dict:
    """Generate a new scene from a text prompt and load it as the current seed.

    Runs on the generator thread.  Uses the inpainting pipeline with a blank
    canvas so the VLM can still sanitise the prompt.  Returns the generated
    image (base64 JPEG) plus metadata (user prompt, sanitised prompt, model id)
    so the client can persist it if Scene Authoring auto-save is enabled.

    Image/image_gen imports are function-scoped to keep torch out of the
    server module's import graph — the logged startup block in this file
    imports torch once with progress reporting, and nothing at module level
    should trigger a second uninstrumented load.
    """
    from PIL import Image

    from image_gen import (
        EDIT_MODEL_ID,
        GENERATE_SCENE_SAFETY_MESSAGE_ID,
        GeneratedSceneProperties,
        SafetyRejectionError,
        properties_to_jpeg_comment,
    )

    assert state.world_engine is not None
    assert state.image_gen is not None
    assert state.safety_checker is not None
    world_engine = state.world_engine
    image_gen = state.image_gen
    safety_checker = state.safety_checker

    t0 = time.perf_counter()

    generated, sanitized_prompt = image_gen._generate_scene_sync(prompt, world_engine.seed_target_size)

    # Safety check on the generated image
    generated_np = world_engine._tensor_to_numpy(generated)
    generated_pil = Image.fromarray(generated_np)
    safety_result = safety_checker.check_pil_image(generated_pil)
    if not safety_result["is_safe"]:
        logger.warning(f"[GENERATE_SCENE] Safety checker rejected generated image: {safety_result['scores']}")
        raise SafetyRejectionError(GENERATE_SCENE_SAFETY_MESSAGE_ID)

    # Encode the generated image as JPEG so the client can save it to disk.
    # Done before expanding to multiframe so we encode a single HxWx3 frame.
    # Metadata is embedded via a JPEG COM-marker JSON blob — parallel to how
    # video_recorder.py stuffs RecordingProperties into the MP4 comment atom.
    properties = GeneratedSceneProperties(
        biome_version=biome_version or "unknown",
        image_model=EDIT_MODEL_ID,
        user_prompt=prompt,
        sanitized_prompt=sanitized_prompt,
        generated_at=time.time(),
    )
    jpeg_buf = io.BytesIO()
    generated_pil.save(
        jpeg_buf,
        format="JPEG",
        quality=92,
        comment=properties_to_jpeg_comment(properties),
    )
    image_b64 = base64.b64encode(jpeg_buf.getvalue()).decode("ascii")

    # Expand to full temporal_compression for multiframe models
    if world_engine.is_multiframe:
        generated = generated.unsqueeze(0).expand(world_engine.temporal_compression, -1, -1, -1).contiguous()

    # Reset engine with the generated frame as the new seed.
    # Unlike scene_edit, this is a new world — update original_seed_frame
    # so that "reset" returns to the generated scene, not the old seed.
    world_engine.seed_frame = generated
    world_engine.original_seed_frame = generated

    def _reset_with_frame():
        world_engine.engine.reset()
        world_engine.engine.append_frame(generated)
        if world_engine.has_prompt_conditioning:
            world_engine.engine.set_prompt(world_engine.current_prompt)

    world_engine.cuda_executor.submit(_reset_with_frame).result()

    elapsed_ms = (time.perf_counter() - t0) * 1000
    logger.info(f"[GENERATE_SCENE] Complete in {elapsed_ms:.0f}ms")
    return {
        "elapsed_ms": round(elapsed_ms),
        "image_jpeg_base64": image_b64,
        "user_prompt": prompt,
        "sanitized_prompt": sanitized_prompt,
        "image_model": EDIT_MODEL_ID,
    }


def _run_scene_edit_on_generator(state: AppState, prompt: str, cpu_frames: list) -> dict:
    """Run inpainting on the generator thread, append via CUDA executor.

    Takes the last subframe from the most recent gen_frame output,
    inpaints it, expands to a full temporal_compression tensor, submits append_frame
    to the CUDA executor (required for CUDA graph compatibility), and
    returns preview data for the RPC response.
    """
    from PIL import Image

    from image_gen import (
        EDIT_APPEND_COUNT as SCENE_EDIT_APPEND_COUNT,
    )
    from image_gen import (
        EDIT_RESET_WITH_FRAME as SCENE_EDIT_RESET,
    )
    from image_gen import (
        SafetyRejectionError,
    )

    assert state.world_engine is not None
    assert state.image_gen is not None
    assert state.safety_checker is not None
    world_engine = state.world_engine
    image_gen = state.image_gen
    safety_checker = state.safety_checker

    last_frame_np = cpu_frames[-1]

    # Encode original for debug preview
    original_jpeg = world_engine._numpy_to_jpeg(last_frame_np)
    original_b64 = base64.b64encode(original_jpeg).decode("ascii")

    # Run inpainting (diffusers pipeline, not CUDA-graph dependent)
    inpainted, edit_prompt = image_gen._inpaint_sync(last_frame_np, prompt, world_engine.seed_target_size)

    # Encode inpainted for debug preview
    inpainted_np = world_engine._tensor_to_numpy(inpainted)
    preview_jpeg = world_engine._numpy_to_jpeg(inpainted_np)
    preview_b64 = base64.b64encode(preview_jpeg).decode("ascii")

    # Safety check on the inpainted result
    inpainted_pil = Image.fromarray(inpainted_np)
    safety_result = safety_checker.check_pil_image(inpainted_pil)
    if not safety_result["is_safe"]:
        logger.warning(f"[SCENE_EDIT] Safety checker rejected inpainted image: {safety_result['scores']}")
        raise SafetyRejectionError()

    # Expand to full temporal_compression for multiframe models
    if world_engine.is_multiframe:
        inpainted = inpainted.unsqueeze(0).expand(world_engine.temporal_compression, -1, -1, -1).contiguous()

    # Apply the edited frame to the engine on the CUDA executor thread.
    if SCENE_EDIT_RESET:
        # Reset engine with the edited frame as the new seed
        world_engine.seed_frame = inpainted

        def _reset_with_frame():
            world_engine.engine.reset()
            world_engine.engine.append_frame(inpainted)
            if world_engine.has_prompt_conditioning:
                world_engine.engine.set_prompt(world_engine.current_prompt)

        world_engine.cuda_executor.submit(_reset_with_frame).result()
    else:
        # Append repeatedly to strengthen the edit in the KV cache
        def _append_repeated(f=inpainted):
            for _ in range(SCENE_EDIT_APPEND_COUNT):
                world_engine.engine.append_frame(f)

        world_engine.cuda_executor.submit(_append_repeated).result()

    return {
        "original_jpeg_b64": original_b64,
        "preview_jpeg_b64": preview_b64,
        "edit_prompt": edit_prompt,
    }


# ============================================================================
# WorldEngine WebSocket
# ============================================================================


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, state: AppState = Depends(get_app_state_ws)):
    """
    WebSocket endpoint for frame streaming and RPC.

    Protocol:
        Server -> Client:
            {"type": "status", "code": str, "stage": {...}}
            Binary frame: [4-byte LE header_len][JSON header][JPEG bytes]
              Header: {"frame_id": int, "client_ts": float, "gen_ms": float}
            {"type": "error", "message": str}
            {"type": "response", "req_id": str, "success": bool, "data": ..., "error": ...}
            {"type": "log", "line": str, "level": str}

        Client -> Server:
            {"type": "control", "buttons": [str], "mouse_dx": float, "mouse_dy": float, "ts": float}
            {"type": "init", "req_id": "...", "model": str, "seed_image_data": str, "seed_filename": str, "scene_authoring": bool, "action_logging": bool, "quant": str|null}
            {"type": "reset"}
            {"type": "pause"}
            {"type": "resume"}
            # Request/response (includes req_id):
            {"type": "check_seed_safety", "req_id": "...", "image_data": str}

    Status codes: waiting_for_seed, init, loading, ready, reset, warmup, startup
    """
    client_host = websocket.client.host if websocket.client else "unknown"
    logger.info(f"Client connected: {client_host}")

    await websocket.accept()

    async def send_message(msg: BaseModel) -> None:
        await websocket.send_text(msg.model_dump_json(exclude_none=True))

    # Stream log lines to the client. TeeStream captures all stdout/stderr
    # output (including logger output) and pushes complete lines into per-client
    # queues, so logs arrive immediately without file polling.
    log_queue: asyncio.Queue[str] = asyncio.Queue(maxsize=1000)
    loop = asyncio.get_running_loop()

    async def _stream_logs_to_client():
        try:
            # Replay recent log history so the client sees what happened before it connected.
            # Register for live lines only AFTER reading the tail to avoid duplicates.
            initial_lines = _read_log_tail_lines(LOG_TAIL_INITIAL_LINES)
            for line in initial_lines:
                await send_message(LogMessage(line=line))
            TeeStream.register_client(log_queue, loop)

            # Stream new log lines as they arrive from TeeStream.
            while True:
                line = await log_queue.get()
                await send_message(LogMessage(line=line))
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
            await send_message(stage_msg)
        # Stream new stages until startup is done
        while not state.startup_complete:
            try:
                next_msg = await asyncio.wait_for(startup_queue.get(), timeout=1.0)
                if next_msg is None:
                    break
                await send_message(next_msg)
            except TimeoutError:
                continue
        state.ws_startup_waiters.remove(startup_queue)

    if state.startup_error:
        await send_message(
            build_error_message(message_id=MessageId.SERVER_STARTUP_FAILED, message=str(state.startup_error))
        )
        log_tail_task.cancel()
        TeeStream.unregister_client(log_queue)
        await websocket.close()
        return

    # Past the startup gate: these are guaranteed populated by `_heavy_init`.
    # Bind to locals so the rest of this function can use non-Optional types
    # without state.X. attribute prefixes everywhere; step 6 replaces this
    # with an explicit "ready" state machine on AppState.
    assert state.world_engine is not None
    assert state.image_gen is not None
    assert state.safety_checker is not None
    world_engine = state.world_engine
    image_gen = state.image_gen
    safety_checker = state.safety_checker
    safety_hash_cache = state.safety_hash_cache  # mutated in place

    # Push system info immediately so the client has the hardware identity
    # even if the session crashes during init (e.g. CUDA graph compilation).
    await send_message(SystemInfoMessage(**system_info_module.system_info))

    session = Session()
    # Each websocket session must perform an explicit model/seed handshake.
    world_engine.seed_frame = None

    async def send_warning(message_id: MessageId, params: dict[str, str] | None = None) -> None:
        await send_message(WarningMessage(message_id=message_id, params=params))

    async def send_stage(stage: Stage) -> None:
        await send_message(StatusMessage(stage=stage.id))

    # Progress queue: engine_manager calls progress_callback (sync, from CUDA thread)
    # which enqueues payloads; the drain task sends them over the WebSocket.
    progress_queue: asyncio.Queue[StatusMessage] = asyncio.Queue(maxsize=500)

    def progress_callback(stage: Stage) -> None:
        """Sync callback safe to call from any thread — enqueues for async send."""
        try:
            progress_queue.put_nowait(StatusMessage(stage=stage.id))
        except asyncio.QueueFull:
            pass

    async def _drain_progress_queue():
        try:
            while True:
                msg = await progress_queue.get()
                try:
                    await send_message(msg)
                except Exception:
                    break
        except asyncio.CancelledError:
            pass

    progress_drain_task = asyncio.create_task(_drain_progress_queue())

    async def reset_engine():
        # Restore the original seed (before any scene edits) on reset
        if world_engine.original_seed_frame is not None:
            world_engine.seed_frame = world_engine.original_seed_frame
        world_engine.set_progress_callback(progress_callback, asyncio.get_running_loop())
        await world_engine.init_session()
        world_engine.set_progress_callback(None)
        session.perceptual_frame_count = 0
        logger.info(f"[{client_host}] Engine Reset")

    async def load_seed_from_data(image_data_b64: str | None, seed_filename: str | None = None) -> bool:
        """Validate safety and load seed from base64 image data."""
        nonlocal current_seed_hash, current_seed_filename
        if not image_data_b64:
            logger.warning(f"[{client_host}] Missing seed image data")
            await send_warning(MessageId.SEED_MISSING_DATA)
            return False

        try:
            image_bytes = base64.b64decode(image_data_b64)
        except Exception as e:
            logger.warning(f"[{client_host}] Invalid base64 seed data: {e}")
            await send_warning(MessageId.SEED_INVALID_DATA)
            return False

        img_hash = compute_bytes_hash(image_bytes)

        # Check if same seed is already loaded (dedup by hash)
        if img_hash == current_seed_hash:
            logger.info(f"[{client_host}] Seed unchanged (hash match), skipping reload")
            return True

        # Safety check
        if img_hash in safety_hash_cache:
            cached = safety_hash_cache[img_hash]
            if not cached.get("is_safe", False):
                logger.warning(f"[{client_host}] Seed marked as unsafe (cached)")
                await send_warning(MessageId.SEED_UNSAFE)
                return False
        else:
            # Run safety check (decode + inference off the event loop)
            try:

                def _check_safety():
                    pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                    return safety_checker.check_pil_image(pil_img)

                safety_result = await asyncio.to_thread(_check_safety)
            except Exception as e:
                logger.warning(f"[{client_host}] Safety check failed: {e}")
                await send_warning(MessageId.SEED_SAFETY_CHECK_FAILED)
                return False

            is_safe = safety_result.get("is_safe", False)
            safety_hash_cache[img_hash] = {
                "is_safe": is_safe,
                "scores": safety_result.get("scores", {}),
                "checked_at": time.time(),
            }
            save_safety_cache(safety_hash_cache)

            if not is_safe:
                logger.warning(f"[{client_host}] Seed marked as unsafe")
                await send_warning(MessageId.SEED_UNSAFE)
                return False

        # Load seed
        display_name = seed_filename or img_hash[:12]
        logger.info(f"[{client_host}] Loading seed '{display_name}'")
        loaded_frame = await world_engine.load_seed_from_base64(image_data_b64)
        if loaded_frame is None:
            logger.error(f"[{client_host}] Failed to load seed")
            await send_warning(MessageId.SEED_LOAD_FAILED)
            return False

        world_engine.seed_frame = loaded_frame
        world_engine.original_seed_frame = loaded_frame
        current_seed_hash = img_hash
        current_seed_filename = seed_filename
        logger.info(f"[{client_host}] Seed loaded successfully")
        return True

    async def handle_init(req: InitRequest, *, is_game_loop: bool = False) -> tuple[bool, bool]:
        """Handle unified init message — apply deltas for model, seed, flags.
        Returns (ready, seed_loaded): ready=session has a seed frame,
        seed_loaded=a new seed was loaded in this call.

        `model_fields_set` distinguishes "field absent" (leave untouched) from
        "field present, possibly None" (apply update) — preserving the existing
        partial-delta semantics."""
        nonlocal \
            scene_authoring_requested, \
            action_logging_requested, \
            video_recording_requested, \
            video_output_dir, \
            biome_version, \
            action_logger, \
            video_recorder, \
            cap_inference_fps

        present = req.model_fields_set
        model_uri = (req.model or "").strip()
        seed_data = req.seed_image_data
        seed_filename = req.seed_filename
        quant = req.quant

        # Update flags
        if "scene_authoring" in present and req.scene_authoring is not None:
            scene_authoring_requested = req.scene_authoring
        if "action_logging" in present and req.action_logging is not None:
            action_logging_requested = req.action_logging
        if "video_recording" in present and req.video_recording is not None:
            video_recording_requested = req.video_recording
        if "video_output_dir" in present:
            video_output_dir = req.video_output_dir
        if "biome_version" in present:
            biome_version = req.biome_version
        if "cap_inference_fps" in present and req.cap_inference_fps is not None:
            cap_inference_fps = req.cap_inference_fps

        # Sync action logger with requested state during gameplay
        if is_game_loop:
            if action_logging_requested and action_logger is None:
                action_logger = ActionLogger(client_host)
                action_logger.new_segment(
                    model=getattr(world_engine, "model_uri", None),
                    seed=current_seed_filename,
                    temporal_compression=world_engine.temporal_compression,
                    seed_target_size=world_engine.seed_target_size,
                    has_prompt_conditioning=getattr(world_engine, "has_prompt_conditioning", False),
                )
                logger.info(f"[{client_host}] Action logging enabled")
            elif not action_logging_requested and action_logger is not None:
                action_logger.end_segment()
                action_logger = None
                logger.info(f"[{client_host}] Action logging disabled")

            if video_recording_requested and video_recorder is None:
                _video_recorder_new_segment()
                logger.info(f"[{client_host}] Video recording enabled")
            elif not video_recording_requested and video_recorder is not None:
                video_recorder.end_segment()
                video_recorder = None
                logger.info(f"[{client_host}] Video recording disabled")

        # Model delta — reload if model URI or quantization changed.
        # The engine must be loaded before the seed so that seed_target_size
        # and temporal_compression are resolved from the actual model config.
        model_changed = False
        quant_changed = "quant" in present and quant != getattr(world_engine, "quant", None)
        if model_uri and (model_uri != getattr(world_engine, "model_uri", None) or quant_changed):
            logger.info(
                f"[{client_host}] {'Live model switch' if is_game_loop else 'Requested model'}: {model_uri} (quant={quant})"
            )
            world_engine.set_progress_callback(progress_callback, asyncio.get_running_loop())
            await world_engine.load_engine(model_uri, quant=quant)
            world_engine.set_progress_callback(None)
            world_engine.seed_frame = None
            session.perceptual_frame_count = 0
            session.max_perceptual_frames = (world_engine.n_frames - 2) * world_engine.temporal_compression
            model_changed = True
            logger.info(f"[{client_host}] Model loaded: {world_engine.model_uri}")

        # Seed delta
        seed_loaded = False
        if seed_data:
            seed_loaded = await load_seed_from_data(seed_data, seed_filename)

        if model_changed and not seed_loaded and not world_engine.seed_frame:
            await send_stage(SESSION_WAITING_FOR_SEED)

        ready = seed_loaded or (world_engine.seed_frame is not None)
        return ready, seed_loaded

    scene_authoring_requested = False
    action_logging_requested = False
    video_recording_requested = False
    video_output_dir: str | None = None
    biome_version: str | None = None
    cap_inference_fps = True
    action_logger: ActionLogger | None = None
    video_recorder: VideoRecorder | None = None
    current_seed_hash: str | None = None
    current_seed_filename: str | None = None

    init_req_id: str | None = None

    try:
        await send_stage(SESSION_WAITING_FOR_SEED)
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
                        init_req_id = req.req_id
                        ready, _ = await handle_init(req)
                        if not ready:
                            await websocket.send_text(
                                rpc_err(init_req_id, error_id=MessageId.INIT_FAILED).model_dump_json(exclude_none=True)
                            )
                            init_req_id = None
                    case SceneEditRequest() | GenerateSceneRequest():
                        # Authoring RPCs require an active session.
                        await websocket.send_text(
                            rpc_err(parsed.req_id, error_id=MessageId.INIT_FAILED).model_dump_json(exclude_none=True)
                        )
                    case ControlNotif() | PauseNotif() | ResumeNotif() | ResetNotif() | PromptNotif():
                        logger.info(f"[{client_host}] Ignoring notification '{parsed.type}' while waiting for init")

            except TimeoutError:
                logger.error(f"[{client_host}] Timeout waiting for init")
                await send_message(build_error_message(message_id=MessageId.TIMEOUT_WAITING_FOR_SEED))
                return

        # Wire progress callback so engine_manager reports granular stages
        world_engine.set_progress_callback(progress_callback, asyncio.get_running_loop())

        assert world_engine.engine is not None, "Client must specify a model in the init message"

        if world_engine.seed_frame is None:
            logger.info(
                f"[{client_host}] Seed frame missing before initialization; client likely disconnected/reconnected during model switch"
            )
            world_engine.set_progress_callback(None)
            if init_req_id:
                await send_message(rpc_err(init_req_id, error_id=MessageId.INIT_FAILED))
            return

        # Load or unload scene authoring model based on flag.
        # Loading happens BEFORE WorldEngine warmup so CUDA graphs
        # are compiled with the model's memory already allocated.
        if not scene_authoring_requested and image_gen is not None and image_gen.is_loaded:
            logger.info(f"[{client_host}] Scene authoring disabled — unloading model")
            await asyncio.to_thread(image_gen.unload)

        if scene_authoring_requested and image_gen is not None and not image_gen.is_loaded:
            await send_stage(SESSION_INPAINTING_LOAD)
            try:
                await image_gen.warmup()
                await send_stage(SESSION_INPAINTING_READY)
            except Exception as e:
                logger.error(f"[{client_host}] Scene authoring warmup failed: {e}", exc_info=True)
                await send_message(
                    build_error_message(message_id=MessageId.SCENE_AUTHORING_MODEL_LOAD_FAILED, message=str(e))
                )
                if init_req_id:
                    await send_message(rpc_err(init_req_id, error_id=MessageId.SCENE_AUTHORING_MODEL_LOAD_FAILED))
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
                    await send_message(
                        build_error_message(
                            message_id=MessageId.QUANT_UNSUPPORTED_GPU,
                            params={"quant": world_engine.quant or "unknown"},
                        )
                    )
                    return
                raise

        # Init session (reset, seed, prompt) with granular progress
        await world_engine.init_session()

        # Send initial frame so client has something to display
        initial_display_frame = world_engine.seed_frame[0] if world_engine.is_multiframe else world_engine.seed_frame
        jpeg = await asyncio.to_thread(world_engine.frame_to_jpeg, initial_display_frame)
        header = json.dumps(
            {"frame_id": 0, "client_ts": 0, "gen_ms": 0},
            separators=(",", ":"),
        ).encode("utf-8")
        await websocket.send_bytes(struct.pack("<I", len(header)) + header + jpeg)

        world_engine.set_progress_callback(None)
        await send_stage(SESSION_READY)
        logger.info(f"[{client_host}] Ready for game loop")

        action_logger = ActionLogger(client_host) if action_logging_requested else None

        def _video_recorder_new_segment() -> None:
            """Ensure the video recorder exists when recording is requested,
            then start a new segment with the current session's metadata."""
            nonlocal video_recorder
            if not video_recording_requested:
                return
            if video_recorder is None:
                video_recorder = VideoRecorder(client_host, output_dir=video_output_dir)
            video_recorder.new_segment(
                width=world_engine.seed_target_size[1],
                height=world_engine.seed_target_size[0],
                fps=int(world_engine.inference_fps),
                properties=RecordingProperties(
                    biome_version=biome_version or "unknown",
                    model=getattr(world_engine, "model_uri", None),
                    quant=getattr(world_engine, "quant", None) or "none",
                    seed=current_seed_filename,
                    scene_authoring_enabled=scene_authoring_requested,
                ),
            )

        def _video_recorder_end_segment() -> None:
            if video_recorder is not None:
                video_recorder.end_segment()

        def _action_logger_new_segment() -> None:
            if action_logger is not None:
                action_logger.new_segment(
                    model=getattr(world_engine, "model_uri", None),
                    seed=current_seed_filename,
                    temporal_compression=world_engine.temporal_compression,
                    seed_target_size=world_engine.seed_target_size,
                    has_prompt_conditioning=getattr(world_engine, "has_prompt_conditioning", False),
                )

        def _action_logger_end_segment() -> None:
            if action_logger is not None:
                action_logger.end_segment()

        _action_logger_new_segment()
        _video_recorder_new_segment()

        running = True
        paused = False
        reset_flag = False
        prompt_pending: str | None = None
        # Scene edit: receiver posts a prompt + future, generator picks it up
        # after the current gen_frame, runs inpainting on the last subframe,
        # appends the result, and resolves the future with preview data.
        scene_edit_request: dict | None = None  # {"prompt": str, "future": concurrent.futures.Future}
        generate_scene_request: dict | None = None  # {"prompt": str, "future": concurrent.futures.Future}
        last_generated_cpu_frames = None  # Most recent CPU numpy frames for scene editing (list)
        ctrl_state = {
            "buttons": set(),
            "mouse_dx": 0.0,
            "mouse_dy": 0.0,
            "client_ts": 0,
            "dirty": False,
        }
        ctrl_lock = threading.Lock()
        frame_queue: Queue[BaseModel | bytes] = Queue(maxsize=16)
        frame_ready = asyncio.Event()
        main_loop = asyncio.get_running_loop()

        def queue_send(payload: BaseModel | bytes) -> None:
            try:
                frame_queue.put_nowait(payload)
                main_loop.call_soon_threadsafe(frame_ready.set)
            except Exception:
                pass

        # Cached dynamic GPU metrics, updated each latent pass and embedded in
        # frame headers.  Static identifiers (GPU/CPU name, VRAM total) live
        # in system_info and are sent once via the init response.
        _cached_gpu_metrics = {
            "vram_used_bytes": -1,
            "gpu_util_percent": -1,
        }

        def _update_gpu_metrics() -> None:
            _cached_gpu_metrics["vram_used_bytes"] = system_info_module.get_vram_used_bytes()
            _cached_gpu_metrics["gpu_util_percent"] = system_info_module.get_gpu_util_percent()

        def build_binary_frame(
            jpeg: bytes,
            frame_id: int,
            client_ts: float,
            gen_ms: float,
            temporal_compression: int = 1,
            profile: dict | None = None,
        ) -> bytes:
            header_data = {
                "frame_id": frame_id,
                "client_ts": client_ts,
                "gen_ms": gen_ms,
                "temporal_compression": temporal_compression,
            }
            header_data.update(_cached_gpu_metrics)
            if profile is not None:
                header_data.update(profile)
            header = json.dumps(header_data, separators=(",", ":")).encode("utf-8")
            return struct.pack("<I", len(header)) + header + jpeg

        def build_init_response_data() -> InitResponseData:
            from engine_manager import DEFAULT_INFERENCE_FPS

            return InitResponseData(
                model=getattr(world_engine, "model_uri", "") or "",
                inference_fps=getattr(world_engine, "inference_fps", DEFAULT_INFERENCE_FPS),
                system_info=SystemInfo(**system_info_module.system_info),
            )

        # Respond to init RPC with session metrics
        if init_req_id:
            await send_message(rpc_ok(init_req_id, build_init_response_data()))
            init_req_id = None

        async def receiver() -> None:
            nonlocal running, paused, reset_flag, prompt_pending, scene_edit_request, generate_scene_request
            while running:
                try:
                    raw = await websocket.receive_text()
                    try:
                        parsed: ClientMessage = ClientMessageAdapter.validate_json(raw)
                    except Exception as e:
                        logger.info(f"[{client_host}] Ignoring invalid game-loop message: {e}")
                        continue

                    match parsed:
                        case InitRequest() as req:
                            # init RPC: apply deltas and respond with metrics.
                            ready, new_seed = await handle_init(req, is_game_loop=True)
                            if ready:
                                response = rpc_ok(req.req_id, build_init_response_data())
                            else:
                                response = rpc_err(req.req_id, error_id=MessageId.INIT_FAILED)
                            queue_send(response)
                            if new_seed:
                                reset_flag = True

                        case SceneEditRequest() as req:
                            # scene_edit is handled by the generator thread at
                            # the next clean frame boundary — post a request and
                            # await the future.
                            prompt = req.prompt.strip()
                            if action_logger is not None:
                                action_logger.scene_edit(prompt)
                            if not prompt:
                                edit_response: RpcSuccess[SceneEditResponseData] | RpcError = rpc_err(
                                    req.req_id, error_id=MessageId.SCENE_AUTHORING_EMPTY_PROMPT
                                )
                            elif image_gen is None or not image_gen.is_loaded:
                                edit_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_MODEL_NOT_LOADED)
                            elif scene_edit_request is not None:
                                edit_response = rpc_err(
                                    req.req_id, error_id=MessageId.SCENE_AUTHORING_ALREADY_IN_PROGRESS
                                )
                            else:
                                import concurrent.futures

                                fut = concurrent.futures.Future()
                                scene_edit_request = {"prompt": prompt, "future": fut}
                                try:
                                    preview = await asyncio.wrap_future(fut)
                                    # Generator thread still resolves the future with a dict;
                                    # step 5 (scene_authoring extraction) types it directly.
                                    edit_response = rpc_ok(req.req_id, SceneEditResponseData(**preview))
                                except Exception as e:
                                    error_id = getattr(e, "message_id", None)
                                    if error_id is not None:
                                        edit_response = rpc_err(req.req_id, error_id=MessageId(error_id))
                                    else:
                                        edit_response = rpc_err(req.req_id, error=str(e))
                            queue_send(edit_response)

                        case GenerateSceneRequest() as req:
                            # generate_scene: like scene_edit but with a blank
                            # canvas — generates a new seed from a text prompt.
                            prompt = req.prompt.strip()
                            if not prompt:
                                gen_response: RpcSuccess[GenerateSceneResponseData] | RpcError = rpc_err(
                                    req.req_id, error_id=MessageId.SCENE_AUTHORING_EMPTY_PROMPT
                                )
                            elif image_gen is None or not image_gen.is_loaded:
                                gen_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_MODEL_NOT_LOADED)
                            elif scene_edit_request is not None or generate_scene_request is not None:
                                gen_response = rpc_err(
                                    req.req_id, error_id=MessageId.SCENE_AUTHORING_ALREADY_IN_PROGRESS
                                )
                            else:
                                import concurrent.futures

                                fut = concurrent.futures.Future()
                                generate_scene_request = {"prompt": prompt, "future": fut}
                                try:
                                    data = await asyncio.wrap_future(fut)
                                    gen_response = rpc_ok(req.req_id, GenerateSceneResponseData(**data))
                                except Exception as e:
                                    error_id = getattr(e, "message_id", None)
                                    if error_id is not None:
                                        gen_response = rpc_err(req.req_id, error_id=MessageId(error_id))
                                    else:
                                        gen_response = rpc_err(req.req_id, error=str(e))
                            queue_send(gen_response)

                        case CheckSeedSafetyRequest() as req:
                            seed_response = await handle_check_seed_safety(state, req)
                            queue_send(seed_response)

                        case ResetNotif():
                            logger.info(f"[{client_host}] Reset requested")
                            reset_flag = True

                        case PauseNotif():
                            paused = True
                            logger.info("[RECV] Paused")

                        case ResumeNotif():
                            paused = False
                            logger.info("[RECV] Resumed")

                        case PromptNotif() as notif:
                            from engine_manager import DEFAULT_PROMPT

                            new_prompt = notif.prompt.strip()
                            prompt_pending = new_prompt if new_prompt else DEFAULT_PROMPT

                        case ControlNotif() as notif:
                            if paused:
                                continue
                            if notif.button_codes is not None:
                                buttons = set(notif.button_codes)
                            else:
                                buttons = {
                                    BUTTON_CODES[b.upper()] for b in (notif.buttons or []) if b.upper() in BUTTON_CODES
                                }
                            with ctrl_lock:
                                ctrl_state["buttons"] = buttons
                                ctrl_state["mouse_dx"] += notif.mouse_dx
                                ctrl_state["mouse_dy"] += notif.mouse_dy
                                if notif.ts is not None:
                                    ctrl_state["client_ts"] = notif.ts
                                ctrl_state["dirty"] = True

                except WebSocketDisconnect:
                    logger.info(f"[{client_host}] Client disconnected")
                    running = False
                    break
                except Exception as e:
                    logger.error(f"[{client_host}] Receiver error: {e}", exc_info=True)
                    running = False
                    break

        async def sender() -> None:
            nonlocal running
            while running:
                try:
                    # Wait for signal from generator thread instead of polling
                    await frame_ready.wait()
                    frame_ready.clear()
                    # Drain all available frames in one batch
                    while not frame_queue.empty():
                        payload = frame_queue.get_nowait()
                        if isinstance(payload, bytes):
                            await websocket.send_bytes(payload)
                        else:
                            await send_message(payload)
                except Exception as e:
                    logger.error(f"[{client_host}] Sender error: {e}", exc_info=True)
                    running = False
                    break

        def generator() -> None:
            nonlocal \
                running, \
                paused, \
                reset_flag, \
                prompt_pending, \
                scene_edit_request, \
                generate_scene_request, \
                last_generated_cpu_frames

            def run_coro(coro):
                return asyncio.run_coroutine_threadsafe(coro, main_loop).result()

            def _flush_pending():
                """JPEG-encode + queue pending CPU frames."""
                if not _flush_pending.work:
                    return
                cpu_frames, gen_time, temporal_compression, client_ts, t_infer_start, t_infer, t_sync = (
                    _flush_pending.work
                )
                _flush_pending.work = None

                t_enc_start = time.perf_counter()
                encoded = [world_engine._numpy_to_jpeg(rgb) for rgb in cpu_frames]
                t_enc = time.perf_counter()

                if session.perceptual_frame_count % 5 == 0:
                    _update_gpu_metrics()
                t_metrics = time.perf_counter()

                for jpeg in encoded:
                    session.perceptual_frame_count += 1
                    t_queued = time.perf_counter()
                    profile = {
                        "t_infer_ms": round((t_infer - t_infer_start) * 1000, 1),
                        "t_sync_ms": round((t_sync - t_infer) * 1000, 1),
                        "t_enc_ms": round((t_enc - t_enc_start) * 1000, 1),
                        "t_metrics_ms": round((t_metrics - t_enc) * 1000, 1),
                        "t_overhead_ms": round((t_queued - t_metrics) * 1000, 1),
                    }
                    queue_send(
                        build_binary_frame(
                            jpeg,
                            session.perceptual_frame_count,
                            client_ts,
                            gen_time,
                            temporal_compression=temporal_compression,
                            profile=profile,
                        )
                    )

                if session.perceptual_frame_count % 60 == 0:
                    logger.info(f"[{client_host}] Sent frame {session.perceptual_frame_count} (gen={gen_time:.1f}ms)")

            _flush_pending.work = None
            _gen_was_paused = False
            next_frame_time = 0.0  # perf_counter target for frame pacing

            while running:
                if paused:
                    _flush_pending()
                    if not _gen_was_paused:
                        _action_logger_end_segment()
                        _video_recorder_end_segment()
                        _gen_was_paused = True

                    # Handle generate_scene while paused (it's triggered from
                    # the pause menu, so the generator must process it here).
                    if generate_scene_request is not None:
                        req = generate_scene_request
                        generate_scene_request = None
                        try:
                            data = _run_generate_scene_on_generator(state, req["prompt"], biome_version)
                            session.perceptual_frame_count = 0
                            req["future"].set_result(data)
                            # Send the generated seed as a single frame so the
                            # pause overlay background updates to show the new scene.
                            seed = world_engine.seed_frame
                            if seed.dim() == 4:
                                seed = seed[0]  # First subframe for multiframe models
                            seed_jpeg = world_engine.frame_to_jpeg(seed)
                            queue_send(build_binary_frame(seed_jpeg, session.perceptual_frame_count, 0.0, 0.0))
                        except Exception as e:
                            logger.error(f"[GENERATE_SCENE] Failed: {e}", exc_info=True)
                            req["future"].set_exception(e)

                    time.sleep(0.01)
                    next_frame_time = 0.0
                    continue

                if _gen_was_paused:
                    _gen_was_paused = False
                    _action_logger_new_segment()
                    _video_recorder_new_segment()

                try:
                    # Start frame timer before pacing sleep so gen_time
                    # reflects actual frame-to-frame throughput.
                    t0 = time.perf_counter()

                    # Frame pacing: sleep until target time, just before
                    # reading input, so we use the freshest controls.
                    if cap_inference_fps and next_frame_time > 0.0:
                        sleep_time = next_frame_time - time.perf_counter()
                        if sleep_time > 0.001:
                            time.sleep(sleep_time)

                    if prompt_pending is not None:
                        _flush_pending()
                        world_engine.current_prompt = prompt_pending
                        prompt_pending = None
                        run_coro(reset_engine())
                        _action_logger_new_segment()
                        _video_recorder_new_segment()
                        next_frame_time = 0.0

                    # Auto-reset at context length limit (single-frame models only;
                    # multiframe models don't support mid-session reset).
                    auto_reset = (
                        not world_engine.is_multiframe
                        and session.perceptual_frame_count >= session.max_perceptual_frames
                    )
                    if reset_flag or auto_reset:
                        _flush_pending()
                        if auto_reset:
                            logger.info(f"[{client_host}] Auto-reset at frame limit")
                        run_coro(reset_engine())
                        reset_flag = False
                        _action_logger_new_segment()
                        _video_recorder_new_segment()
                        next_frame_time = 0.0

                    # Handle pending scene edit — runs inpainting on the last
                    # subframe from the most recent gen_frame, then appends.
                    if scene_edit_request is not None and last_generated_cpu_frames is not None:
                        req = scene_edit_request
                        scene_edit_request = None
                        _flush_pending()
                        try:
                            preview = _run_scene_edit_on_generator(state, req["prompt"], last_generated_cpu_frames)
                            session.perceptual_frame_count = 0
                            if video_recorder is not None:
                                video_recorder.note_edit(req["prompt"])
                            req["future"].set_result(preview)
                        except Exception as e:
                            logger.error(f"[SCENE_EDIT] Failed: {e}", exc_info=True)
                            req["future"].set_exception(e)

                    # Handle pending generate_scene — creates a new seed from
                    # a text prompt (blank canvas + inpainting pipeline).
                    if generate_scene_request is not None:
                        req = generate_scene_request
                        generate_scene_request = None
                        _flush_pending()
                        try:
                            data = _run_generate_scene_on_generator(state, req["prompt"], biome_version)
                            session.perceptual_frame_count = 0
                            req["future"].set_result(data)
                        except Exception as e:
                            logger.error(f"[GENERATE_SCENE] Failed: {e}", exc_info=True)
                            req["future"].set_exception(e)

                    with ctrl_lock:
                        if not ctrl_state["dirty"]:
                            buttons = None
                        else:
                            buttons = set(ctrl_state["buttons"])
                            mouse_dx = float(ctrl_state["mouse_dx"])
                            mouse_dy = float(ctrl_state["mouse_dy"])
                            client_ts = ctrl_state["client_ts"]
                            ctrl_state["mouse_dx"] = 0.0
                            ctrl_state["mouse_dy"] = 0.0
                            ctrl_state["dirty"] = False

                    if buttons is None:
                        _flush_pending()
                        time.sleep(0.001)
                        continue

                    ctrl = world_engine.CtrlInput(button=buttons, mouse=(mouse_dx, mouse_dy))

                    if action_logger is not None:
                        action_logger.frame_input(
                            buttons=buttons,
                            mouse_dx=mouse_dx,
                            mouse_dy=mouse_dy,
                            client_ts=client_ts,
                        )

                    # client_ts is a performance.now() timestamp from the browser;
                    # we can't compare clocks, but we CAN forward it so the client
                    # can measure the full round-trip on its own clock.
                    t_infer_start = time.perf_counter()

                    # Advance frame pacing target for next iteration.
                    if cap_inference_fps:
                        fps = world_engine.inference_fps
                        if fps > 0:
                            frame_interval = world_engine.temporal_compression / fps
                            if next_frame_time == 0.0:
                                next_frame_time = t_infer_start + frame_interval
                            else:
                                next_frame_time = max(t_infer_start, next_frame_time) + frame_interval

                    # Submit inference to CUDA thread (non-blocking) so we can
                    # overlap JPEG encoding of the previous batch with GPU work.
                    gpu_future = world_engine.cuda_executor.submit(lambda c=ctrl: world_engine.engine.gen_frame(ctrl=c))

                    # Encode + send previous batch while GPU is busy
                    _flush_pending()

                    # Wait for GPU result
                    result = gpu_future.result()
                    t_infer = time.perf_counter()

                    if torch.cuda.is_available():
                        torch.cuda.synchronize()
                    t_sync = time.perf_counter()

                    gen_time = (t_sync - t0) * 1000
                    temporal_compression = world_engine.temporal_compression

                    # Transfer result tensors to CPU numpy arrays immediately
                    # while the data is still valid (gen_frame may reuse GPU
                    # buffers on the next call).
                    if temporal_compression > 1:
                        cpu_frames = [world_engine._tensor_to_numpy(result[i]) for i in range(result.shape[0])]
                    else:
                        cpu_frames = [world_engine._tensor_to_numpy(result)]

                    # Keep all subframes for scene editing (read by receiver thread)
                    last_generated_cpu_frames = cpu_frames

                    if video_recorder is not None:
                        video_recorder.write_frames(cpu_frames)

                    # Stash this batch's CPU frames for deferred JPEG encoding
                    _flush_pending.work = (
                        cpu_frames,
                        gen_time,
                        temporal_compression,
                        client_ts,
                        t_infer_start,
                        t_infer,
                        t_sync,
                    )

                except Exception as cuda_err:
                    _flush_pending.work = None

                    error_msg = str(cuda_err)
                    is_cuda_error = any(
                        keyword in error_msg.lower()
                        for keyword in ["cuda", "cublas", "graph capture", "offset increment"]
                    )

                    if is_cuda_error:
                        logger.error(f"[{client_host}] CUDA error detected: {cuda_err}")
                        try:
                            recovery_success = run_coro(world_engine.recover_from_cuda_error())
                        except Exception:
                            recovery_success = False

                        if recovery_success:
                            queue_send(
                                StatusMessage(
                                    stage="session.reset",
                                    message="Recovered from CUDA error - engine reset",
                                )
                            )
                            logger.info(f"[{client_host}] Successfully recovered from CUDA error")
                        else:
                            queue_send(build_error_message(message_id=MessageId.CUDA_RECOVERY_FAILED))
                            logger.error(f"[{client_host}] Failed to recover from CUDA error")
                            running = False
                            break
                    else:
                        logger.error(f"[{client_host}] Generation error: {cuda_err}", exc_info=True)
                        queue_send(build_error_message(message=str(cuda_err)))
                        running = False
                        break

            # Flush the last batch before the thread exits
            try:
                _flush_pending()
            except Exception:
                pass

        gen_thread = threading.Thread(target=generator, daemon=True, name=f"gen-{client_host}")
        gen_thread.start()

        recv_task = asyncio.create_task(receiver())
        send_task = asyncio.create_task(sender())
        done, pending = await asyncio.wait(
            [recv_task, send_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        running = False
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
                await send_message(build_error_message(message=str(e)))
            except Exception:
                pass
    finally:
        log_tail_task.cancel()
        TeeStream.unregister_client(log_queue)
        progress_drain_task.cancel()
        world_engine.set_progress_callback(None)
        if action_logger is not None:
            action_logger.end_segment()
        if video_recorder is not None:
            video_recorder.end_segment()
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

    if args.parent_pid is not None:
        _parent_pid = args.parent_pid
        logger.info(f"Monitoring parent process PID {_parent_pid}")
        _check_parent_alive()

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
