"""
Biome <> Python Communication Bridge

Low-latency WebSocket server that orchestrates WorldEngine and Safety modules.
This server acts as a unified interface for both world generation and safety checking.

Usage:
    python server.py --host 0.0.0.0 --port 7987

Client connects via WebSocket to ws://localhost:7987/ws
"""

from server_logging import TeeStream, SERVER_LOG_FILE, logger  # noqa: E402 — must be first

import sys

logger.info(f"Python {sys.version}")
logger.info("Starting server...")

import asyncio
import base64
import hashlib
import json
import os
import pickle
import struct
import threading
import time
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from queue import Empty, Queue
from typing import Optional, TypedDict

from action_logger import ActionLogger
from progress_stages import (
    Stage,
    STARTUP_BEGIN,
    STARTUP_ENGINE_MANAGER,
    STARTUP_SAFETY_CHECKER,
    STARTUP_SAFETY_READY,
    STARTUP_READY,
    SESSION_WAITING_FOR_SEED,
    SESSION_INPAINTING_LOAD,
    SESSION_INPAINTING_READY,
    SESSION_READY,
)

# ---------------------------------------------------------------------------

from huggingface_hub import model_info as hf_model_info
from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

# Resolve HuggingFace token: env var > CLI-cached token file.
# Biome overrides HF_HOME to keep model cache inside world_engine/, which means
# the huggingface_hub library won't find the user's default token at
# ~/.cache/huggingface/token. We check multiple locations to match the Electron
# side's resolution order.


def resolve_hf_token() -> Optional[str]:
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
_parent_pid: Optional[int] = None


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

    logger.info("Importing torchvision...")
    import torchvision

    logger.info(f"torchvision {torchvision.__version__} imported")

    logger.info("Importing PIL...")
    from PIL import Image

    logger.info("PIL imported")

    logger.info("Importing FastAPI...")
    import uvicorn
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import JSONResponse

    logger.info("FastAPI imported")

    logger.info("Importing Engine Manager module...")
    from engine_manager import WorldEngineManager, Session, BUTTON_CODES

    logger.info("Engine Manager module imported")

    logger.info("Importing Safety module...")
    from safety import SafetyChecker

    logger.info("Safety module imported")

except Exception as e:
    logger.fatal(f"Import failed: {e}", exc_info=True)
    sys.exit(1)

# ============================================================================
# Global Module Instances
# ============================================================================

world_engine = None
inpainting_manager = None
safety_checker = None
safety_hash_cache: dict[str, "SafetyCacheEntry"] = {}

# ============================================================================
# Startup state — shared between lifespan background task and WS clients
# ============================================================================

startup_complete: bool = False
startup_error: Optional[str] = None
startup_stages: list[dict] = []  # accumulated stage messages
# WS clients waiting for startup progress register a Queue here
ws_startup_waiters: list[asyncio.Queue] = []

LOG_TAIL_INITIAL_LINES = 220


def _read_log_tail_lines(max_lines: int) -> list[str]:
    """Read last non-empty lines from the canonical server log file."""
    if max_lines <= 0:
        return []
    try:
        with open(SERVER_LOG_FILE, "r", encoding="utf-8", errors="replace") as fp:
            lines = [line.rstrip("\r\n") for line in fp if line.strip()]
        return lines[-max_lines:]
    except Exception:
        return []

# ============================================================================
# Safety Cache
# ============================================================================


class SafetyCacheEntry(TypedDict):
    is_safe: bool
    scores: dict
    checked_at: float


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


def _broadcast_startup_stage(stage: Stage) -> None:
    """Store a startup stage and push it to any connected WS clients."""
    payload = {
        "type": "status",
        "stage": stage.id,
    }
    startup_stages.append(payload)
    # Also log to stdout so file-based logs capture it
    logger.info(f"Startup stage: {stage.id}")
    for q in list(ws_startup_waiters):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


# ============================================================================
# Application Lifecycle
# ============================================================================


