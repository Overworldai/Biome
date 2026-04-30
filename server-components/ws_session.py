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
import threading
from dataclasses import dataclass, field
from queue import Queue

from fastapi import WebSocket
from pydantic import BaseModel

from action_logger import ActionLogger
from app_state import AppState
from protocol import StatusMessage
from video_recorder import VideoRecorder


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
