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
import json
import logging
import struct
import threading
import time
from dataclasses import dataclass, field
from queue import Queue
from typing import TYPE_CHECKING

from fastapi import WebSocket, WebSocketDisconnect
from PIL import Image
from pydantic import BaseModel

from action_logger import ActionLogger
from app_state import AppState, SafetyCacheEntry
from progress_stages import StageId
from protocol import (
    CheckSeedSafetyRequest,
    CheckSeedSafetyResponseData,
    ClientMessage,
    ClientMessageAdapter,
    ControlNotif,
    ErrorMessage,
    ErrorSnapshot,
    GenerateSceneRequest,
    InitRequest,
    InitResponseData,
    MessageId,
    PauseNotif,
    PromptNotif,
    ResetNotif,
    ResumeNotif,
    RpcError,
    RpcSuccess,
    SceneEditRequest,
    StatusMessage,
    SystemInfo,
    WarningMessage,
    rpc_err,
    rpc_ok,
)
from safety_cache import save_safety_cache
from scene_authoring import run_generate_scene, run_scene_edit
from video_recorder import RecordingProperties, VideoRecorder

if TYPE_CHECKING:
    from engine_manager import Session, WorldEngineManager
    from image_gen import ImageGenManager
    from safety import SafetyChecker

logger = logging.getLogger(__name__)


def _compute_bytes_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_error_message(
    *,
    message_id: MessageId | None = None,
    message: str | None = None,
    params: dict[str, str] | None = None,
) -> ErrorMessage:
    """Build an ErrorMessage with an attached snapshot of ephemeral state
    (RAM/VRAM/GPU util at error time).  Every outgoing `error` push should
    go through this so bug reports capture what the server was actually
    doing at the failure point. Imports system_info lazily to keep ws_session
    light at module-load time."""
    import system_info as system_info_module

    return ErrorMessage(
        message_id=message_id,
        message=message,
        params=params,
        snapshot=ErrorSnapshot(**system_info_module.capture_error_snapshot()),
    )


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

    async def send_stage(self, stage: StageId) -> None:
        await self.send_message(StatusMessage(stage=stage))

    def push_progress(self, stage: StageId) -> None:
        """Sync callback for `WorldEngineManager.set_progress_callback` —
        safe to call from any thread; enqueues onto `progress_queue` for
        the asyncio drain task to ferry over the websocket."""
        try:
            self.progress_queue.put_nowait(StatusMessage(stage=stage))
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

    # ─── Frame-envelope helpers ────────────────────────────────────
    def update_gpu_metrics(self) -> None:
        """Sample dynamic GPU metrics into the cache. Called every few
        frames from the generator thread; reads back into binary frame
        headers via `build_frame_envelope`."""
        import system_info as system_info_module

        self.cached_vram_used_bytes = system_info_module.get_vram_used_bytes()
        self.cached_gpu_util_percent = system_info_module.get_gpu_util_percent()

    def build_frame_envelope(
        self,
        jpeg: bytes,
        frame_id: int,
        client_ts: float,
        gen_ms: float,
        temporal_compression: int = 1,
        profile: dict | None = None,
    ) -> bytes:
        """Wrap a JPEG-encoded frame in the binary protocol envelope:
        4-byte LE header length, JSON header (frame_id / timing / GPU
        metrics / optional per-frame profile), JPEG payload."""
        header_data: dict = {
            "frame_id": frame_id,
            "client_ts": client_ts,
            "gen_ms": gen_ms,
            "temporal_compression": temporal_compression,
            "vram_used_bytes": self.cached_vram_used_bytes,
            "gpu_util_percent": self.cached_gpu_util_percent,
        }
        if profile is not None:
            header_data.update(profile)
        header = json.dumps(header_data, separators=(",", ":")).encode("utf-8")
        return struct.pack("<I", len(header)) + header + jpeg

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


def build_init_response_data(world_engine: "WorldEngineManager", system_info: dict) -> InitResponseData:
    """Pack post-warmup session metrics into the typed init RPC response."""
    return InitResponseData(
        model=world_engine.model_uri or "",
        inference_fps=world_engine.inference_fps,
        system_info=SystemInfo(**system_info),
    )


