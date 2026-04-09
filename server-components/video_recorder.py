"""
Optional per-session video recorder.

Records server-generated frames to an MP4 file via FFmpeg subprocess piping.
Enabled alongside action logging — same lifecycle, same segment boundaries.
Output: rollout_{timestamp}.mp4 in the OS temp directory.

Encoding settings match worldengine-model-comparison: H.264, CRF 20, medium
preset, yuv420p output, +faststart, no audio.
"""

import datetime
import subprocess
import tempfile
import threading
from pathlib import Path

from server_logging import logger

VIDEO_DIR = Path(tempfile.gettempdir())


class VideoRecorder:
    """Pipes raw RGB frames to an FFmpeg subprocess, one file per segment."""

    def __init__(self, client_host: str) -> None:
        self._client_host = client_host
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()

    @property
    def is_active(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def new_segment(self, *, width: int, height: int, fps: int) -> None:
        """End any active segment and start a new video file."""
        self.end_segment()
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = VIDEO_DIR / f"rollout_{ts}.mp4"
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
                except (BrokenPipeError, OSError):
                    break

    def end_segment(self) -> None:
        """Finalize the current video, if one is active."""
        if self._proc is None:
            return
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
