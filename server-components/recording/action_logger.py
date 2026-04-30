"""
Optional per-session action stream recorder.

Writes every consumed input to an NDJSON file under the OS temp directory so
sessions can be replayed against the same model and seed.  Enabled per-session
by the client via the ``action_logging`` flag in the InitRequest.

A new file is created each time the engine resets to a seed or unpauses.
Each file starts with ``session_start`` and ends with ``session_end``.
Frame IDs count latent frames (one per ``gen_frame`` call), not perceptual
sub-frames.

Event records are Pydantic models with a `type` discriminator. The on-disk
NDJSON is one event per line — `event.model_dump_json()` produces compact
JSON without separators tweaks.
"""

import datetime
import tempfile
import threading
import time
from pathlib import Path
from typing import IO, Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from util.server_logging import logger

ACTION_LOG_DIR = Path(tempfile.gettempdir())


# -- Event types ----------------------------------------------------------

_FrozenStrict = ConfigDict(frozen=True, extra="forbid")


class SessionStartEvent(BaseModel):
    model_config = _FrozenStrict
    type: Literal["session_start"] = "session_start"
    ts: float
    frame_id: int
    model: str | None = None
    seed: str | None = None
    # `n_frames` here is actually temporal_compression; kept under this
    # name for replay-tooling compatibility with older recordings.
    n_frames: int
    seed_target_size: list[int] | None = None
    has_prompt_conditioning: bool


class SessionEndEvent(BaseModel):
    model_config = _FrozenStrict
    type: Literal["session_end"] = "session_end"
    ts: float
    frame_id: int


class FrameInputEvent(BaseModel):
    model_config = _FrozenStrict
    type: Literal["frame_input"] = "frame_input"
    ts: float
    frame_id: int
    buttons: list[int]
    mouse_dx: float
    mouse_dy: float
    client_ts: float


class SceneEditEvent(BaseModel):
    model_config = _FrozenStrict
    type: Literal["scene_edit"] = "scene_edit"
    ts: float
    frame_id: int
    prompt: str


ActionEvent = Annotated[
    SessionStartEvent | SessionEndEvent | FrameInputEvent | SceneEditEvent,
    Field(discriminator="type"),
]


# -- Logger ---------------------------------------------------------------


class ActionLogger:
    """Append-only NDJSON writer, one file per segment."""

    def __init__(self, client_host: str) -> None:
        self._client_host = client_host
        self._f: IO[str] | None = None
        self._lock = threading.Lock()
        self._frame_id = 0
        self._path: Path | None = None

    @property
    def is_active(self) -> bool:
        """True if a segment is currently open for writing."""
        return self._f is not None and not self._f.closed

    # -- file management --------------------------------------------------

    def _open_file(self) -> None:
        """Open a fresh file, resetting the frame counter."""
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = ACTION_LOG_DIR / f"action_stream_{ts}.ndjson"
        self._path = path
        self._f = open(path, "w")
        self._frame_id = 0
        logger.info(f"[{self._client_host}] Action stream -> {path}")

    def end_segment(self) -> None:
        """Write session_end and close the current file, if one is open."""
        if self._f is not None and not self._f.closed:
            frame_count = self._frame_id
            path = self._path
            self._write(SessionEndEvent(ts=time.time(), frame_id=self._frame_id))
            self._f.close()
            # Clean up empty recordings (e.g. model loaded then immediately paused)
            if frame_count == 0 and path is not None:
                try:
                    path.unlink(missing_ok=True)
                    logger.info(f"[{self._client_host}] Removed empty action stream: {path}")
                except Exception:
                    pass

    # -- writing ----------------------------------------------------------

    def _write(self, record: BaseModel) -> None:
        if self._f is None or self._f.closed:
            return
        line = record.model_dump_json() + "\n"
        with self._lock:
            self._f.write(line)
            self._f.flush()

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
        self._write(
            SessionStartEvent(
                ts=time.time(),
                frame_id=self._frame_id,
                model=model,
                seed=seed,
                n_frames=temporal_compression,
                seed_target_size=list(seed_target_size) if seed_target_size else None,
                has_prompt_conditioning=has_prompt_conditioning,
            )
        )

    def frame_input(
        self,
        *,
        buttons: set[int],
        mouse_dx: float,
        mouse_dy: float,
        client_ts: float,
    ) -> None:
        self._write(
            FrameInputEvent(
                ts=time.time(),
                frame_id=self._frame_id,
                buttons=sorted(buttons),
                mouse_dx=mouse_dx,
                mouse_dy=mouse_dy,
                client_ts=client_ts,
            )
        )
        self._frame_id += 1

    def scene_edit(self, prompt: str) -> None:
        self._write(SceneEditEvent(ts=time.time(), frame_id=self._frame_id, prompt=prompt))
