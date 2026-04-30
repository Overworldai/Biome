"""
Per-WebSocket-connection state container.

`Connection` bundles the per-connection state that used to live as
nonlocals across the closures inside `websocket_endpoint`: init flags,
recorder instances, seed metadata, game-loop state, scene-authoring
RPC handoff, control input, and the inter-thread channels.  Created
once per connection (must be inside an asyncio loop, since several
fields are loop-bound), mutated in place by every helper.

`Connection` must be constructed *inside* the running event loop —
`__post_init__` initialises the asyncio.Event / asyncio.Queue fields
and captures `asyncio.get_running_loop()`. Field-level immutability
lives at the boundary types (Pydantic models elsewhere); Connection
itself is mutable shared state by design.

This module is strict-typed by construction — none of the legacy ignore
rules in pyproject.toml fire on this code. Keep it that way.
"""

import asyncio
import base64
import hashlib
import io
import logging
import threading
import time
from dataclasses import dataclass, field
from queue import Queue
from typing import TYPE_CHECKING

from fastapi import WebSocket
from PIL import Image
from pydantic import BaseModel

from action_logger import ActionLogger
from app_state import AppState
from progress_stages import SESSION_WAITING_FOR_SEED, Stage
from protocol import InitRequest, MessageId, StatusMessage, WarningMessage
from safety_cache import save_safety_cache
from video_recorder import RecordingProperties, VideoRecorder

if TYPE_CHECKING:
    from engine_manager import Session, WorldEngineManager
    from safety import SafetyChecker

logger = logging.getLogger(__name__)


def _compute_bytes_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass
class ControlState:
    """Mutable control input shared between receiver (writes via
    `conn.ctrl_lock`) and generator (reads under same lock)."""

    buttons: set[int] = field(default_factory=set)
    mouse_dx: float = 0.0
    mouse_dy: float = 0.0
    client_ts: float = 0.0
    dirty: bool = False


