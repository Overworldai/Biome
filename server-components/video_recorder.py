"""
Optional per-session video recorder.

Records server-generated frames to an MP4 file via FFmpeg subprocess piping.
Enabled alongside action logging — same lifecycle, same segment boundaries.
Output: video in the client-supplied output directory
(falls back to the OS temp directory if unset).

Encoding settings match worldengine-model-comparison: H.264, CRF 20, medium
preset, yuv420p output, +faststart, no audio.
"""

import datetime
import subprocess
import tempfile
import threading
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from server_logging import logger

DEFAULT_VIDEO_DIR = Path(tempfile.gettempdir())

# Scene-edit overlay — a "Edit: {prompt}" caption baked into the recorded video
# after each successful scene edit. Total visible duration, with the last
# FADE_S fading out.
SCENE_EDIT_OVERLAY_S = 5.0
SCENE_EDIT_OVERLAY_FADE_S = 1.0

# Bundled app font, placed in the engine dir by Biome's unpack step so
# recordings carry Biome's visual identity regardless of the host OS fonts.
FONT_PATH = Path(__file__).parent / "fonts" / "9SALERNO.TTF"


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
        # Scene-edit overlay state. `_overlay_bitmap` is a cropped RGBA region
        # (with the text's own alpha channel) positioned via `_overlay_offset`
        # — per-frame compositing only touches those pixels, not the full frame.
        self._overlay_text: str | None = None
        self._overlay_start_frame: int = 0
        self._overlay_bitmap: np.ndarray | None = None
        self._overlay_offset: tuple[int, int] = (0, 0)

    @property
    def is_active(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def new_segment(self, *, width: int, height: int, fps: int) -> None:
        """End any active segment and start a new video file."""
        self.end_segment()
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        path = self._output_dir / f"{ts}.mp4"
        self._path = path
        self._frame_count = 0
        self._fps = fps
        self._overlay_text = None
        self._overlay_bitmap = None
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

    def note_edit(self, prompt: str) -> None:
        """Trigger a 'Edit: {prompt}' overlay on the next SCENE_EDIT_OVERLAY_S
        of frames. No-op if the recorder isn't active or the prompt is empty."""
        if not self.is_active or not prompt:
            return
        self._overlay_text = prompt
        self._overlay_start_frame = self._frame_count
        # Invalidate the cached bitmap so the next frame re-renders with the
        # new prompt (bitmap stays cached for 5 s, not across edits).
        self._overlay_bitmap = None

    def _ensure_overlay_bitmap(self, frame_w: int, frame_h: int) -> None:
        """Render the overlay bitmap lazily once per edit. Crops to the text
        bbox so per-frame compositing only touches the bottom-left corner."""
        if self._overlay_bitmap is not None or self._overlay_text is None:
            return
        try:
            font_size = max(14, int(frame_h * 0.05))
            font = ImageFont.truetype(str(FONT_PATH), font_size)
        except Exception as e:
            logger.warning(f"[{self._client_host}] Could not load overlay font: {e}")
            self._overlay_text = None
            return

        text = f"Edit: {self._overlay_text}"
        pad = max(8, int(frame_h * 0.02))
        shadow_offset = max(1, font_size // 16)
        # Generous margin around the ink bbox — `textbbox` reports the tight
        # ink box but antialiasing bleed (especially on serifs) can extend
        # a few pixels past it, and raising the baseline keeps descenders
        # from being flush with the frame's bottom edge.
        margin = max(4, font_size // 6)

        # Render into a full-frame RGBA canvas so coordinates match the video.
        canvas = Image.new("RGBA", (frame_w, frame_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(canvas)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        x = pad - bbox[0]
        y = frame_h - pad - text_h - bbox[1] - margin
        # Drop-shadow for contrast over light scenes.
        draw.text((x + shadow_offset, y + shadow_offset), text, font=font, fill=(0, 0, 0, 200))
        draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))

        # Crop with `margin` buffer on all sides of the ink + shadow so the
        # saved texture includes any antialiasing bleed.
        region_x = max(0, x + bbox[0] - margin)
        region_y = max(0, y + bbox[1] - margin)
        region_w = min(frame_w - region_x, text_w + shadow_offset + margin * 2)
        region_h = min(frame_h - region_y, text_h + shadow_offset + margin * 2)
        cropped = canvas.crop((region_x, region_y, region_x + region_w, region_y + region_h))
        self._overlay_bitmap = np.array(cropped)
        self._overlay_offset = (region_x, region_y)

    def _apply_overlay(self, frame: np.ndarray) -> np.ndarray:
        """Composite the active scene-edit overlay onto a single RGB frame.
        Returns the original frame unchanged when no overlay is active."""
        if self._overlay_text is None or self._fps <= 0:
            return frame
        elapsed_s = (self._frame_count - self._overlay_start_frame) / self._fps
        if elapsed_s >= SCENE_EDIT_OVERLAY_S:
            self._overlay_text = None
            self._overlay_bitmap = None
            return frame

        self._ensure_overlay_bitmap(frame.shape[1], frame.shape[0])
        if self._overlay_bitmap is None:
            return frame

        # Linear fade during the trailing FADE_S.
        fade_start = SCENE_EDIT_OVERLAY_S - SCENE_EDIT_OVERLAY_FADE_S
        alpha_mul = 1.0
        if elapsed_s > fade_start:
            alpha_mul = max(0.0, 1.0 - (elapsed_s - fade_start) / SCENE_EDIT_OVERLAY_FADE_S)
        if alpha_mul <= 0.0:
            return frame

        x, y = self._overlay_offset
        rh, rw = self._overlay_bitmap.shape[:2]
        rgb = self._overlay_bitmap[:, :, :3].astype(np.float32)
        alpha = (self._overlay_bitmap[:, :, 3:4].astype(np.float32) / 255.0) * alpha_mul

        out = frame.copy()
        region = out[y : y + rh, x : x + rw].astype(np.float32)
        blended = region * (1.0 - alpha) + rgb * alpha
        out[y : y + rh, x : x + rw] = np.clip(blended, 0, 255).astype(np.uint8)
        return out

    def write_frames(self, frames: list) -> None:
        """Write one or more RGB numpy frames to the video."""
        if self._proc is None or self._proc.stdin is None or self._proc.stdin.closed:
            return
        with self._lock:
            for frame in frames:
                try:
                    to_write = self._apply_overlay(frame)
                    self._proc.stdin.write(to_write.tobytes())
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
