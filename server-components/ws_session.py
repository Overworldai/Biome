"""
Per-WebSocket-connection state container.

`Connection` bundles the slowly-mutating per-connection state that used
to live as nonlocals across the closures inside `websocket_endpoint`:
init flags, recorder instances, seed metadata, the pending init-RPC
tracker.  Created once per connection, mutated in place by handle_init
and the recorder lifecycle helpers.

Thread/loop-bound state (queues, events, control input, GPU metric
cache) deliberately stays out of `Connection` — those have construction
constraints (asyncio.Event needs the loop) and naturally migrate onto
the extracted Receiver / Generator classes later in step 4.

This module is strict-typed by construction — none of the legacy ignore
rules in pyproject.toml fire on this code. Keep it that way.
"""

from dataclasses import dataclass

from fastapi import WebSocket

from action_logger import ActionLogger
from app_state import AppState
from video_recorder import VideoRecorder


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
