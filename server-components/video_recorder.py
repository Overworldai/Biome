"""
Optional per-session video recorder.

Records server-generated frames to an MP4 file via FFmpeg subprocess piping.
Enabled alongside action logging — same lifecycle, same segment boundaries.
Output: rollout_{timestamp}.mp4 in the client-supplied output directory
(falls back to the OS temp directory if unset).

Encoding settings match worldengine-model-comparison: H.264, CRF 20, medium
preset, yuv420p output, +faststart, no audio.
"""

import datetime
import subprocess
import tempfile
import threading
from pathlib import Path

from server_logging import logger

DEFAULT_VIDEO_DIR = Path(tempfile.gettempdir())


class VideoRecorder:
    """Pipes raw RGB frames to an FFmpeg subprocess, one file per segment."""

    def __init__(self, client_host: str, output_dir: str | None = None) -> None:
        self._client_host = client_host
        self._output_dir = Path(output_dir) if output_dir else DEFAULT_VIDEO_DIR
        try:
            self._output_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            logger.warning(
                f"[{client_host}] Could not create recordings dir {self._output_dir}: {e} "
                f"— falling back to {DEFAULT_VIDEO_DIR}"
            )
            self._output_dir = DEFAULT_VIDEO_DIR
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._path: Path | None = None
        self._frame_count = 0
        self._fps = 0

    @property
    def is_active(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def new_segment(self, *, width: int, height: int, fps: int) -> None:
        """End any active segment and start a new video file."""
        self.end_segment()
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = self._output_dir / f"rollout_{ts}.mp4"
        self._path = path
        self._frame_count = 0
        self._fps = fps
        try:
            self._proc = subprocess.Popen(
                [
                    "ffmpeg", "-y",
                    "-f", "rawvideo", "-pix_fmt", "rgb24",
                    "-s", f"{width}x{height}", "-r", str(fps),
                    "-i", "pipe:0",
                    "-c:v", "libx264", "-preset", "medium",
                    "-crf", "20", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", "-an",
                    str(path),
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            logger.info(f"[{self._client_host}] Video recording -> {path}")
        except FileNotFoundError:
            logger.warning(f"[{self._client_host}] ffmpeg not found — video recording disabled")
            self._proc = None

    def write_frames(self, frames: list) -> None:
        """Write one or more RGB numpy frames to the video."""
        if self._proc is None or self._proc.stdin is None or self._proc.stdin.closed:
            return
        with self._lock:
            for frame in frames:
                try:
                    self._proc.stdin.write(frame.tobytes())
                    self._frame_count += 1
                except (BrokenPipeError, OSError):
                    break

    def end_segment(self) -> None:
        """Finalize the current video, if one is active."""
        if self._proc is None:
            return
        path = self._path
        frame_count = self._frame_count
        fps = self._fps
        try:
            if self._proc.stdin and not self._proc.stdin.closed:
                self._proc.stdin.close()
            # Read stderr before wait() to avoid deadlock when ffmpeg's
            # stderr pipe buffer fills up.
            stderr_bytes = self._proc.stderr.read() if self._proc.stderr else b""
            self._proc.wait(timeout=30)
            if self._proc.returncode != 0:
                stderr = stderr_bytes.decode(errors="replace") if stderr_bytes else ""
                logger.warning(
                    f"[{self._client_host}] FFmpeg exited with rc={self._proc.returncode}: {stderr[:500]}"
                )
        except Exception as e:
            logger.warning(f"[{self._client_host}] Error closing video recorder: {e}")
            try:
                self._proc.kill()
            except Exception:
                pass
        finally:
            self._proc = None
            self._path = None
            self._frame_count = 0
            self._fps = 0

        # Clean up recordings shorter than MIN_DURATION_S — segments this short
        # are almost always accidental (paused right after starting, quick model
        # reload, etc.) and just clutter the recordings list.
        MIN_DURATION_S = 3
        if path is not None:
            duration_s = frame_count / fps if fps > 0 else 0.0
            if frame_count == 0 or duration_s < MIN_DURATION_S:
                try:
                    path.unlink(missing_ok=True)
                    logger.info(
                        f"[{self._client_host}] Removed short video "
                        f"({frame_count} frames, {duration_s:.1f}s): {path}"
                    )
                except Exception:
                    pass