@dataclass
class Connection:
    """Per-WebSocket-connection state, mutated in place. Reference-equality
    semantics — never compare two `Connection` instances structurally."""

    # ─── Immutable references (set at construction) ────────────────
    websocket: WebSocket
    state: AppState
    client_host: str

    # ─── Init-flag deltas applied by handle_init ────────────────────
    # All default to "not requested"; the renderer ramps them up via
    # InitRequest as the user toggles flags.
    scene_authoring_requested: bool = False
    action_logging_requested: bool = False
    video_recording_requested: bool = False
    cap_inference_fps: bool = True
    video_output_dir: str | None = None
    biome_version: str | None = None

    # ─── Recorder instances (lifecycle managed alongside game loop) ─
    action_logger: ActionLogger | None = None
    video_recorder: VideoRecorder | None = None

    # ─── Seed metadata for the currently-loaded seed frame ──────────
    current_seed_hash: str | None = None
    current_seed_filename: str | None = None

    # ─── Pending init RPC ID (response deferred until warmup ends) ──
    init_req_id: str | None = None

    # ─── Game-loop state ────────────────────────────────────────────
    # `running` flips off when receiver/sender/generator detect
    # disconnect or terminal error. `paused` toggles the gen-loop's
    # idle vs. active branch. `reset_flag` is set by the receiver and
    # consumed once by the generator. `prompt_pending` similarly.
    running: bool = True
    paused: bool = False
    reset_flag: bool = False
    prompt_pending: str | None = None

    # ─── Scene-authoring RPC handoff (receiver → generator thread) ──
    # Receiver posts a {"prompt": str, "future": Future}; generator
    # picks it up at a clean frame boundary and resolves the future.
    scene_edit_request: dict | None = None
    generate_scene_request: dict | None = None

    # Most recent CPU numpy frames, kept so a scene_edit can inpaint
    # the last subframe rendered.
    last_generated_cpu_frames: list | None = None

    # ─── Inter-thread channels (initialised in __post_init__) ──────
    # `frame_queue` carries Pydantic models or raw binary frames from
    # the generator thread (sync) to the asyncio sender. `frame_ready`
    # is the cross-thread wakeup signal — generator calls
    # `loop.call_soon_threadsafe(conn.frame_ready.set)` after enqueue.
    frame_queue: Queue[BaseModel | bytes] = field(default_factory=lambda: Queue(maxsize=16))
    frame_ready: asyncio.Event = field(init=False)
    progress_queue: asyncio.Queue[StatusMessage] = field(init=False)
    log_queue: asyncio.Queue[str] = field(init=False)
    main_loop: asyncio.AbstractEventLoop = field(init=False)

    # ─── Control input (receiver writes, generator reads) ──────────
    ctrl: ControlState = field(default_factory=ControlState)
    ctrl_lock: threading.Lock = field(default_factory=threading.Lock)

    # ─── Cached GPU metrics embedded in frame headers ──────────────
    # Updated every ~5 frames by the generator's metric sampler;
    # read on the same thread when building binary frame headers.
    cached_vram_used_bytes: int = -1
    cached_gpu_util_percent: int = -1

    def __post_init__(self) -> None:
        # Loop-bound channels — Connection must be constructed inside
        # the running asyncio loop. Captured here so consumer code
        # gets non-Optional fields and basedpyright stays happy.
        self.frame_ready = asyncio.Event()
        self.progress_queue = asyncio.Queue(maxsize=500)
        self.log_queue = asyncio.Queue(maxsize=1000)
        self.main_loop = asyncio.get_running_loop()

    # ─── Async send helpers (asyncio thread; awaited) ──────────────
    async def send_message(self, msg: BaseModel) -> None:
        """Serialise + push a Pydantic message over the websocket."""
        await self.websocket.send_text(msg.model_dump_json(exclude_none=True))

    async def send_warning(self, message_id: MessageId, params: dict[str, str] | None = None) -> None:
        await self.send_message(WarningMessage(message_id=message_id, params=params))

    async def send_stage(self, stage: Stage) -> None:
        await self.send_message(StatusMessage(stage=stage.id))

    def push_progress(self, stage: Stage) -> None:
        """Sync callback for `WorldEngineManager.set_progress_callback` —
        safe to call from any thread; enqueues onto `progress_queue` for
        the asyncio drain task to ferry over the websocket."""
        try:
            self.progress_queue.put_nowait(StatusMessage(stage=stage.id))
        except asyncio.QueueFull:
            pass

    # ─── Recorder lifecycle ────────────────────────────────────────
    def start_action_log_segment(self, world_engine: "WorldEngineManager") -> None:
        """Open a new action-log segment if action logging is active."""
        if self.action_logger is None:
            return
        self.action_logger.new_segment(
            model=world_engine.model_uri,
            seed=self.current_seed_filename,
            temporal_compression=world_engine.temporal_compression,
            seed_target_size=world_engine.seed_target_size,
            has_prompt_conditioning=world_engine.has_prompt_conditioning,
        )

    def end_action_log_segment(self) -> None:
        """Close any active action-log segment."""
        if self.action_logger is not None:
            self.action_logger.end_segment()

    def start_video_segment(self, world_engine: "WorldEngineManager") -> None:
        """Open a new video-recording segment if recording is requested.
        Lazily constructs the VideoRecorder the first time this is called."""
        if not self.video_recording_requested:
            return
        if self.video_recorder is None:
            self.video_recorder = VideoRecorder(self.client_host, output_dir=self.video_output_dir)
        self.video_recorder.new_segment(
            width=world_engine.seed_target_size[1],
            height=world_engine.seed_target_size[0],
            fps=int(world_engine.inference_fps),
            properties=RecordingProperties(
                biome_version=self.biome_version or "unknown",
                model=world_engine.model_uri,
                quant=world_engine.quant or "none",
                seed=self.current_seed_filename,
                scene_authoring_enabled=self.scene_authoring_requested,
            ),
        )

    def end_video_segment(self) -> None:
        """Close any active video-recording segment."""
        if self.video_recorder is not None:
            self.video_recorder.end_segment()

    # ─── Threadsafe enqueue helper (any thread) ────────────────────
    def queue_send(self, payload: BaseModel | bytes) -> None:
        """Enqueue a payload for the asyncio sender to dispatch.
        Safe to call from the generator thread; wakes the sender via
        a `call_soon_threadsafe(frame_ready.set)`."""
        try:
            self.frame_queue.put_nowait(payload)
            self.main_loop.call_soon_threadsafe(self.frame_ready.set)
        except Exception:
            pass


