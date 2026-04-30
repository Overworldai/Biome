"""
Per-WebSocket-connection mutable state container.

`Connection` bundles the state that used to live as ~25 nonlocals across
the receiver / sender / generator closures inside `websocket_endpoint`.
Created once per connection, passed by reference into every helper.
Fields are mutated in place; the object itself is the long-lived owner.

Step 4's class extractions (Receiver / Sender / Generator) all consume
a `Connection` instance — the object is the seam between the asyncio
loop, the generator thread, and the CUDA executor.

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
class Connection:
    """Per-WebSocket-connection state. One instance for the lifetime of
    the websocket; mutated in place by handler closures. Reference-equality
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

    # ─── Game-loop state (running ↔ paused ↔ resetting) ─────────────
    running: bool = True
    paused: bool = False
    reset_flag: bool = False
    prompt_pending: str | None = None

    # ─── Scene-authoring RPC handoff to generator thread ────────────
    # Receiver posts a {"prompt": str, "future": Future}; generator
    # picks it up at a clean frame boundary and resolves the future.
    scene_edit_request: dict | None = None
    generate_scene_request: dict | None = None

    # Most recent CPU numpy frames, kept so scene_edit can inpaint
    # the last subframe rendered.
    last_generated_cpu_frames: list | None = None

    # ─── Inter-thread channels ──────────────────────────────────────
    # `frame_queue` carries Pydantic models or raw binary frames from
    # the generator thread to the asyncio sender; `frame_ready` is the
    # cross-thread wakeup signal.
    frame_queue: Queue[BaseModel | bytes] = field(default_factory=lambda: Queue(maxsize=16))
    frame_ready: asyncio.Event | None = None  # initialised inside the loop
    progress_queue: asyncio.Queue[StatusMessage] | None = None  # ditto
    log_queue: asyncio.Queue[str] | None = None  # ditto
    main_loop: asyncio.AbstractEventLoop | None = None  # ditto

    # ─── Control input shared between receiver (writes) + generator (reads) ─
    ctrl_buttons: set[int] = field(default_factory=set)
    ctrl_mouse_dx: float = 0.0
    ctrl_mouse_dy: float = 0.0
    ctrl_client_ts: float = 0.0
    ctrl_dirty: bool = False
    ctrl_lock: threading.Lock = field(default_factory=threading.Lock)

    # ─── Cached GPU metrics embedded in frame headers ───────────────
    cached_vram_used_bytes: int = -1
    cached_gpu_util_percent: int = -1
