"""
WorldEngine manager — owns the loaded world-engine model and the
device-side state machine that drives frame streaming.
"""

# pyright: reportMissingParameterType=none, reportMissingTypeStubs=none, reportPrivateImportUsage=none, reportUnknownArgumentType=none, reportUnknownLambdaType=none, reportUnknownMemberType=none, reportUnknownParameterType=none, reportUnknownVariableType=none

import asyncio
import base64
import contextlib
import gc
import io
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F  # noqa: N812  -- canonical alias used throughout the PyTorch ecosystem
from PIL import Image
from world_engine import CtrlInput, WorldEngine

try:
    import simplejpeg
except ImportError:
    simplejpeg = None

from engine import devices
from engine.devices import WORLD_ENGINE_DEVICE
from server.protocol import StageId

logger = logging.getLogger(__name__)


# ============================================================================
# Configuration
# ============================================================================

DEFAULT_N_FRAMES = 4096
JPEG_QUALITY = 85
DEFAULT_INFERENCE_FPS = 60


class QuantUnsupportedError(RuntimeError):
    """Warmup detected that the active quantization mode is unsupported on
    this device (raised on `compute capability` / `scaled_mm` torch errors).
    Carries no payload — callers map it to `MessageId.QUANT_UNSUPPORTED_GPU`
    with the engine's `quant` field as a param."""


class EngineNotLoadedError(RuntimeError):
    """Raised when an operation requires the WorldEngine but no model is
    currently loaded. Use `WorldEngineManager.is_loaded` to gate calls."""

    def __init__(self) -> None:
        super().__init__("WorldEngine is not loaded")


class SeedFrameNotSetError(RuntimeError):
    """Raised when an operation requires `WorldEngineManager.seed_frame` to
    be populated but it is None."""

    def __init__(self) -> None:
        super().__init__("Seed frame is not set")


class ModelUriRequiredError(ValueError):
    """Raised when `load_engine` is called without a non-empty model URI —
    the client is required to specify a model."""

    def __init__(self) -> None:
        super().__init__("model_uri is required — the client must specify a model")


class UnsupportedModelTypeError(RuntimeError):
    """Raised when the loaded engine's `model_cfg.model_type` is missing or
    not in `_MODEL_DEFAULTS`. Carries the offending value and the supported
    keys so callers can produce a useful error."""

    def __init__(self, model_type: object, supported: list[str]) -> None:
        self.model_type = model_type
        self.supported = supported
        super().__init__(f"Unsupported model_type {model_type!r}; supported: {', '.join(supported)}")


@dataclass(frozen=True)
class ModelConfig:
    """Runtime config resolved per loaded model. Single source of truth —
    every engine-manager consumer reads from a `ModelConfig` instance rather
    than from individual fields scattered across `WorldEngineManager`."""

    label: str
    temporal_compression: int
    seed_target_size: tuple[int, int]
    has_prompt_conditioning: bool
    n_frames: int
    inference_fps: int

    @property
    def is_multiframe(self) -> bool:
        return self.temporal_compression > 1


# Per-model defaults; overridden by attributes on the engine's `model_cfg`
# at load time. Indexed by `model_cfg.model_type` (the only place we touch
# the third-party world_engine config object's untyped attributes).
_MODEL_DEFAULTS: dict[str, ModelConfig] = {
    "waypoint-1": ModelConfig(
        label="waypoint-1 (single-frame)",
        temporal_compression=1,
        seed_target_size=(360, 640),
        has_prompt_conditioning=False,
        n_frames=DEFAULT_N_FRAMES,
        inference_fps=DEFAULT_INFERENCE_FPS,
    ),
    "waypoint-1.5": ModelConfig(
        label="waypoint-1.5 (multi-frame)",
        temporal_compression=4,
        seed_target_size=(720, 1280),
        has_prompt_conditioning=False,
        n_frames=DEFAULT_N_FRAMES,
        inference_fps=DEFAULT_INFERENCE_FPS,
    ),
}