async def load_seed_from_data(
    conn: Connection,
    world_engine: "WorldEngineManager",
    safety_checker: "SafetyChecker",
    image_data_b64: str | None,
    seed_filename: str | None = None,
) -> bool:
    """Validate safety and load a seed from base64 image data.

    Returns True iff the seed was loaded (or already loaded and matched).
    Failure paths surface a typed warning over the websocket and return False.
    """
    if not image_data_b64:
        logger.warning(f"[{conn.client_host}] Missing seed image data")
        await conn.send_warning(MessageId.SEED_MISSING_DATA)
        return False

    try:
        image_bytes = base64.b64decode(image_data_b64)
    except Exception as e:
        logger.warning(f"[{conn.client_host}] Invalid base64 seed data: {e}")
        await conn.send_warning(MessageId.SEED_INVALID_DATA)
        return False

    img_hash = _compute_bytes_hash(image_bytes)

    # Same seed already loaded? Skip the safety inference + load entirely.
    if img_hash == conn.current_seed_hash:
        logger.info(f"[{conn.client_host}] Seed unchanged (hash match), skipping reload")
        return True

    # Safety check (cache hit, then live inference if missing)
    cache = conn.state.safety_hash_cache
    if img_hash in cache:
        cached = cache[img_hash]
        if not cached.get("is_safe", False):
            logger.warning(f"[{conn.client_host}] Seed marked as unsafe (cached)")
            await conn.send_warning(MessageId.SEED_UNSAFE)
            return False
    else:
        try:

            def _check_safety():
                pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                return safety_checker.check_pil_image(pil_img)

            safety_result = await asyncio.to_thread(_check_safety)
        except Exception as e:
            logger.warning(f"[{conn.client_host}] Safety check failed: {e}")
            await conn.send_warning(MessageId.SEED_SAFETY_CHECK_FAILED)
            return False

        is_safe = safety_result.get("is_safe", False)
        cache[img_hash] = {
            "is_safe": is_safe,
            "scores": safety_result.get("scores", {}),
            "checked_at": time.time(),
        }
        save_safety_cache(cache)

        if not is_safe:
            logger.warning(f"[{conn.client_host}] Seed marked as unsafe")
            await conn.send_warning(MessageId.SEED_UNSAFE)
            return False

    # Load the seed onto the engine
    display_name = seed_filename or img_hash[:12]
    logger.info(f"[{conn.client_host}] Loading seed '{display_name}'")
    loaded_frame = await world_engine.load_seed_from_base64(image_data_b64)
    if loaded_frame is None:
        logger.error(f"[{conn.client_host}] Failed to load seed")
        await conn.send_warning(MessageId.SEED_LOAD_FAILED)
        return False

    world_engine.seed_frame = loaded_frame
    world_engine.original_seed_frame = loaded_frame
    conn.current_seed_hash = img_hash
    conn.current_seed_filename = seed_filename
    logger.info(f"[{conn.client_host}] Seed loaded successfully")
    return True


