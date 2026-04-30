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

Handlers live in `ws_handlers.py`; the receiver / sender / generator
workers live in `ws_runner.py`. This module owns connection state only.

This module is strict-typed by construction — none of the legacy ignore
rules in pyproject.toml fire on this code. Keep it that way.
"""

import asyncio
import json
import logging
import struct
import threading
from dataclasses import dataclass, field
from queue import Queue
from typing import TYPE_CHECKING

from fastapi import WebSocket
from pydantic import BaseModel

from action_logger import ActionLogger
from app_state import AppState
from protocol import (
    ErrorMessage,
    MessageId,
    StageId,
    StatusMessage,
    WarningMessage,
)
from video_recorder import RecordingProperties, VideoRecorder

if TYPE_CHECKING:
    from engine_manager import WorldEngineManager

logger = logging.getLogger(__name__)


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
        snapshot=system_info_module.capture_error_snapshot(),
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

    # ─── Frame counters (perceptual, post-temporal-compression) ────
    # `max_perceptual_frames` is rewritten in `handle_init` once the
    # model loads (= (n_frames - 2) * temporal_compression). The
    # pre-load default matches the typical 4096-frame context, which
    # auto-reset uses to bound single-frame sessions.
    perceptual_frame_count: int = 0
    max_perceptual_frames: int = 4094

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

    # ─── Lifecycle helpers (asyncio thread; awaited) ───────────────
    async def run_progress_drain(self) -> None:
        """Forward `progress_queue` entries (enqueued by the engine's
        sync progress_callback from the CUDA thread) onto the websocket.
        Run as an asyncio task; cancel to stop."""
        try:
            while True:
                msg = await self.progress_queue.get()
                try:
                    await self.send_message(msg)
                except Exception:
                    break
        except asyncio.CancelledError:
            pass

    async def send_initial_frame(self, world_engine: "WorldEngineManager") -> None:
        """Encode the loaded seed as frame 0 and dispatch it so the client
        has something to render before the gen loop starts."""
        seed = world_engine.seed_frame
        assert seed is not None, "send_initial_frame requires a loaded seed"
        first_subframe = seed[0] if world_engine.is_multiframe else seed
        jpeg = await asyncio.to_thread(world_engine.frame_to_jpeg, first_subframe)
        header = json.dumps(
            {"frame_id": 0, "client_ts": 0, "gen_ms": 0},
            separators=(",", ":"),
        ).encode("utf-8")
        await self.websocket.send_bytes(struct.pack("<I", len(header)) + header + jpeg)

    def start_recording_segments(self, world_engine: "WorldEngineManager") -> None:
        """Construct the action logger (if logging requested) and open
        fresh action-log + video-recording segments. Idempotent; called
        on session start and after a reset."""
        if self.action_logging_requested and self.action_logger is None:
            self.action_logger = ActionLogger(self.client_host)
        self.start_action_log_segment(world_engine)
        self.start_video_segment(world_engine)

    def teardown(
        self,
        world_engine: "WorldEngineManager | None",
        *tasks: asyncio.Task[None] | None,
    ) -> None:
        """End-of-session cleanup. Cancels per-connection tasks, unhooks
        the engine progress callback, ends recorder segments, drops the
        TeeStream registration, and logs the disconnect summary. Safe to
        call from `finally` whether or not the session reached game-loop."""
        from server_logging import TeeStream

        for task in tasks:
            if task is not None:
                task.cancel()
        TeeStream.unregister_client(self.log_queue)
        if world_engine is not None:
            world_engine.set_progress_callback(None)
        self.end_action_log_segment()
        self.end_video_segment()
        logger.info(f"[{self.client_host}] Disconnected (frames: {self.perceptual_frame_count})")
