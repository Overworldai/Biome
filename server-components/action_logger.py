"""
Optional per-session action stream recorder.

Writes every consumed input to an NDJSON file under the OS temp directory so
sessions can be replayed against the same model and seed.  Enabled per-session
by the client via the ``action_logging`` flag in the ``set_model`` message.

A new file is created each time the engine resets to a seed or unpauses.
Each file starts with ``session_start`` and ends with ``session_end``.
Frame IDs count latent frames (one per ``gen_frame`` call), not perceptual
sub-frames.
"""

import datetime
import json
import tempfile
import threading
import time
from pathlib import Path
from typing import Literal, TypedDict, Union

from server_logging import logger

ACTION_LOG_DIR = Path(tempfile.gettempdir())

# -- Event types ----------------------------------------------------------


class _BaseEvent(TypedDict):
    ts: float
    frame_id: int


class SessionStartEvent(_BaseEvent):
    type: Literal["session_start"]
    model: str | None
    seed: str | None
    n_frames: int  # Actually temporal_compression; kept as n_frames for protocol compatibility
    seed_target_size: list[int] | None
    has_prompt_conditioning: bool


class SessionEndEvent(_BaseEvent):
    type: Literal["session_end"]


class FrameInputEvent(_BaseEvent):
    type: Literal["frame_input"]
    buttons: list[int]
    mouse_dx: float
    mouse_dy: float
    client_ts: float


class SceneEditEvent(_BaseEvent):
    type: Literal["scene_edit"]
    prompt: str


ActionEvent = Union[
    SessionStartEvent,
    SessionEndEvent,
    FrameInputEvent,
    SceneEditEvent,
]


# -- Logger ---------------------------------------------------------------


class ActionLogger:
    """Append-only NDJSON writer, one file per segment."""

    def __init__(self, client_host: str) -> None:
        self._client_host = client_host
        self._f = None
        self._lock = threading.Lock()
        self._frame_id = 0

    @property
    def is_active(self) -> bool:
        """True if a segment is currently open for writing."""
        return self._f is not None and not self._f.closed

    # -- file management --------------------------------------------------

    def _open_file(self) -> None:
        """Open a fresh file, resetting the frame counter."""
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = ACTION_LOG_DIR / f"action_stream_{ts}.ndjson"
        self._f = open(path, "w")
        self._frame_id = 0
        logger.info(f"[{self._client_host}] Action stream -> {path}")

    def end_segment(self) -> None:
        """Write session_end and close the current file, if one is open."""
        if self._f is not None and not self._f.closed:
            self._write(SessionEndEvent(**self._base(), type="session_end"))
            self._f.close()

    # -- writing ----------------------------------------------------------

    def _write(self, record: ActionEvent) -> None:
        if self._f is None or self._f.closed:
            return
        line = json.dumps(record, separators=(",", ":")) + "\n"
        with self._lock:
            self._f.write(line)
            self._f.flush()

    def _base(self) -> _BaseEvent:
        return _BaseEvent(ts=time.time(), frame_id=self._frame_id)

    # -- high-level events ------------------------------------------------

    def new_segment(
        self,
        *,
        model: str | None,
        seed: str | None,
        temporal_compression: int,
        seed_target_size: tuple[int, ...] | None,
        has_prompt_conditioning: bool,
    ) -> None:
        """End any active segment, open a new file, and write the header."""
        self.end_segment()
        self._open_file()
        self._write(SessionStartEvent(
            **self._base(),
            type="session_start",
            model=model,
            seed=seed,
            n_frames=temporal_compression,
            seed_target_size=list(seed_target_size) if seed_target_size else None,
            has_prompt_conditioning=has_prompt_conditioning,
        ))

    def frame_input(
        self,
        *,
        buttons: set[int],
        mouse_dx: float,
        mouse_dy: float,
        client_ts: float,
    ) -> None:
        self._write(FrameInputEvent(
            **self._base(),
            type="frame_input",
            buttons=sorted(buttons),
            mouse_dx=mouse_dx,
            mouse_dy=mouse_dy,
            client_ts=client_ts,
        ))
        self._frame_id += 1

    def scene_edit(self, prompt: str) -> None:
        self._write(SceneEditEvent(**self._base(), type="scene_edit", prompt=prompt))