async def handle_check_seed_safety(
    state: AppState,
    req: CheckSeedSafetyRequest,
) -> RpcSuccess[CheckSeedSafetyResponseData] | RpcError:
    """Check whether a seed image passes the NSFW classifier. Caches by
    SHA-256 of the raw bytes; results survive across server restarts via
    the on-disk safety cache."""
    if not req.image_data:
        return rpc_err(req.req_id, error=MessageId.SEED_MISSING_DATA.value)

    try:
        image_bytes = base64.b64decode(req.image_data)
    except Exception as e:
        return rpc_err(req.req_id, error=f"Invalid base64 data: {e}")

    img_hash = _compute_bytes_hash(image_bytes)

    cache = state.safety_hash_cache
    if img_hash in cache:
        cached = cache[img_hash]
        return rpc_ok(
            req.req_id,
            CheckSeedSafetyResponseData(is_safe=cached.is_safe, hash=img_hash),
        )

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
    cache[img_hash] = SafetyCacheEntry(
        is_safe=is_safe,
        scores=safety_result.get("scores", {}),
        checked_at=time.time(),
    )
    save_safety_cache(cache)

    return rpc_ok(req.req_id, CheckSeedSafetyResponseData(is_safe=is_safe, hash=img_hash))


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
        if not cached.is_safe:
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
        cache[img_hash] = SafetyCacheEntry(
            is_safe=is_safe,
            scores=safety_result.get("scores", {}),
            checked_at=time.time(),
        )
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
        await conn.send_stage(StageId.SESSION_WAITING_FOR_SEED)

    ready = seed_loaded or (world_engine.seed_frame is not None)
    return ready, seed_loaded