async def _heavy_init() -> None:
    """Run heavy startup work (safety warmup, seed validation) in background."""
    global world_engine, inpainting_manager, safety_checker, safety_hash_cache, startup_complete, startup_error

    try:
        _broadcast_startup_stage(STARTUP_BEGIN)

        # Initialize modules
        logger.info("Initializing WorldEngine...")
        _broadcast_startup_stage(STARTUP_ENGINE_MANAGER)
        world_engine = WorldEngineManager()

        from inpainting_manager import InpaintingManager
        inpainting_manager = InpaintingManager(world_engine.cuda_executor)

        logger.info("Initializing Safety Checker...")
        _broadcast_startup_stage(STARTUP_SAFETY_CHECKER)
        safety_checker = SafetyChecker()
        await asyncio.to_thread(safety_checker.load_resident, "cuda")
        logger.info("Safety Checker loaded on GPU")
        _broadcast_startup_stage(STARTUP_SAFETY_READY)

        # Load hash-based safety cache
        safety_hash_cache = load_safety_cache()

        logger.info("=" * 60)
        logger.info("[SERVER] Ready - Safety loaded, WorldEngine will load on first client")
        logger.info(f"[SERVER] {len(safety_hash_cache)} safety cache entries")
        logger.info("=" * 60)
        _broadcast_startup_stage(STARTUP_READY)

        startup_complete = True

        # Signal all waiters that startup is done
        for q in list(ws_startup_waiters):
            try:
                q.put_nowait({"type": "_startup_done"})
            except asyncio.QueueFull:
                pass

    except Exception as exc:
        startup_error = str(exc)
        logger.error(f"[SERVER] Startup failed: {exc}", exc_info=True)
        startup_complete = True  # mark done so waiters unblock
        for q in list(ws_startup_waiters):
            try:
                q.put_nowait({"type": "_startup_done"})
            except asyncio.QueueFull:
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle handler."""
    logger.info("=" * 60)
    logger.info("BIOME SERVER STARTUP")
    logger.info("=" * 60)

    # Start heavy init in background so /health responds immediately
    init_task = asyncio.create_task(_heavy_init())

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
async def health():
    """Health check for Biome backend."""
    return JSONResponse(
        {
            "status": "ok",
            "startup_complete": startup_complete,
            "world_engine": {
                "loaded": world_engine is not None and world_engine.engine is not None,
                "warmed_up": world_engine is not None and world_engine.engine_warmed_up,
                "has_seed": world_engine is not None and world_engine.seed_frame is not None,
            },
            "safety": {"loaded": safety_checker is not None and safety_checker.model is not None},
        }
    )


@app.get("/api/model-info/{model_id:path}")
async def get_model_info(model_id: str):
    """Fetch model metadata from HuggingFace Hub."""
    def _fetch():
        info = hf_model_info(model_id, files_metadata=True)
        size_bytes = None
        if hasattr(info, "siblings") and info.siblings:
            st_files = [s for s in info.siblings if s.rfilename.endswith(".safetensors") and s.size is not None]
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
# WS Request/Response Dispatch
# ============================================================================


class BinaryResponse:
    """Sentinel for RPC handlers that return raw binary data instead of JSON."""
    __slots__ = ("image_bytes",)

    def __init__(self, image_bytes: bytes):
        self.image_bytes = image_bytes


async def dispatch_request(msg: dict, websocket: WebSocket) -> dict | BinaryResponse:
    """Route a request-type WS message to the appropriate handler.

    Returns a response dict (without type/req_id — caller wraps those),
    or a BinaryResponse for image data.
    """
    req_type = msg.get("type", "")

    if req_type == "check_seed_safety":
        return await _handle_check_seed_safety(msg)
    else:
        return {"success": False, "error": f"Unknown request type: {req_type}"}


# ---- individual request handlers ----


async def _handle_check_seed_safety(msg: dict) -> dict:
    """Check if a seed image is safe. Server computes hash, caches result."""
    image_data_b64 = msg.get("image_data", "")
    if not image_data_b64:
        return {"success": False, "error": "image_data is required"}

    try:
        image_bytes = base64.b64decode(image_data_b64)
    except Exception as e:
        return {"success": False, "error": f"Invalid base64 data: {e}"}

    img_hash = compute_bytes_hash(image_bytes)

    # Check cache first
    if img_hash in safety_hash_cache:
        cached = safety_hash_cache[img_hash]
        return {"success": True, "data": {"is_safe": cached["is_safe"], "hash": img_hash}}

    # Run safety check (decode + inference off the event loop)
    import io
    try:
        def _check_safety():
            pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            return safety_checker.check_pil_image(pil_img)
        safety_result = await asyncio.to_thread(_check_safety)
    except Exception as e:
        logger.error(f"Safety check failed: {e}")
        return {"success": False, "error": f"Safety check failed: {e}"}

    is_safe = safety_result.get("is_safe", False)
    safety_hash_cache[img_hash] = {
        "is_safe": is_safe,
        "scores": safety_result.get("scores", {}),
        "checked_at": time.time(),
    }
    save_safety_cache(safety_hash_cache)

    return {"success": True, "data": {"is_safe": is_safe, "hash": img_hash}}



def _run_scene_edit_on_generator(prompt: str, cpu_frames: list) -> dict:
    from inpainting_manager import EDIT_APPEND_COUNT as SCENE_EDIT_APPEND_COUNT
    from inpainting_manager import EDIT_RESET_WITH_FRAME as SCENE_EDIT_RESET
    """Run inpainting on the generator thread, append via CUDA executor.

    Takes the last subframe from the most recent gen_frame output,
    inpaints it, expands to a full n_frames tensor, submits append_frame
    to the CUDA executor (required for CUDA graph compatibility), and
    returns preview data for the RPC response.
    """
    import base64
    from PIL import Image

    last_frame_np = cpu_frames[-1]

    # Encode original for debug preview
    original_jpeg = world_engine._numpy_to_jpeg(last_frame_np)
    original_b64 = base64.b64encode(original_jpeg).decode("ascii")

    # Run inpainting (diffusers pipeline, not CUDA-graph dependent)
    inpainted, edit_prompt = inpainting_manager._inpaint_sync(
        last_frame_np, prompt, world_engine.seed_target_size
    )

    # Encode inpainted for debug preview
    inpainted_np = world_engine._tensor_to_numpy(inpainted)
    preview_jpeg = world_engine._numpy_to_jpeg(inpainted_np)
    preview_b64 = base64.b64encode(preview_jpeg).decode("ascii")

    # Safety check on the inpainted result
    from inpainting_manager import SafetyRejectionError
    inpainted_pil = Image.fromarray(inpainted_np)
    safety_result = safety_checker.check_pil_image(inpainted_pil)
    if not safety_result["is_safe"]:
        logger.warning(
            f"[SCENE_EDIT] Safety checker rejected inpainted image: {safety_result['scores']}"
        )
        raise SafetyRejectionError()

    # Expand to full n_frames for multiframe models
    if world_engine.is_multiframe:
        inpainted = (
            inpainted.unsqueeze(0)
            .expand(world_engine.n_frames, -1, -1, -1)
            .contiguous()
        )

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
async def websocket_endpoint(websocket: WebSocket):
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
            {"type": "init", "req_id": "...", "model": str, "seed_image_data": str, "seed_filename": str, "scene_edit": bool, "action_logging": bool, "quant": str|null}
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

    # Stream log lines to the client. TeeStream captures all stdout/stderr
    # output (including logger output) and pushes complete lines into per-client
    # queues, so logs arrive immediately without file polling.
    log_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
    loop = asyncio.get_running_loop()

    async def _stream_logs_to_client():
        try:
            # Replay recent log history so the client sees what happened before it connected.
            # Register for live lines only AFTER reading the tail to avoid duplicates.
            initial_lines = _read_log_tail_lines(LOG_TAIL_INITIAL_LINES)
            for line in initial_lines:
                await websocket.send_text(json.dumps({"type": "log", "line": line, "level": "info"}))
            TeeStream.register_client(log_queue, loop)

            # Stream new log lines as they arrive from TeeStream.
            while True:
                line = await log_queue.get()
                await websocket.send_text(json.dumps({"type": "log", "line": line, "level": "info"}))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            # Avoid recursion — don't use logger here.
            print(f"[{client_host}] Log stream stopped: {e}", flush=True)

    log_tail_task = asyncio.create_task(_stream_logs_to_client())

    # If startup is not yet complete, replay accumulated stages and stream new ones
    startup_queue: asyncio.Queue | None = None
    if not startup_complete:
        startup_queue = asyncio.Queue(maxsize=200)
        ws_startup_waiters.append(startup_queue)
        # Replay accumulated stages
        for stage_msg in startup_stages:
            await websocket.send_text(json.dumps(stage_msg))
        # Stream new stages until startup is done
        while not startup_complete:
            try:
                stage_msg = await asyncio.wait_for(startup_queue.get(), timeout=1.0)
                if stage_msg.get("type") == "_startup_done":
                    break
                await websocket.send_text(json.dumps(stage_msg))
            except asyncio.TimeoutError:
                continue
        ws_startup_waiters.remove(startup_queue)

    if startup_error:
        await websocket.send_text(json.dumps({"type": "error", "message_id": "app.server.error.serverStartupFailed", "message": str(startup_error)}))
        log_tail_task.cancel()
        TeeStream.unregister_client(log_queue)
        await websocket.close()
        return

    session = Session()
    # Each websocket session must perform an explicit model/seed handshake.
    world_engine.seed_frame = None

    async def send_json(data: dict):
        await websocket.send_text(json.dumps(data))

    async def send_warning(message_id: str, params: dict | None = None) -> None:
        payload: dict = {"type": "warning", "message_id": message_id}
        if params:
            payload["params"] = params
        await send_json(payload)

    async def send_stage(stage: Stage) -> None:
        await send_json(
            {
                "type": "status",
                "stage": stage.id,
            }
        )

    # Progress queue: engine_manager calls progress_callback (sync, from CUDA thread)
    # which enqueues payloads; the drain task sends them over the WebSocket.
    progress_queue: asyncio.Queue = asyncio.Queue(maxsize=500)

    def progress_callback(stage: Stage) -> None:
        """Sync callback safe to call from any thread — enqueues for async send."""
        payload = {
            "type": "status",
            "stage": stage.id,
        }
        try:
            progress_queue.put_nowait(payload)
        except asyncio.QueueFull:
            pass

    async def _drain_progress_queue():
        try:
            while True:
                msg = await progress_queue.get()
                try:
                    await websocket.send_text(json.dumps(msg))
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
        session.frame_count = 0
        logger.info(f"[{client_host}] Engine Reset")

    async def load_seed_from_data(image_data_b64: str | None, seed_filename: str | None = None) -> bool:
        """Validate safety and load seed from base64 image data."""
        nonlocal current_seed_hash, current_seed_filename
        if not image_data_b64:
            logger.warning(f"[{client_host}] Missing seed image data")
            await send_warning("app.server.warning.missingSeedData")
            return False

        try:
            image_bytes = base64.b64decode(image_data_b64)
        except Exception as e:
            logger.warning(f"[{client_host}] Invalid base64 seed data: {e}")
            await send_warning("app.server.warning.invalidSeedData")
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
                await send_warning("app.server.warning.seedUnsafe")
                return False
        else:
            # Run safety check (decode + inference off the event loop)
            import io
            try:
                def _check_safety():
                    pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                    return safety_checker.check_pil_image(pil_img)
                safety_result = await asyncio.to_thread(_check_safety)
            except Exception as e:
                logger.warning(f"[{client_host}] Safety check failed: {e}")
                await send_warning("app.server.warning.seedSafetyCheckFailed")
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
                await send_warning("app.server.warning.seedUnsafe")
                return False

        # Load seed
        display_name = seed_filename or img_hash[:12]
        logger.info(f"[{client_host}] Loading seed '{display_name}'")
        loaded_frame = await world_engine.load_seed_from_base64(image_data_b64)
        if loaded_frame is None:
            logger.error(f"[{client_host}] Failed to load seed")
            await send_warning("app.server.warning.seedLoadFailed")
            return False

        world_engine.seed_frame = loaded_frame
        world_engine.original_seed_frame = loaded_frame
        current_seed_hash = img_hash
        current_seed_filename = seed_filename
        logger.info(f"[{client_host}] Seed loaded successfully")
        return True

    async def handle_init(msg: dict, is_game_loop: bool = False) -> tuple[bool, bool]:
        """Handle unified init message — apply deltas for model, seed, flags.
        Returns (ready, seed_loaded): ready=session has a seed frame,
        seed_loaded=a new seed was loaded in this call."""
        nonlocal scene_edit_requested, action_logging_requested, action_logger, cap_inference_fps

        model_uri = (msg.get("model") or "").strip()
        seed_data = msg.get("seed_image_data")
        seed_filename = msg.get("seed_filename")
        quant = msg.get("quant")

        # Update flags
        if "scene_edit" in msg:
            scene_edit_requested = msg["scene_edit"]
        if "action_logging" in msg:
            action_logging_requested = msg["action_logging"]

        # Sync action logger with requested state during gameplay
        if is_game_loop:
            if action_logging_requested and action_logger is None:
                action_logger = ActionLogger(client_host)
                action_logger.new_segment(
                    model=getattr(world_engine, "model_uri", None),
                    seed=current_seed_filename,
                    n_frames=world_engine.n_frames,
                    seed_target_size=world_engine.seed_target_size,
                    has_prompt_conditioning=getattr(world_engine, "has_prompt_conditioning", False),
                )
                logger.info(f"[{client_host}] Action logging enabled")
            elif not action_logging_requested and action_logger is not None:
                action_logger.end_segment()
                action_logger = None
                logger.info(f"[{client_host}] Action logging disabled")

        # Model delta
        model_changed = False
        if model_uri and model_uri != getattr(world_engine, "model_uri", None):
            logger.info(f"[{client_host}] {'Live model switch' if is_game_loop else 'Requested model'}: {model_uri}")
            world_engine.set_progress_callback(progress_callback, asyncio.get_running_loop())
            await world_engine.load_engine(model_uri, quant=quant)
            world_engine.set_progress_callback(None)
            world_engine.seed_frame = None
            session.frame_count = 0
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

    scene_edit_requested = False
    action_logging_requested = False
    action_logger: ActionLogger | None = None
    current_seed_hash: str | None = None
    current_seed_filename: str | None = None

    init_req_id: str | None = None

    try:
        await send_stage(SESSION_WAITING_FOR_SEED)
        logger.info(f"[{client_host}] Waiting for init message...")

        while world_engine.seed_frame is None:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                msg = json.loads(raw)
                msg_type = msg.get("type")

                if "req_id" in msg and msg_type != "init":
                    result = await dispatch_request(msg, websocket)
                    req_id = msg["req_id"]
                    if isinstance(result, BinaryResponse):
                        header = json.dumps(
                            {"req_id": req_id, "success": True},
                            separators=(",", ":"),
                        ).encode("utf-8")
                        await websocket.send_bytes(struct.pack("<I", len(header)) + header + result.image_bytes)
                    else:
                        if "success" not in result:
                            result = {"success": True, "data": result}
                        await send_json({"type": "response", "req_id": req_id, **result})
                    continue

                if msg_type == "init":
                    # init RPC: response is deferred until after warmup/session init completes
                    init_req_id = msg.get("req_id")
                    ready, _ = await handle_init(msg)
                    if not ready and init_req_id:
                        await send_json({"type": "response", "req_id": init_req_id, "success": False, "error_id": "app.server.error.initFailed"})
                        init_req_id = None
                else:
                    logger.info(
                        f"[{client_host}] Ignoring message type '{msg_type}' while waiting for init"
                    )

            except asyncio.TimeoutError:
                logger.error(f"[{client_host}] Timeout waiting for init")
                await send_json(
                    {"type": "error", "message_id": "app.server.error.timeoutWaitingForSeed"}
                )
                return

        # Wire progress callback so engine_manager reports granular stages
        world_engine.set_progress_callback(progress_callback, asyncio.get_running_loop())

        # If no model was selected by client, load default/current model now.
        if world_engine.engine is None:
            await world_engine.load_engine()

        if world_engine.seed_frame is None:
            logger.info(
                f"[{client_host}] Seed frame missing before initialization; client likely disconnected/reconnected during model switch"
            )
            world_engine.set_progress_callback(None)
            if init_req_id:
                await send_json({"type": "response", "req_id": init_req_id, "success": False, "error_id": "app.server.error.initFailed"})
            return

        # Load or unload inpainting model based on scene_edit flag.
        # Loading happens BEFORE WorldEngine warmup so CUDA graphs
        # are compiled with the inpainting model's memory already allocated.
        if not scene_edit_requested and inpainting_manager is not None and inpainting_manager.is_loaded:
            logger.info(f"[{client_host}] Scene edit disabled — unloading inpainting model")
            await asyncio.to_thread(inpainting_manager.unload)

        if scene_edit_requested and inpainting_manager is not None and not inpainting_manager.is_loaded:
            await send_stage(SESSION_INPAINTING_LOAD)
            try:
                await inpainting_manager.warmup()
                await send_stage(SESSION_INPAINTING_READY)
            except Exception as e:
                logger.error(f"[{client_host}] Inpainting warmup failed: {e}", exc_info=True)
                await send_json({"type": "error", "message_id": "app.server.error.sceneEditModelLoadFailed", "message": str(e)})
                if init_req_id:
                    await send_json({"type": "response", "req_id": init_req_id, "success": False, "error_id": "app.server.error.sceneEditModelLoadFailed"})
                return

        # Warmup on first connection AFTER seed is loaded
        if not world_engine.engine_warmed_up:
            try:
                await world_engine.warmup()
            except RuntimeError as e:
                err_str = str(e)
                if "compute capability" in err_str or "scaled_mm" in err_str:
                    logger.error(f"[{client_host}] Errors running selected model, most likely selected quantization mode is unsupported on this GPU. Error message: {err_str}")
                    await send_json({
                        "type": "error",
                        "message_id": "app.server.error.quantUnsupportedGpu",
                        "params": {"quant": world_engine.quant or "unknown"},
                    })
                    return
                raise

        # Init session (reset, seed, prompt) with granular progress
        await world_engine.init_session()

        # Send initial frame so client has something to display
        initial_display_frame = (
            world_engine.seed_frame[0] if world_engine.is_multiframe else world_engine.seed_frame
        )
        jpeg = await asyncio.to_thread(
            world_engine.frame_to_jpeg, initial_display_frame
        )
        header = json.dumps(
            {"frame_id": 0, "client_ts": 0, "gen_ms": 0},
            separators=(",", ":"),
        ).encode("utf-8")
        await websocket.send_bytes(struct.pack("<I", len(header)) + header + jpeg)

        world_engine.set_progress_callback(None)
        await send_stage(SESSION_READY)
        logger.info(f"[{client_host}] Ready for game loop")

        action_logger = ActionLogger(client_host) if action_logging_requested else None

        def _action_logger_new_segment() -> None:
            if action_logger is not None:
                action_logger.new_segment(
                    model=getattr(world_engine, "model_uri", None),
                    seed=current_seed_filename,
                    n_frames=world_engine.n_frames,
                    seed_target_size=world_engine.seed_target_size,
                    has_prompt_conditioning=getattr(world_engine, "has_prompt_conditioning", False),
                )

        def _action_logger_end_segment() -> None:
            if action_logger is not None:
                action_logger.end_segment()

        _action_logger_new_segment()

        running = True
        paused = False
        reset_flag = False
        prompt_pending: str | None = None
        # Scene edit: receiver posts a prompt + future, generator picks it up
        # after the current gen_frame, runs inpainting on the last subframe,
        # appends the result, and resolves the future with preview data.
        scene_edit_request: dict | None = None  # {"prompt": str, "future": concurrent.futures.Future}
        last_generated_cpu_frames = None  # Most recent CPU numpy frames for scene editing (list)
        ctrl_state = {
            "buttons": set(),
            "mouse_dx": 0.0,
            "mouse_dy": 0.0,
            "client_ts": 0,
            "dirty": False,
        }
        ctrl_lock = threading.Lock()
        frame_queue: Queue = Queue(maxsize=16)
        frame_ready = asyncio.Event()
        main_loop = asyncio.get_running_loop()

        # Cache device names — queried once per session (both can be slow)
        try:
            import cpuinfo
            _metrics_cpu_name = cpuinfo.get_cpu_info().get("brand_raw") or None
        except Exception:
            _metrics_cpu_name = None
        try:
            _metrics_gpu_name = (torch.cuda.get_device_name(0) if torch.cuda.is_available() else None) or None
        except Exception:
            _metrics_gpu_name = None

        def queue_send(payload: dict | bytes) -> None:
            try:
                frame_queue.put_nowait(payload)
                main_loop.call_soon_threadsafe(frame_ready.set)
            except Exception:
                pass

        # Cached GPU metrics, updated each latent pass and embedded in frame headers
        _cached_gpu_metrics = {
            "vram_used_mb": -1.0,
            "vram_total_mb": -1.0,
            "vram_percent": -1.0,
            "gpu_util_percent": -1.0,
        }

        # One-time NVML init for GPU utilization queries (same backend as nvidia-smi)
        _nvml_handle = None
        try:
            import pynvml
            pynvml.nvmlInit()
            _nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(
                torch.cuda.current_device() if torch.cuda.is_available() else 0
            )
        except Exception:
            pass

        def _update_gpu_metrics() -> None:
            try:
                if torch.cuda.is_available():
                    vram_used = torch.cuda.memory_allocated() / (1024 * 1024)
                    vram_total = torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)
                    vram_pct = (vram_used / vram_total * 100) if vram_total > 0 else 0
                else:
                    vram_used = vram_total = vram_pct = -1
                gpu_util = -1
                try:
                    gpu_util = torch.cuda.utilization()
                except Exception:
                    pass
                if gpu_util < 0 and _nvml_handle is not None:
                    try:
                        import pynvml
                        gpu_util = pynvml.nvmlDeviceGetUtilizationRates(_nvml_handle).gpu
                    except Exception:
                        pass
                _cached_gpu_metrics.update({
                    "vram_used_mb": round(vram_used, 0),
                    "vram_total_mb": round(vram_total, 0),
                    "vram_percent": round(vram_pct, 1),
                    "gpu_util_percent": gpu_util,
                })
            except Exception:
                pass  # metrics are best-effort

        def build_binary_frame(jpeg: bytes, frame_id: int, client_ts: float, gen_ms: float, n_frames: int = 1, profile: dict | None = None) -> bytes:
            header_data = {"frame_id": frame_id, "client_ts": client_ts, "gen_ms": gen_ms, "n_frames": n_frames}
            header_data.update(_cached_gpu_metrics)
            if profile is not None:
                header_data.update(profile)
            header = json.dumps(header_data, separators=(",", ":")).encode("utf-8")
            return struct.pack("<I", len(header)) + header + jpeg

        # Respond to init RPC with session metrics
        if init_req_id:
            from engine_manager import DEFAULT_INFERENCE_FPS
            await send_json({
                "type": "response",
                "req_id": init_req_id,
                "success": True,
                "data": {
                    "gpu_name": _metrics_gpu_name,
                    "cpu_name": _metrics_cpu_name,
                    "model": getattr(world_engine, 'model_uri', "") or "",
                    "inference_fps": getattr(world_engine, 'inference_fps', DEFAULT_INFERENCE_FPS),
                },
            })
            init_req_id = None

        async def receiver() -> None:
            nonlocal running, paused, reset_flag, prompt_pending, scene_edit_request
            while running:
                try:
                    raw = await websocket.receive_text()
                    msg = json.loads(raw)
                    msg_type = msg.get("type", "control")

                    if "req_id" in msg:
                        if msg_type == "init":
                            # init RPC: apply deltas and respond with metrics
                            ready, new_seed = await handle_init(msg, is_game_loop=True)
                            from engine_manager import DEFAULT_INFERENCE_FPS
                            if ready:
                                queue_send({
                                    "type": "response",
                                    "req_id": msg["req_id"],
                                    "success": True,
                                    "data": {
                                        "gpu_name": _metrics_gpu_name,
                                        "cpu_name": _metrics_cpu_name,
                                        "model": getattr(world_engine, 'model_uri', "") or "",
                                        "inference_fps": getattr(world_engine, 'inference_fps', DEFAULT_INFERENCE_FPS),
                                    },
                                })
                            else:
                                queue_send({
                                    "type": "response",
                                    "req_id": msg["req_id"],
                                    "success": False,
                                    "error_id": "app.server.error.initFailed",
                                })
                            if new_seed:
                                reset_flag = True
                        elif msg_type == "scene_edit":
                            # scene_edit is handled by the generator thread at
                            # the next clean frame boundary — post a request and
                            # await the future.
                            if action_logger is not None:
                                action_logger.scene_edit(msg.get("prompt", "").strip())
                            prompt = msg.get("prompt", "").strip()
                            if not prompt:
                                result = {"success": False, "error_id": "app.server.error.sceneEditEmptyPrompt"}
                            elif inpainting_manager is None or not inpainting_manager.is_loaded:
                                result = {"success": False, "error_id": "app.server.error.sceneEditModelNotLoaded"}
                            elif scene_edit_request is not None:
                                result = {"success": False, "error_id": "app.server.error.sceneEditAlreadyInProgress"}
                            else:
                                import concurrent.futures
                                fut = concurrent.futures.Future()
                                scene_edit_request = {"prompt": prompt, "future": fut}
                                try:
                                    preview_data = await asyncio.wrap_future(fut)
                                    result = {"success": True, "data": {**preview_data}}
                                except Exception as e:
                                    error_id = getattr(e, "message_id", None)
                                    if error_id:
                                        result = {"success": False, "error_id": error_id}
                                    else:
                                        result = {"success": False, "error": str(e)}
                            req_id = msg["req_id"]
                            if isinstance(result, BinaryResponse):
                                header = json.dumps(
                                    {"req_id": req_id, "success": True},
                                    separators=(",", ":"),
                                ).encode("utf-8")
                                queue_send(struct.pack("<I", len(header)) + header + result.image_bytes)
                            else:
                                if "success" not in result:
                                    result = {"success": True, "data": result}
                                queue_send({"type": "response", "req_id": req_id, **result})
                        else:
                            result = await dispatch_request(msg, websocket)
                            req_id = msg["req_id"]
                            if isinstance(result, BinaryResponse):
                                header = json.dumps(
                                    {"req_id": req_id, "success": True},
                                    separators=(",", ":"),
                                ).encode("utf-8")
                                queue_send(struct.pack("<I", len(header)) + header + result.image_bytes)
                            else:
                                if "success" not in result:
                                    result = {"success": True, "data": result}
                                queue_send({"type": "response", "req_id": req_id, **result})
                        continue

                    match msg_type:

                        case "reset":
                            logger.info(f"[{client_host}] Reset requested")
                            reset_flag = True
                            continue

                        case "pause":
                            paused = True
                            logger.info("[RECV] Paused")
                            continue

                        case "resume":
                            paused = False
                            logger.info("[RECV] Resumed")
                            continue

                        case "prompt":
                            from engine_manager import DEFAULT_PROMPT

                            new_prompt = msg.get("prompt", "").strip()
                            prompt_pending = new_prompt if new_prompt else DEFAULT_PROMPT
                            continue

                        case "control":
                            if paused:
                                continue

                            if "button_codes" in msg:
                                buttons = set(msg.get("button_codes", []))
                            else:
                                buttons = {
                                    BUTTON_CODES[b.upper()]
                                    for b in msg.get("buttons", [])
                                    if b.upper() in BUTTON_CODES
                                }

                            with ctrl_lock:
                                ctrl_state["buttons"] = buttons
                                ctrl_state["mouse_dx"] += float(msg.get("mouse_dx", 0.0))
                                ctrl_state["mouse_dy"] += float(msg.get("mouse_dy", 0.0))
                                ctrl_state["client_ts"] = msg.get("ts", ctrl_state["client_ts"])
                                ctrl_state["dirty"] = True
                            continue

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
                            await websocket.send_text(json.dumps(payload))
                except Exception as e:
                    logger.error(f"[{client_host}] Sender error: {e}", exc_info=True)
                    running = False
                    break

        def generator() -> None:
            nonlocal running, paused, reset_flag, prompt_pending, scene_edit_request, last_generated_cpu_frames

            def run_coro(coro):
                return asyncio.run_coroutine_threadsafe(coro, main_loop).result()

            def _flush_pending():
                """JPEG-encode + queue pending CPU frames."""
                if not _flush_pending.work:
                    return
                cpu_frames, gen_time, n_frames, client_ts, t0, t_infer, t_sync = _flush_pending.work
                _flush_pending.work = None

                t_enc_start = time.perf_counter()
                encoded = [world_engine._numpy_to_jpeg(rgb) for rgb in cpu_frames]
                t_enc = time.perf_counter()

                if session.frame_count % 5 == 0:
                    _update_gpu_metrics()
                t_metrics = time.perf_counter()

                for jpeg in encoded:
                    session.frame_count += 1
                    t_queued = time.perf_counter()
                    profile = {
                        "t_infer_ms": round((t_infer - t0) * 1000, 1),
                        "t_sync_ms": round((t_sync - t_infer) * 1000, 1),
                        "t_enc_ms": round((t_enc - t_enc_start) * 1000, 1),
                        "t_metrics_ms": round((t_metrics - t_enc) * 1000, 1),
                        "t_overhead_ms": round((t_queued - t_metrics) * 1000, 1),
                    }
                    queue_send(build_binary_frame(jpeg, session.frame_count, client_ts, gen_time, n_frames=n_frames, profile=profile))

                if session.frame_count % 60 == 0:
                    logger.info(
                        f"[{client_host}] Sent frame {session.frame_count} (gen={gen_time:.1f}ms)"
                    )

            _flush_pending.work = None
            _gen_was_paused = False

            while running:
                if paused:
                    _flush_pending()
                    if not _gen_was_paused:
                        _action_logger_end_segment()
                        _gen_was_paused = True
                    time.sleep(0.01)
                    continue

                if _gen_was_paused:
                    _gen_was_paused = False
                    _action_logger_new_segment()

                try:
                    if prompt_pending is not None:
                        _flush_pending()
                        world_engine.current_prompt = prompt_pending
                        prompt_pending = None
                        run_coro(reset_engine())
                        _action_logger_new_segment()

                    if reset_flag or session.frame_count >= session.max_frames:
                        _flush_pending()
                        if session.frame_count >= session.max_frames:
                            logger.info(f"[{client_host}] Auto-reset at frame limit")
                        run_coro(reset_engine())
                        reset_flag = False
                        _action_logger_new_segment()

                    # Handle pending scene edit — runs inpainting on the last
                    # subframe from the most recent gen_frame, then appends.
                    if scene_edit_request is not None and last_generated_cpu_frames is not None:
                        req = scene_edit_request
                        scene_edit_request = None
                        _flush_pending()
                        try:
                            preview = _run_scene_edit_on_generator(
                                req["prompt"], last_generated_cpu_frames
                            )
                            session.frame_count = 0
                            req["future"].set_result(preview)
                        except Exception as e:
                            logger.error(f"[SCENE_EDIT] Failed: {e}", exc_info=True)
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
                    t0 = time.perf_counter()

                    # Submit inference to CUDA thread (non-blocking) so we can
                    # overlap JPEG encoding of the previous batch with GPU work.
                    gpu_future = world_engine.cuda_executor.submit(
                        lambda c=ctrl: world_engine.engine.gen_frame(ctrl=c)
                    )

                    # Encode + send previous batch while GPU is busy
                    _flush_pending()

                    # Wait for GPU result
                    result = gpu_future.result()
                    t_infer = time.perf_counter()

                    if torch.cuda.is_available():
                        torch.cuda.synchronize()
                    t_sync = time.perf_counter()

                    gen_time = (t_sync - t0) * 1000
                    n_frames = world_engine.n_frames

                    # Transfer result tensors to CPU numpy arrays immediately
                    # while the data is still valid (gen_frame may reuse GPU
                    # buffers on the next call).
                    if n_frames > 1:
                        cpu_frames = [world_engine._tensor_to_numpy(result[i]) for i in range(result.shape[0])]
                    else:
                        cpu_frames = [world_engine._tensor_to_numpy(result)]

                    # Keep all subframes for scene editing (read by receiver thread)
                    last_generated_cpu_frames = cpu_frames

                    # Stash this batch's CPU frames for deferred JPEG encoding
                    _flush_pending.work = (cpu_frames, gen_time, n_frames, client_ts, t0, t_infer, t_sync)

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
                                {
                                    "type": "status",
                                    "stage": "session.reset",
                                    "message": "Recovered from CUDA error - engine reset",
                                }
                            )
                            logger.info(f"[{client_host}] Successfully recovered from CUDA error")
                        else:
                            queue_send(
                                {
                                    "type": "error",
                                    "message_id": "app.server.error.cudaRecoveryFailed",
                                }
                            )
                            logger.error(f"[{client_host}] Failed to recover from CUDA error")
                            running = False
                            break
                    else:
                        logger.error(f"[{client_host}] Generation error: {cuda_err}", exc_info=True)
                        queue_send({"type": "error", "message": str(cuda_err)})
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
                await send_json({"type": "error", "message": str(e)})
            except Exception:
                pass
    finally:
        log_tail_task.cancel()
        TeeStream.unregister_client(log_queue)
        progress_drain_task.cancel()
        world_engine.set_progress_callback(None)
        if action_logger is not None:
            action_logger.end_segment()
        logger.info(f"[{client_host}] Disconnected (frames: {session.frame_count})")


# ============================================================================
# Entry Point
# ============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Biome Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=7987, help="Port to bind to")
    parser.add_argument("--parent-pid", type=int, default=None, help="PID of parent process; server exits if parent dies")
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