def model_config_from_engine_cfg(engine_model_cfg: object) -> ModelConfig:
    """Resolve runtime config from per-model defaults overridden by the
    engine's untyped `model_cfg` object. The `getattr` calls here are the
    only place in the codebase that touches third-party world_engine
    attributes defensively — every other consumer reads typed fields off
    the returned `ModelConfig`."""
    model_type = getattr(engine_model_cfg, "model_type", None)
    if not isinstance(model_type, str) or model_type not in _MODEL_DEFAULTS:
        raise UnsupportedModelTypeError(model_type, sorted(_MODEL_DEFAULTS))
    base = _MODEL_DEFAULTS[model_type]
    return ModelConfig(
        label=base.label,
        temporal_compression=int(getattr(engine_model_cfg, "temporal_compression", base.temporal_compression)),
        seed_target_size=base.seed_target_size,
        has_prompt_conditioning=getattr(engine_model_cfg, "prompt_conditioning", None) is not None,
        n_frames=int(getattr(engine_model_cfg, "n_frames", base.n_frames)),
        inference_fps=int(getattr(engine_model_cfg, "inference_fps", base.inference_fps)),
    )


# ============================================================================
# WorldEngine Manager
# ============================================================================


class WorldEngineManager:
    """Manages WorldEngine state and operations."""

    def __init__(self):
        # `engine` and `model_config` are populated together by `load_engine`;
        # both being None unambiguously means "no model loaded yet". The
        # convenience @property delegators below raise on access pre-load,
        # so callers must either check `is_loaded` or be downstream of the
        # AppState-level startup-complete gate.
        self._engine = None
        self.model_config: ModelConfig | None = None
        self.seed_frame = None
        self.original_seed_frame = None  # Preserved across scene edits for U-key reset
        self.model_uri: str | None = None
        self.quant: str | None = None
        self.engine_warmed_up = False
        self._progress_callback = None
        self._progress_loop = None
        # Prevent concurrent model loads from overlapping across websocket sessions.
        self._model_load_lock = asyncio.Lock()
        # Single-threaded executor for device operations to maintain thread-local
        # storage — critical for compiled graphs that must run on the same
        # thread they were compiled in.
        self._device_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="device-thread")

    @property
    def is_loaded(self) -> bool:
        return self._engine is not None and self.model_config is not None

    def _require_config(self) -> ModelConfig:
        if self.model_config is None:
            raise EngineNotLoadedError
        return self.model_config

    def _require_engine(self) -> WorldEngine:
        if self._engine is None:
            raise EngineNotLoadedError
        return self._engine

    @property
    def n_frames(self) -> int:
        return self._require_config().n_frames

    @property
    def temporal_compression(self) -> int:
        return self._require_config().temporal_compression

    @property
    def is_multiframe(self) -> bool:
        return self._require_config().is_multiframe

    @property
    def seed_target_size(self) -> tuple[int, int]:
        return self._require_config().seed_target_size

    @property
    def has_prompt_conditioning(self) -> bool:
        return self._require_config().has_prompt_conditioning

    @property
    def inference_fps(self) -> int:
        return self._require_config().inference_fps

    def set_progress_callback(self, callback, loop=None):
        """Set a progress callback and event loop for cross-thread reporting."""
        self._progress_callback = callback
        self._progress_loop = loop

    def _report_progress(self, stage: StageId):
        """Report progress from any thread (including the device thread)."""
        cb = self._progress_callback
        loop = self._progress_loop
        if cb is None:
            return
        if loop is not None:
            loop.call_soon_threadsafe(cb, stage)
        else:
            cb(stage)

    def _log_device_memory(self, stage: str):
        """Log device memory usage for model-switch diagnostics."""
        if not devices.is_available():
            return
        try:
            allocated = devices.memory_allocated() / (1024**3)
            reserved = devices.memory_reserved() / (1024**3)
            logger.info(f"[DEVICE] {stage}: allocated={allocated:.2f} GiB reserved={reserved:.2f} GiB")
        except Exception:  # noqa: BLE001  -- best-effort diagnostics; never let a logging failure break the caller
            pass

    async def _run_on_device_thread(self, fn):
        """Run callable on the dedicated device thread."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._device_executor, fn)

    def _free_device_memory_sync(self):
        """Best-effort cleanup of device allocations and compiled graph caches."""
        gc.collect()
        if not devices.is_available():
            return

        with contextlib.suppress(Exception):
            devices.synchronize()

        # Clear compiled function/graph caches that can retain private pools.
        with contextlib.suppress(Exception):
            devices.reset_compiled_graphs()

        with contextlib.suppress(Exception):
            devices.empty_cache()

        with contextlib.suppress(Exception):
            devices.ipc_collect()

    def _unload_engine_sync(self):
        """Drop current engine/tensors and aggressively free device memory.
        Resets model_config to None so accidental access on the unloaded
        manager raises rather than returning stale per-model defaults."""
        self._engine = None
        self.model_config = None
        self.seed_frame = None
        self.engine_warmed_up = False
        self._free_device_memory_sync()

    def _load_seed_from_file_sync(self, file_path: str) -> torch.Tensor | None:
        """Synchronous helper to load a seed frame from a file path."""
        try:
            img = Image.open(file_path).convert("RGB")
            img_tensor = torch.from_numpy(np.array(img)).permute(2, 0, 1).unsqueeze(0).float()
            frame = F.interpolate(
                img_tensor,
                size=self.seed_target_size,
                mode="bilinear",
                align_corners=False,
            )[0]
            frame = frame.to(dtype=torch.uint8, device=WORLD_ENGINE_DEVICE).permute(1, 2, 0).contiguous()
            if self.is_multiframe:
                frame = frame.unsqueeze(0).expand(self.temporal_compression, -1, -1, -1).contiguous()
        except Exception:
            logger.exception(f"Failed to load seed from file {file_path}")
            return None
        else:
            return frame

    async def load_seed_from_file(self, file_path: str) -> torch.Tensor | None:
        """Load a seed frame from a file path (async wrapper)."""
        return await self._run_on_device_thread(lambda: self._load_seed_from_file_sync(file_path))

    def _load_seed_from_base64_sync(self, base64_data: str) -> torch.Tensor | None:
        """Synchronous helper to load a seed frame from base64 encoded data."""
        try:
            img_data = base64.b64decode(base64_data)
            img = Image.open(io.BytesIO(img_data)).convert("RGB")
            img_tensor = torch.from_numpy(np.array(img)).permute(2, 0, 1).unsqueeze(0).float()
            frame = F.interpolate(
                img_tensor,
                size=self.seed_target_size,
                mode="bilinear",
                align_corners=False,
            )[0]
            frame = frame.to(dtype=torch.uint8, device=WORLD_ENGINE_DEVICE).permute(1, 2, 0).contiguous()
            if self.is_multiframe:
                frame = frame.unsqueeze(0).expand(self.temporal_compression, -1, -1, -1).contiguous()
        except Exception:
            logger.exception("Failed to load seed from base64")
            return None
        else:
            return frame

    async def load_seed_from_base64(self, base64_data: str) -> torch.Tensor | None:
        """Load a seed frame from base64 encoded data (async wrapper)."""
        return await self._run_on_device_thread(lambda: self._load_seed_from_base64_sync(base64_data))

    async def load_engine(self, model_uri: str, quant: str | None = None):
        """Initialize or switch the WorldEngine model.

        model_uri is required — the server does not have a default model.
        The client must always specify which model to load.
        """
        if not model_uri or not model_uri.strip():
            raise ModelUriRequiredError
        async with self._model_load_lock:
            requested_model = model_uri.strip()
            requested_quant = quant or None  # Normalize empty string to None

            model_unchanged = requested_model == self.model_uri
            quant_unchanged = requested_quant == self.quant

            if self._engine is not None and model_unchanged and quant_unchanged:
                logger.info(f"[ENGINE] Model already loaded: {requested_model} (quant={self.quant})")
                return

            if self._engine is not None:
                if not model_unchanged:
                    logger.info(f"[ENGINE] Switching model: {self.model_uri} -> {requested_model}")
                if not quant_unchanged:
                    logger.info(f"[ENGINE] Switching quant: {self.quant} -> {requested_quant}")
                self._log_device_memory("before unload")
                await self._run_on_device_thread(self._unload_engine_sync)
                self._log_device_memory("after unload")

            # Always run a pre-load cleanup pass. This helps release residual allocations
            # from previous failed loads and reduces allocator fragmentation.
            self._log_device_memory("before pre-load cleanup")
            await self._run_on_device_thread(self._free_device_memory_sync)
            self._log_device_memory("after pre-load cleanup")

            logger.info("=" * 60)
            logger.info("BIOME ENGINE STARTUP")
            logger.info("=" * 60)
            self._report_progress(StageId.SESSION_LOADING_MODEL)
            logger.info(f"[1/3] Loading model: {requested_model}")
            logger.info(f"      Quantization: {requested_quant}")
            logger.info(f"      Device: {WORLD_ENGINE_DEVICE}")

            model_start = time.perf_counter()
            dtype_attempts = [torch.bfloat16, torch.float16]
            new_engine = None
            last_error = None
            selected_dtype = None

            for dtype in dtype_attempts:
                try:
                    logger.info(f"[1/3] Attempting load with dtype={dtype}")

                    def _create_engine(dtype=dtype):
                        return WorldEngine(
                            requested_model,
                            device=WORLD_ENGINE_DEVICE,
                            quant=requested_quant,
                            dtype=dtype,
                        )

                    new_engine = await self._run_on_device_thread(_create_engine)
                    selected_dtype = dtype
                    break
                except devices.OutOfMemoryError as e:
                    last_error = e
                    logger.warning(
                        f"[1/3] OOM loading {requested_model} dtype={dtype}; retrying with lower memory settings"
                    )
                    await self._run_on_device_thread(self._unload_engine_sync)
                    self._log_device_memory("after OOM cleanup")
                except Exception as e:  # noqa: BLE001  -- WorldEngine init can raise from torch / HF / world_engine; we capture and re-raise below
                    last_error = e
                    # Clear partially-allocated model state after failed initialization.
                    await self._run_on_device_thread(self._unload_engine_sync)
                    self._log_device_memory("after failed load cleanup")
                    break

            if new_engine is None:
                raise (last_error if last_error is not None else RuntimeError("Failed to initialize WorldEngine"))

            self._report_progress(StageId.SESSION_LOADING_WEIGHTS)
            self._engine = new_engine
            logger.info(f"[1/3] Model loaded in {time.perf_counter() - model_start:.2f}s")
            logger.info(f"[1/3] Loaded with dtype={selected_dtype}")
            self._log_device_memory("after load")

            # Resolve typed runtime config from per-model defaults overridden
            # by the engine's model_cfg attributes.
            self.model_config = model_config_from_engine_cfg(self._engine.model_cfg)
            cfg = self.model_config
            logger.info(f"[1/3] Model type: {cfg.label}")
            logger.info(f"[1/3] Context length (n_frames): {cfg.n_frames}")
            logger.info(f"[1/3] Temporal compression: {cfg.temporal_compression}")
            logger.info(f"[1/3] Seed target size: {cfg.seed_target_size}")
            logger.info(f"[1/3] Prompt conditioning: {cfg.has_prompt_conditioning}")

            self._report_progress(StageId.SESSION_LOADING_DONE)
            self.model_uri = requested_model
            self.quant = requested_quant

            # Keep any existing seed frame. Server-side set_model flow explicitly clears
            # seed_frame when a new seed is required after a model switch.
            if self.seed_frame is None:
                logger.info("[2/3] Seed frame: waiting for client to provide initial seed")
            else:
                logger.info("[2/3] Seed frame: preserved existing seed")

            logger.info("[3/3] Engine initialization complete")
            logger.info("=" * 60)
            logger.info("SERVER READY - Waiting for WebSocket connections on /ws")
            logger.info("=" * 60)

    @staticmethod
    def tensor_to_numpy(frame: torch.Tensor):
        """Transfer a frame tensor to a CPU numpy array (uint8 RGB)."""
        if frame.dtype != torch.uint8:
            frame = frame.clamp(0, 255).to(torch.uint8)
        return frame.cpu().contiguous().numpy()

    @staticmethod
    def numpy_to_jpeg(rgb, quality: int = JPEG_QUALITY) -> bytes:
        """Encode a CPU numpy RGB array to JPEG bytes."""
        if simplejpeg is not None:
            return simplejpeg.encode_jpeg(rgb, quality=quality, colorspace="RGB")
        img = Image.fromarray(rgb, mode="RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        return buf.getvalue()

    def frame_to_jpeg(self, frame: torch.Tensor, quality: int = JPEG_QUALITY) -> bytes:
        """Convert frame tensor to JPEG bytes using simplejpeg (fast) or PIL (fallback)."""
        return self.numpy_to_jpeg(self.tensor_to_numpy(frame), quality)

    @property
    def primary_seed_frame(self) -> torch.Tensor | None:
        """Return the seed as a 3-D HxWxC tensor (first subframe for multiframe
        models, or the raw seed for single-frame). Hides the multiframe shape
        from callers that just want one displayable frame."""
        if self.seed_frame is None:
            return None
        return self.seed_frame[0] if self.is_multiframe else self.seed_frame

    def _maybe_expand_to_multiframe(self, frame: torch.Tensor) -> torch.Tensor:
        """Expand a 3-D HxWxC tensor to the model's full temporal_compression
        for multiframe models; pass-through otherwise. The seed-frame storage
        format is whatever the engine consumes — callers stay shape-agnostic."""
        if self.is_multiframe and frame.dim() == 3:
            return frame.unsqueeze(0).expand(self.temporal_compression, -1, -1, -1).contiguous()
        return frame

    def submit_to_device_thread(self, fn):
        """Submit a callable to the dedicated device thread; returns the Future
        so callers can `.result()` (block) or `asyncio.wrap_future(...)` (await).
        Use the more specific helpers (`submit_gen_frame`, `set_seed_and_reset`,
        `append_frame_repeatedly`) where they fit; this is the escape hatch."""
        return self._device_executor.submit(fn)

    def submit_gen_frame(self, ctrl):
        """Submit a `gen_frame` call to the device thread; returns the Future
        so the generator loop can overlap device work with CPU encoding of the
        previous batch."""
        engine = self._require_engine()
        return self._device_executor.submit(lambda c=ctrl: engine.gen_frame(ctrl=c))

    def set_seed_and_reset(self, frame: torch.Tensor, *, set_as_original: bool = False) -> None:
        """Replace the seed and reset the engine to use it. The frame is
        auto-expanded to full temporal_compression for multiframe models, so
        callers can pass a single 3-D HxWxC tensor regardless of model shape.
        Synchronous — runs on the device thread.

        `set_as_original=True` also overwrites `original_seed_frame` so a
        subsequent reset returns to this frame (used by generate_scene, where
        the new frame is the new starting world)."""
        engine = self._require_engine()
        frame = self._maybe_expand_to_multiframe(frame)
        self.seed_frame = frame
        if set_as_original:
            self.original_seed_frame = frame

        def _reset_with_frame():
            engine.reset()
            engine.append_frame(frame)

        self._device_executor.submit(_reset_with_frame).result()

    def append_frame_repeatedly(self, frame: torch.Tensor, count: int) -> None:
        """Append `frame` to the engine `count` times (used to strengthen an
        edit in the KV cache without resetting). Frame is auto-expanded for
        multiframe models. Synchronous — runs on the device thread."""
        engine = self._require_engine()
        frame = self._maybe_expand_to_multiframe(frame)

        def _append():
            for _ in range(count):
                engine.append_frame(frame)

        self._device_executor.submit(_append).result()

    def reset_state(self) -> None:
        """Reset engine state. Synchronous — submits work to the device thread
        and waits. Safe to call from the generator thread (the only caller).
        Asyncio callers wanting to yield should `await asyncio.to_thread(...)`."""
        engine = self._require_engine()
        if self.seed_frame is None:
            raise SeedFrameNotSetError
        seed = self.seed_frame

        t0 = time.perf_counter()
        logger.info("[RESET] Starting engine.reset()...")
        self._device_executor.submit(engine.reset).result()
        logger.info(f"[RESET] engine.reset() took {time.perf_counter() - t0:.2f}s")

        t0 = time.perf_counter()
        logger.info("[RESET] Starting engine.append_frame()...")
        self._device_executor.submit(lambda: engine.append_frame(seed)).result()
        logger.info(f"[RESET] engine.append_frame() took {time.perf_counter() - t0:.2f}s")

    def init_session(self) -> None:
        """Reset engine, load seed, render initial frame and report progress.
        Synchronous — runs on the device thread via submit().result(). Asyncio
        callers should use `await asyncio.to_thread(world_engine.init_session)`."""
        engine = self._require_engine()
        if self.seed_frame is None:
            raise SeedFrameNotSetError
        seed = self.seed_frame

        self._report_progress(StageId.SESSION_INIT_RESET)
        t0 = time.perf_counter()
        logger.info("[INIT] Starting engine.reset()...")
        self._device_executor.submit(engine.reset).result()
        logger.info(f"[INIT] engine.reset() took {time.perf_counter() - t0:.2f}s")

        self._report_progress(StageId.SESSION_INIT_SEED)
        t0 = time.perf_counter()
        logger.info("[INIT] Starting engine.append_frame()...")
        self._device_executor.submit(lambda: engine.append_frame(seed)).result()
        logger.info(f"[INIT] engine.append_frame() took {time.perf_counter() - t0:.2f}s")

        self._report_progress(StageId.SESSION_INIT_FRAME)

    def recover_from_device_error(self) -> bool:
        """Recover from a device error by clearing caches, resetting compiled
        graphs, and re-seeding the engine. Synchronous — called from the
        generator thread when `gen_frame` raises a device-flavoured exception.
        The whole recovery runs on the device thread so the generator thread
        blocks for the duration but doesn't bounce through the asyncio loop."""
        logger.warning("[DEVICE RECOVERY] Attempting to recover from device error...")

        def clear_device():
            if devices.is_available():
                devices.synchronize()
                devices.empty_cache()
            # Clear compiled functions cache (this clears corrupted graphs).
            devices.reset_compiled_graphs()
            logger.info("[DEVICE RECOVERY] Device caches cleared and compiled graphs reset")

        try:
            self._device_executor.submit(clear_device).result()
            self.reset_state()
        except Exception as e:
            logger.error(f"[DEVICE RECOVERY] Failed to recover: {e}", exc_info=True)
            return False
        else:
            logger.info("[DEVICE RECOVERY] Recovery complete - engine ready")
            return True

    async def warmup(self):
        """Perform initial warmup to compile device-side graphs.

        Raises `QuantUnsupportedError` if the active quantization mode is
        unsupported on this device (detected via the torch error's text);
        callers translate that into a typed `MessageId.QUANT_UNSUPPORTED_GPU`.
        Other runtime errors propagate as-is."""
        engine = self._require_engine()
        if self.seed_frame is None:
            raise SeedFrameNotSetError
        seed = self.seed_frame

        def do_warmup():
            warmup_start = time.perf_counter()

            self._report_progress(StageId.SESSION_WARMUP_RESET)
            logger.info("[1/3] Resetting engine state...")
            reset_start = time.perf_counter()
            engine.reset()
            logger.info(f"[1/3] Reset complete in {time.perf_counter() - reset_start:.2f}s")

            self._report_progress(StageId.SESSION_WARMUP_SEED)
            logger.info("[2/3] Appending seed frame...")
            append_start = time.perf_counter()
            engine.append_frame(seed)
            logger.info(f"[2/3] Seed frame appended in {time.perf_counter() - append_start:.2f}s")

            self._report_progress(StageId.SESSION_WARMUP_COMPILE)
            logger.info("[3/3] Generating first frame (compiling device graphs)...")
            gen_start = time.perf_counter()
            _ = engine.gen_frame(ctrl=CtrlInput(button=set(), mouse=(0.0, 0.0)))
            logger.info(f"[3/3] First frame generated in {time.perf_counter() - gen_start:.2f}s")

            return time.perf_counter() - warmup_start

        logger.info("=" * 60)
        logger.info("[WARMUP] First client connected, compiling device graphs...")
        logger.info("=" * 60)

        try:
            warmup_time = await self._run_on_device_thread(do_warmup)
        except RuntimeError as e:
            if devices.is_quant_unsupported_error(e):
                logger.error(f"Quantization mode unsupported on this device: {e}")  # noqa: TRY400  -- not logging the traceback; we re-raise
                raise QuantUnsupportedError() from e
            raise

        logger.info("=" * 60)
        logger.info(f"[WARMUP] Complete in {warmup_time:.2f}s")
        logger.info("=" * 60)

        self.engine_warmed_up = True