async def run_receiver(
    conn: Connection,
    world_engine: "WorldEngineManager",
    image_gen: "ImageGenManager",
    safety_checker: "SafetyChecker",
    session: "Session",
    button_codes: dict[str, int],
    system_info: dict,
) -> None:
    """Drain inbound websocket messages, dispatch them via the typed
    protocol union. Posts scene-edit / generate-scene futures into
    `conn.scene_edit_request` / `conn.generate_scene_request` for the
    generator thread to resolve at the next clean frame boundary."""
    while conn.running:
        try:
            raw = await conn.websocket.receive_text()
            try:
                parsed: ClientMessage = ClientMessageAdapter.validate_json(raw)
            except Exception as e:
                logger.info(f"[{conn.client_host}] Ignoring invalid game-loop message: {e}")
                continue

            match parsed:
                case InitRequest() as req:
                    # init RPC: apply deltas and respond with metrics.
                    ready, new_seed = await handle_init(
                        conn, world_engine, safety_checker, session, req, is_game_loop=True
                    )
                    if ready:
                        response = rpc_ok(req.req_id, build_init_response_data(world_engine, system_info))
                    else:
                        response = rpc_err(req.req_id, error_id=MessageId.INIT_FAILED)
                    conn.queue_send(response)
                    if new_seed:
                        conn.reset_flag = True

                case SceneEditRequest() as req:
                    # scene_edit is handled by the generator thread at
                    # the next clean frame boundary — post a request and
                    # await the future.
                    prompt = req.prompt.strip()
                    if conn.action_logger is not None:
                        conn.action_logger.scene_edit(prompt)
                    edit_response: RpcSuccess | RpcError
                    if not prompt:
                        edit_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_EMPTY_PROMPT)
                    elif image_gen is None or not image_gen.is_loaded:
                        edit_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_MODEL_NOT_LOADED)
                    elif conn.scene_edit_request is not None:
                        edit_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_ALREADY_IN_PROGRESS)
                    else:
                        import concurrent.futures

                        fut = concurrent.futures.Future()
                        conn.scene_edit_request = {"prompt": prompt, "future": fut}
                        try:
                            preview = await asyncio.wrap_future(fut)
                            edit_response = rpc_ok(req.req_id, preview)
                        except Exception as e:
                            error_id = getattr(e, "message_id", None)
                            if error_id is not None:
                                edit_response = rpc_err(req.req_id, error_id=MessageId(error_id))
                            else:
                                edit_response = rpc_err(req.req_id, error=str(e))
                    conn.queue_send(edit_response)

                case GenerateSceneRequest() as req:
                    # generate_scene: like scene_edit but with a blank
                    # canvas — generates a new seed from a text prompt.
                    prompt = req.prompt.strip()
                    gen_response: RpcSuccess | RpcError
                    if not prompt:
                        gen_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_EMPTY_PROMPT)
                    elif image_gen is None or not image_gen.is_loaded:
                        gen_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_MODEL_NOT_LOADED)
                    elif conn.scene_edit_request is not None or conn.generate_scene_request is not None:
                        gen_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_ALREADY_IN_PROGRESS)
                    else:
                        import concurrent.futures

                        fut = concurrent.futures.Future()
                        conn.generate_scene_request = {"prompt": prompt, "future": fut}
                        try:
                            data = await asyncio.wrap_future(fut)
                            gen_response = rpc_ok(req.req_id, data)
                        except Exception as e:
                            error_id = getattr(e, "message_id", None)
                            if error_id is not None:
                                gen_response = rpc_err(req.req_id, error_id=MessageId(error_id))
                            else:
                                gen_response = rpc_err(req.req_id, error=str(e))
                    conn.queue_send(gen_response)

                case CheckSeedSafetyRequest() as req:
                    seed_response = await handle_check_seed_safety(conn.state, req)
                    conn.queue_send(seed_response)

                case ResetNotif():
                    logger.info(f"[{conn.client_host}] Reset requested")
                    conn.reset_flag = True

                case PauseNotif():
                    conn.paused = True
                    logger.info("[RECV] Paused")

                case ResumeNotif():
                    conn.paused = False
                    logger.info("[RECV] Resumed")

                case PromptNotif() as notif:
                    conn.prompt_pending = notif.prompt.strip()

                case ControlNotif() as notif:
                    if conn.paused:
                        continue
                    if notif.button_codes is not None:
                        buttons = set(notif.button_codes)
                    else:
                        buttons = {button_codes[b.upper()] for b in (notif.buttons or []) if b.upper() in button_codes}
                    with conn.ctrl_lock:
                        conn.ctrl.buttons = buttons
                        conn.ctrl.mouse_dx += notif.mouse_dx
                        conn.ctrl.mouse_dy += notif.mouse_dy
                        if notif.ts is not None:
                            conn.ctrl.client_ts = notif.ts
                        conn.ctrl.dirty = True

        except WebSocketDisconnect:
            logger.info(f"[{conn.client_host}] Client disconnected")
            conn.running = False
            break
        except Exception as e:
            logger.error(f"[{conn.client_host}] Receiver error: {e}", exc_info=True)
            conn.running = False
            break


def reset_engine(
    conn: Connection,
    world_engine: "WorldEngineManager",
    session: "Session",
) -> None:
    """Restore the original seed and reset the engine session. Synchronous —
    runs CUDA work via the executor. Called from the generator thread when
    `reset_flag` flips, `prompt_pending` arrives, or an auto-reset triggers
    at the perceptual frame limit."""
    if world_engine.original_seed_frame is not None:
        world_engine.seed_frame = world_engine.original_seed_frame
    world_engine.set_progress_callback(conn.push_progress, conn.main_loop)
    world_engine.init_session()
    world_engine.set_progress_callback(None)
    session.perceptual_frame_count = 0
    logger.info(f"[{conn.client_host}] Engine Reset")


@dataclass
class _PendingFlush:
    """One batch of CPU frames stashed by the inference path so the next
    loop iteration can JPEG-encode + send them while the GPU works on the
    following frame. The fields cover both the frames themselves and the
    timing breakdown that ends up in the binary frame header."""

    cpu_frames: list
    gen_time: float
    temporal_compression: int
    client_ts: float
    t_infer_start: float
    t_infer: float
    t_sync: float