async def handle_init(
    conn: Connection,
    world_engine: "WorldEngineManager",
    safety_checker: "SafetyChecker",
    session: "Session",
    req: InitRequest,
    *,
    is_game_loop: bool = False,
) -> tuple[bool, bool]:
    """Apply an InitRequest's deltas to the connection / engine.

    Returns `(ready, seed_loaded)`: `ready` means the session has a
    seed frame and can begin generating; `seed_loaded` means a fresh
    seed was applied in this call.

    `model_fields_set` distinguishes "field absent" from "field present
    and explicitly None", so partial updates (`{"action_logging": false}`
    while leaving everything else untouched) work as the renderer expects.
    """
    present = req.model_fields_set
    model_uri = (req.model or "").strip()
    seed_data = req.seed_image_data
    seed_filename = req.seed_filename
    quant = req.quant

    # Update flags
    if "scene_authoring" in present and req.scene_authoring is not None:
        conn.scene_authoring_requested = req.scene_authoring
    if "action_logging" in present and req.action_logging is not None:
        conn.action_logging_requested = req.action_logging
    if "video_recording" in present and req.video_recording is not None:
        conn.video_recording_requested = req.video_recording
    if "video_output_dir" in present:
        conn.video_output_dir = req.video_output_dir
    if "biome_version" in present:
        conn.biome_version = req.biome_version
    if "cap_inference_fps" in present and req.cap_inference_fps is not None:
        conn.cap_inference_fps = req.cap_inference_fps

    # Sync recorder lifecycle with requested state during gameplay
    if is_game_loop:
        if conn.action_logging_requested and conn.action_logger is None:
            conn.action_logger = ActionLogger(conn.client_host)
            conn.start_action_log_segment(world_engine)
            logger.info(f"[{conn.client_host}] Action logging enabled")
        elif not conn.action_logging_requested and conn.action_logger is not None:
            conn.action_logger.end_segment()
            conn.action_logger = None
            logger.info(f"[{conn.client_host}] Action logging disabled")

        if conn.video_recording_requested and conn.video_recorder is None:
            conn.start_video_segment(world_engine)
            logger.info(f"[{conn.client_host}] Video recording enabled")
        elif not conn.video_recording_requested and conn.video_recorder is not None:
            conn.video_recorder.end_segment()
            conn.video_recorder = None
            logger.info(f"[{conn.client_host}] Video recording disabled")

    # Model delta — reload if model URI or quantization changed.
    # The engine must be loaded before the seed so that seed_target_size
    # and temporal_compression are resolved from the actual model config.
    model_changed = False
    quant_changed = "quant" in present and quant != world_engine.quant
    if model_uri and (model_uri != world_engine.model_uri or quant_changed):
        verb = "Live model switch" if is_game_loop else "Requested model"
        logger.info(f"[{conn.client_host}] {verb}: {model_uri} (quant={quant})")
        world_engine.set_progress_callback(conn.push_progress, conn.main_loop)
        await world_engine.load_engine(model_uri, quant=quant)
        world_engine.set_progress_callback(None)
        world_engine.seed_frame = None
        session.perceptual_frame_count = 0
        session.max_perceptual_frames = (world_engine.n_frames - 2) * world_engine.temporal_compression
        model_changed = True
        logger.info(f"[{conn.client_host}] Model loaded: {world_engine.model_uri}")

    # Seed delta
    seed_loaded = False
    if seed_data:
        seed_loaded = await load_seed_from_data(conn, world_engine, safety_checker, seed_data, seed_filename)

    if model_changed and not seed_loaded and not world_engine.seed_frame:
        await conn.send_stage(SESSION_WAITING_FOR_SEED)

    ready = seed_loaded or (world_engine.seed_frame is not None)
    return ready, seed_loaded


async def run_sender(conn: Connection) -> None:
    """Drain `conn.frame_queue` and dispatch each entry over the WebSocket.

    Binary frames go via `send_bytes`; Pydantic messages route through
    `conn.send_message`. Exits when `conn.running` flips off or any
    transport error occurs (which also flips `conn.running` to halt
    the receiver and generator)."""
    while conn.running:
        try:
            await conn.frame_ready.wait()
            conn.frame_ready.clear()
            while not conn.frame_queue.empty():
                payload = conn.frame_queue.get_nowait()
                if isinstance(payload, bytes):
                    await conn.websocket.send_bytes(payload)
                else:
                    await conn.send_message(payload)
        except Exception as e:
            logger.error(f"[{conn.client_host}] Sender error: {e}", exc_info=True)
            conn.running = False
            break