def run_generator(
    conn: Connection,
    world_engine: "WorldEngineManager",
    session: "Session",
) -> None:
    """The per-session inference loop, run on a dedicated thread.

    Submits gen_frame to the cuda_executor, overlaps JPEG encoding of the
    previous batch with the next GPU pass, drains scene-edit / generate-scene
    futures at clean frame boundaries, applies frame pacing, and recovers
    from CUDA errors via WorldEngineManager.recover_from_cuda_error.
    """
    import torch

    pending: _PendingFlush | None = None

    def _flush_pending() -> None:
        """JPEG-encode + queue any pending CPU frames."""
        nonlocal pending
        if pending is None:
            return
        p = pending
        pending = None

        t_enc_start = time.perf_counter()
        encoded = [world_engine._numpy_to_jpeg(rgb) for rgb in p.cpu_frames]
        t_enc = time.perf_counter()

        if session.perceptual_frame_count % 5 == 0:
            conn.update_gpu_metrics()
        t_metrics = time.perf_counter()

        for jpeg in encoded:
            session.perceptual_frame_count += 1
            t_queued = time.perf_counter()
            profile = {
                "t_infer_ms": round((p.t_infer - p.t_infer_start) * 1000, 1),
                "t_sync_ms": round((p.t_sync - p.t_infer) * 1000, 1),
                "t_enc_ms": round((t_enc - t_enc_start) * 1000, 1),
                "t_metrics_ms": round((t_metrics - t_enc) * 1000, 1),
                "t_overhead_ms": round((t_queued - t_metrics) * 1000, 1),
            }
            conn.queue_send(
                conn.build_frame_envelope(
                    jpeg,
                    session.perceptual_frame_count,
                    p.client_ts,
                    p.gen_time,
                    temporal_compression=p.temporal_compression,
                    profile=profile,
                )
            )

        if session.perceptual_frame_count % 60 == 0:
            logger.info(f"[{conn.client_host}] Sent frame {session.perceptual_frame_count} (gen={p.gen_time:.1f}ms)")

    gen_was_paused = False
    next_frame_time = 0.0  # perf_counter target for frame pacing

    while conn.running:
        if conn.paused:
            _flush_pending()
            if not gen_was_paused:
                conn.end_action_log_segment()
                conn.end_video_segment()
                gen_was_paused = True

            # Handle generate_scene while paused (it's triggered from
            # the pause menu, so the generator must process it here).
            if conn.generate_scene_request is not None:
                req = conn.generate_scene_request
                conn.generate_scene_request = None
                try:
                    data = run_generate_scene(conn.state, req["prompt"], conn.biome_version)
                    session.perceptual_frame_count = 0
                    req["future"].set_result(data)
                    # Send the generated seed as a single frame so the pause
                    # overlay background updates to show the new scene.
                    seed = world_engine.seed_frame
                    if seed.dim() == 4:
                        seed = seed[0]  # First subframe for multiframe models
                    seed_jpeg = world_engine.frame_to_jpeg(seed)
                    conn.queue_send(conn.build_frame_envelope(seed_jpeg, session.perceptual_frame_count, 0.0, 0.0))
                except Exception as e:
                    logger.error(f"[GENERATE_SCENE] Failed: {e}", exc_info=True)
                    req["future"].set_exception(e)

            time.sleep(0.01)
            next_frame_time = 0.0
            continue

        if gen_was_paused:
            gen_was_paused = False
            conn.start_action_log_segment(world_engine)
            conn.start_video_segment(world_engine)

        try:
            # Start frame timer before pacing sleep so gen_time
            # reflects actual frame-to-frame throughput.
            t0 = time.perf_counter()

            # Frame pacing: sleep until target time, just before
            # reading input, so we use the freshest controls.
            if conn.cap_inference_fps and next_frame_time > 0.0:
                sleep_time = next_frame_time - time.perf_counter()
                if sleep_time > 0.001:
                    time.sleep(sleep_time)

            if conn.prompt_pending is not None:
                _flush_pending()
                conn.prompt_pending = None
                reset_engine(conn, world_engine, session)
                conn.start_action_log_segment(world_engine)
                conn.start_video_segment(world_engine)
                next_frame_time = 0.0

            # Auto-reset at context length limit (single-frame models only;
            # multiframe models don't support mid-session reset).
            auto_reset = (
                not world_engine.is_multiframe and session.perceptual_frame_count >= session.max_perceptual_frames
            )
            if conn.reset_flag or auto_reset:
                _flush_pending()
                if auto_reset:
                    logger.info(f"[{conn.client_host}] Auto-reset at frame limit")
                reset_engine(conn, world_engine, session)
                conn.reset_flag = False
                conn.start_action_log_segment(world_engine)
                conn.start_video_segment(world_engine)
                next_frame_time = 0.0

            # Handle pending scene edit — runs inpainting on the last
            # subframe from the most recent gen_frame, then appends.
            if conn.scene_edit_request is not None and conn.last_generated_cpu_frames is not None:
                req = conn.scene_edit_request
                conn.scene_edit_request = None
                _flush_pending()
                try:
                    preview = run_scene_edit(conn.state, req["prompt"], conn.last_generated_cpu_frames)
                    session.perceptual_frame_count = 0
                    if conn.video_recorder is not None:
                        conn.video_recorder.note_edit(req["prompt"])
                    req["future"].set_result(preview)
                except Exception as e:
                    logger.error(f"[SCENE_EDIT] Failed: {e}", exc_info=True)
                    req["future"].set_exception(e)

            # Handle pending generate_scene — creates a new seed from
            # a text prompt (blank canvas + inpainting pipeline).
            if conn.generate_scene_request is not None:
                req = conn.generate_scene_request
                conn.generate_scene_request = None
                _flush_pending()
                try:
                    data = run_generate_scene(conn.state, req["prompt"], conn.biome_version)
                    session.perceptual_frame_count = 0
                    req["future"].set_result(data)
                except Exception as e:
                    logger.error(f"[GENERATE_SCENE] Failed: {e}", exc_info=True)
                    req["future"].set_exception(e)

            with conn.ctrl_lock:
                if not conn.ctrl.dirty:
                    buttons = None
                else:
                    buttons = set(conn.ctrl.buttons)
                    mouse_dx = float(conn.ctrl.mouse_dx)
                    mouse_dy = float(conn.ctrl.mouse_dy)
                    client_ts = conn.ctrl.client_ts
                    conn.ctrl.mouse_dx = 0.0
                    conn.ctrl.mouse_dy = 0.0
                    conn.ctrl.dirty = False

            if buttons is None:
                _flush_pending()
                time.sleep(0.001)
                continue

            ctrl = world_engine.CtrlInput(button=buttons, mouse=(mouse_dx, mouse_dy))

            if conn.action_logger is not None:
                conn.action_logger.frame_input(
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
            if conn.cap_inference_fps:
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
            conn.last_generated_cpu_frames = cpu_frames

            if conn.video_recorder is not None:
                conn.video_recorder.write_frames(cpu_frames)

            # Stash this batch's CPU frames for deferred JPEG encoding
            pending = _PendingFlush(
                cpu_frames=cpu_frames,
                gen_time=gen_time,
                temporal_compression=temporal_compression,
                client_ts=client_ts,
                t_infer_start=t_infer_start,
                t_infer=t_infer,
                t_sync=t_sync,
            )

        except Exception as cuda_err:
            pending = None

            error_msg = str(cuda_err)
            is_cuda_error = any(
                keyword in error_msg.lower() for keyword in ["cuda", "cublas", "graph capture", "offset increment"]
            )

            if is_cuda_error:
                logger.error(f"[{conn.client_host}] CUDA error detected: {cuda_err}")
                try:
                    recovery_success = world_engine.recover_from_cuda_error()
                except Exception:
                    recovery_success = False

                if recovery_success:
                    conn.queue_send(
                        StatusMessage(
                            stage=StageId.SESSION_RESET,
                            message="Recovered from CUDA error - engine reset",
                        )
                    )
                    logger.info(f"[{conn.client_host}] Successfully recovered from CUDA error")
                else:
                    conn.queue_send(build_error_message(message_id=MessageId.CUDA_RECOVERY_FAILED))
                    logger.error(f"[{conn.client_host}] Failed to recover from CUDA error")
                    conn.running = False
                    break
            else:
                logger.error(f"[{conn.client_host}] Generation error: {cuda_err}", exc_info=True)
                conn.queue_send(build_error_message(message=str(cuda_err)))
                conn.running = False
                break

    # Flush the last batch before the thread exits
    try:
        _flush_pending()
    except Exception:
        pass


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
