"""
WorldEngine module - Handles AI world generation and frame streaming.

Extracted from monolithic server.py to provide clean separation of concerns.
"""

import asyncio
import base64
import gc
import io
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import torch
import torch.nn.functional as F
from PIL import Image

try:
    import simplejpeg
except ImportError:
    simplejpeg = None

from protocol import StageId

logger = logging.getLogger(__name__)


# ============================================================================
# Configuration
# ============================================================================

DEFAULT_N_FRAMES = 4096
DEVICE = "cuda"
JPEG_QUALITY = 85
DEFAULT_INFERENCE_FPS = 60


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
        raise RuntimeError(
            f"Unsupported model_type '{model_type}'. Only 'waypoint-1' and 'waypoint-1.5' are supported."
        )
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
# Session Management
# ============================================================================


@dataclass
class Session:
    """Tracks state for a single WebSocket connection.

    All frame counts are in perceptual frames (i.e. post-temporal-compression).
    """

    perceptual_frame_count: int = 0
    max_perceptual_frames: int = DEFAULT_N_FRAMES - 2


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
        self.engine = None
        self.model_config: ModelConfig | None = None
        self.seed_frame = None
        self.original_seed_frame = None  # Preserved across scene edits for U-key reset
        self.CtrlInput = None
        self.model_uri: str | None = None
        self.quant: str | None = None
        self.engine_warmed_up = False
        self._progress_callback = None
        self._progress_loop = None
        # Prevent concurrent model loads from overlapping across websocket sessions.
        self._model_load_lock = asyncio.Lock()
        # Single-threaded executor for CUDA operations to maintain thread-local storage
        # This is critical for CUDA graphs which must run in the same thread they were compiled in
        self.cuda_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cuda-thread")

    @property
    def is_loaded(self) -> bool:
        return self.engine is not None and self.model_config is not None

    def _require_config(self) -> ModelConfig:
        if self.model_config is None:
            raise RuntimeError("WorldEngine config accessed before load_engine()")
        return self.model_config

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
        """Report progress from any thread (including CUDA thread)."""
        cb = self._progress_callback
        loop = self._progress_loop
        if cb is None:
            return
        if loop is not None:
            loop.call_soon_threadsafe(cb, stage)
        else:
            cb(stage)

    def _log_cuda_memory(self, stage: str):
        """Log CUDA memory usage for model-switch diagnostics."""
        if not torch.cuda.is_available():
            return
        try:
            allocated = torch.cuda.memory_allocated() / (1024**3)
            reserved = torch.cuda.memory_reserved() / (1024**3)
            logger.info(f"[CUDA] {stage}: allocated={allocated:.2f} GiB reserved={reserved:.2f} GiB")
        except Exception:
            # Memory stats are best-effort diagnostics only.
            pass

    async def _run_on_cuda_thread(self, fn):
        """Run callable on the dedicated CUDA thread."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self.cuda_executor, fn)

    def _free_cuda_memory_sync(self):
        """Best-effort cleanup of CUDA allocations and compiled graph caches."""
        gc.collect()
        if not torch.cuda.is_available():
            return

        try:
            torch.cuda.synchronize()
        except Exception:
            pass

        try:
            # Clear compiled function/graph caches that can retain private pools.
            torch._dynamo.reset()
        except Exception:
            pass

        try:
            torch.cuda.empty_cache()
        except Exception:
            pass

        try:
            torch.cuda.ipc_collect()
        except Exception:
            pass

    def _unload_engine_sync(self):
        """Drop current engine/tensors and aggressively free CUDA memory.
        Resets model_config to None so accidental access on the unloaded
        manager raises rather than returning stale per-model defaults."""
        self.engine = None
        self.model_config = None
        self.seed_frame = None
        self.engine_warmed_up = False
        self._free_cuda_memory_sync()

    def _load_seed_from_file_sync(self, file_path: str) -> torch.Tensor | None:
        """Synchronous helper to load a seed frame from a file path."""
        try:
            img = Image.open(file_path).convert("RGB")
            import numpy as np

            img_tensor = torch.from_numpy(np.array(img)).permute(2, 0, 1).unsqueeze(0).float()
            frame = F.interpolate(
                img_tensor,
                size=self.seed_target_size,
                mode="bilinear",
                align_corners=False,
            )[0]
            frame = frame.to(dtype=torch.uint8, device=DEVICE).permute(1, 2, 0).contiguous()
            if self.is_multiframe:
                frame = frame.unsqueeze(0).expand(self.temporal_compression, -1, -1, -1).contiguous()
            return frame
        except Exception as e:
            logger.error(f"Failed to load seed from file {file_path}: {e}")
            return None

    async def load_seed_from_file(self, file_path: str) -> torch.Tensor | None:
        """Load a seed frame from a file path (async wrapper)."""
        return await self._run_on_cuda_thread(lambda: self._load_seed_from_file_sync(file_path))

    def _load_seed_from_base64_sync(self, base64_data: str) -> torch.Tensor | None:
        """Synchronous helper to load a seed frame from base64 encoded data."""
        try:
            img_data = base64.b64decode(base64_data)
            img = Image.open(io.BytesIO(img_data)).convert("RGB")
            import numpy as np

            img_tensor = torch.from_numpy(np.array(img)).permute(2, 0, 1).unsqueeze(0).float()
            frame = F.interpolate(
                img_tensor,
                size=self.seed_target_size,
                mode="bilinear",
                align_corners=False,
            )[0]
            frame = frame.to(dtype=torch.uint8, device=DEVICE).permute(1, 2, 0).contiguous()
            if self.is_multiframe:
                frame = frame.unsqueeze(0).expand(self.temporal_compression, -1, -1, -1).contiguous()
            return frame
        except Exception as e:
            logger.error(f"Failed to load seed from base64: {e}")
            return None

    async def load_seed_from_base64(self, base64_data: str) -> torch.Tensor | None:
        """Load a seed frame from base64 encoded data (async wrapper)."""
        return await self._run_on_cuda_thread(lambda: self._load_seed_from_base64_sync(base64_data))

    async def load_engine(self, model_uri: str, quant: str | None = None):
        """Initialize or switch the WorldEngine model.

        model_uri is required — the server does not have a default model.
        The client must always specify which model to load.
        """
        if not model_uri or not model_uri.strip():
            raise ValueError("model_uri is required — the client must specify a model")
        async with self._model_load_lock:
            requested_model = model_uri.strip()
            requested_quant = quant or None  # Normalize empty string to None

            model_unchanged = requested_model == self.model_uri
            quant_unchanged = requested_quant == self.quant

            if self.engine is not None and model_unchanged and quant_unchanged:
                logger.info(f"[ENGINE] Model already loaded: {requested_model} (quant={self.quant})")
                return

            if self.engine is not None:
                if not model_unchanged:
                    logger.info(f"[ENGINE] Switching model: {self.model_uri} -> {requested_model}")
                if not quant_unchanged:
                    logger.info(f"[ENGINE] Switching quant: {self.quant} -> {requested_quant}")
                self._log_cuda_memory("before unload")
                await self._run_on_cuda_thread(self._unload_engine_sync)
                self._log_cuda_memory("after unload")

            # Always run a pre-load cleanup pass. This helps release residual allocations
            # from previous failed loads and reduces allocator fragmentation.
            self._log_cuda_memory("before pre-load cleanup")
            await self._run_on_cuda_thread(self._free_cuda_memory_sync)
            self._log_cuda_memory("after pre-load cleanup")

            logger.info("=" * 60)
            logger.info("BIOME ENGINE STARTUP")
            logger.info("=" * 60)
            logger.info("[1/4] Importing WorldEngine...")
            self._report_progress(StageId.SESSION_LOADING_IMPORT)
            import_start = time.perf_counter()
            from world_engine import CtrlInput as CI
            from world_engine import WorldEngine

            self.CtrlInput = CI
            logger.info(f"[1/4] WorldEngine imported in {time.perf_counter() - import_start:.2f}s")

            self._report_progress(StageId.SESSION_LOADING_MODEL)
            logger.info(f"[2/4] Loading model: {requested_model}")
            logger.info(f"      Quantization: {requested_quant}")
            logger.info(f"      Device: {DEVICE}")

            model_start = time.perf_counter()
            dtype_attempts = [torch.bfloat16, torch.float16]
            new_engine = None
            last_error = None
            selected_dtype = None

            for dtype in dtype_attempts:
                try:
                    logger.info(f"[2/4] Attempting load with dtype={dtype}")

                    def _create_engine():
                        return WorldEngine(
                            requested_model,
                            device=DEVICE,
                            quant=requested_quant,
                            dtype=dtype,
                        )

                    new_engine = await self._run_on_cuda_thread(_create_engine)
                    selected_dtype = dtype
                    break
                except torch.OutOfMemoryError as e:
                    last_error = e
                    logger.warning(
                        f"[2/4] OOM while loading {requested_model} with dtype={dtype}; retrying with lower memory settings"
                    )
                    await self._run_on_cuda_thread(self._unload_engine_sync)
                    self._log_cuda_memory("after OOM cleanup")
                except Exception as e:
                    last_error = e
                    # Clear partially-allocated model state after failed initialization.
                    await self._run_on_cuda_thread(self._unload_engine_sync)
                    self._log_cuda_memory("after failed load cleanup")
                    break

            if new_engine is None:
                raise (last_error if last_error is not None else RuntimeError("Failed to initialize WorldEngine"))

            self._report_progress(StageId.SESSION_LOADING_WEIGHTS)
            self.engine = new_engine
            logger.info(f"[2/4] Model loaded in {time.perf_counter() - model_start:.2f}s")
            logger.info(f"[2/4] Loaded with dtype={selected_dtype}")
            self._log_cuda_memory("after load")

            # Resolve typed runtime config from per-model defaults overridden
            # by the engine's model_cfg attributes.
            self.model_config = model_config_from_engine_cfg(self.engine.model_cfg)
            cfg = self.model_config
            logger.info(f"[2/4] Model type: {cfg.label}")
            logger.info(f"[2/4] Context length (n_frames): {cfg.n_frames}")
            logger.info(f"[2/4] Temporal compression: {cfg.temporal_compression}")
            logger.info(f"[2/4] Seed target size: {cfg.seed_target_size}")
            logger.info(f"[2/4] Prompt conditioning: {cfg.has_prompt_conditioning}")

            self._report_progress(StageId.SESSION_LOADING_DONE)
            self.model_uri = requested_model
            self.quant = requested_quant

            # Keep any existing seed frame. Server-side set_model flow explicitly clears
            # seed_frame when a new seed is required after a model switch.
            if self.seed_frame is None:
                logger.info("[3/4] Seed frame: waiting for client to provide initial seed")
            else:
                logger.info("[3/4] Seed frame: preserved existing seed")

            logger.info("[4/4] Engine initialization complete")
            logger.info("=" * 60)
            logger.info("SERVER READY - Waiting for WebSocket connections on /ws")
            logger.info("=" * 60)

    @staticmethod
    def _tensor_to_numpy(frame: torch.Tensor):
        """Transfer a frame tensor to a CPU numpy array (uint8 RGB)."""
        if frame.dtype != torch.uint8:
            frame = frame.clamp(0, 255).to(torch.uint8)
        return frame.cpu().contiguous().numpy()

    @staticmethod
    def _numpy_to_jpeg(rgb, quality: int = JPEG_QUALITY) -> bytes:
        """Encode a CPU numpy RGB array to JPEG bytes."""
        if simplejpeg is not None:
            return simplejpeg.encode_jpeg(rgb, quality=quality, colorspace="RGB")
        img = Image.fromarray(rgb, mode="RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        return buf.getvalue()

    def frame_to_jpeg(self, frame: torch.Tensor, quality: int = JPEG_QUALITY) -> bytes:
        """Convert frame tensor to JPEG bytes using simplejpeg (fast) or PIL (fallback)."""
        return self._numpy_to_jpeg(self._tensor_to_numpy(frame), quality)

    def reset_state(self) -> None:
        """Reset engine state. Synchronous — submits work to the cuda_executor
        and waits. Safe to call from the generator thread (the only caller).
        Asyncio callers wanting to yield should `await asyncio.to_thread(...)`."""
        if self.engine is None:
            raise RuntimeError("WorldEngine is not loaded")
        if self.seed_frame is None:
            raise RuntimeError("Seed frame is not set")

        t0 = time.perf_counter()
        logger.info("[RESET] Starting engine.reset()...")
        self.cuda_executor.submit(self.engine.reset).result()
        logger.info(f"[RESET] engine.reset() took {time.perf_counter() - t0:.2f}s")

        t0 = time.perf_counter()
        logger.info("[RESET] Starting engine.append_frame()...")
        self.cuda_executor.submit(lambda: self.engine.append_frame(self.seed_frame)).result()
        logger.info(f"[RESET] engine.append_frame() took {time.perf_counter() - t0:.2f}s")

    def init_session(self) -> None:
        """Reset engine, load seed, render initial frame and report progress.
        Synchronous — runs on cuda_executor via submit().result(). Asyncio
        callers should use `await asyncio.to_thread(world_engine.init_session)`."""
        if self.engine is None:
            raise RuntimeError("WorldEngine is not loaded")
        if self.seed_frame is None:
            raise RuntimeError("Seed frame is not set")

        self._report_progress(StageId.SESSION_INIT_RESET)
        t0 = time.perf_counter()
        logger.info("[INIT] Starting engine.reset()...")
        self.cuda_executor.submit(self.engine.reset).result()
        logger.info(f"[INIT] engine.reset() took {time.perf_counter() - t0:.2f}s")

        self._report_progress(StageId.SESSION_INIT_SEED)
        t0 = time.perf_counter()
        logger.info("[INIT] Starting engine.append_frame()...")
        self.cuda_executor.submit(lambda: self.engine.append_frame(self.seed_frame)).result()
        logger.info(f"[INIT] engine.append_frame() took {time.perf_counter() - t0:.2f}s")

        self._report_progress(StageId.SESSION_INIT_FRAME)

    def recover_from_cuda_error(self) -> bool:
        """Recover from a CUDA error by clearing caches, resetting dynamo,
        and re-seeding the engine. Synchronous — called from the generator
        thread when `gen_frame` raises a CUDA-flavoured exception. The whole
        recovery runs on the cuda_executor thread so the generator thread
        blocks for the duration but doesn't bounce through the asyncio loop."""
        logger.warning("[CUDA RECOVERY] Attempting to recover from CUDA error...")

        def clear_cuda():
            if torch.cuda.is_available():
                torch.cuda.synchronize()
                torch.cuda.empty_cache()
            # Clear compiled functions cache (this clears corrupted CUDA graphs)
            torch._dynamo.reset()
            logger.info("[CUDA RECOVERY] CUDA caches cleared and dynamo reset")

        try:
            self.cuda_executor.submit(clear_cuda).result()
            self.reset_state()
            logger.info("[CUDA RECOVERY] Recovery complete - engine ready")
            return True
        except Exception as e:
            logger.error(f"[CUDA RECOVERY] Failed to recover: {e}", exc_info=True)
            return False

    async def warmup(self):
        """Perform initial warmup to compile CUDA graphs."""
        if self.engine is None:
            raise RuntimeError("WorldEngine is not loaded")
        if self.seed_frame is None:
            raise RuntimeError("Seed frame is not set")

        def do_warmup():
            warmup_start = time.perf_counter()

            self._report_progress(StageId.SESSION_WARMUP_RESET)
            logger.info("[5/5] Step 1: Resetting engine state...")
            reset_start = time.perf_counter()
            self.engine.reset()
            logger.info(f"[5/5] Step 1: Reset complete in {time.perf_counter() - reset_start:.2f}s")

            self._report_progress(StageId.SESSION_WARMUP_SEED)
            logger.info("[5/5] Step 2: Appending seed frame...")
            append_start = time.perf_counter()
            self.engine.append_frame(self.seed_frame)
            logger.info(f"[5/5] Step 2: Seed frame appended in {time.perf_counter() - append_start:.2f}s")

            self._report_progress(StageId.SESSION_WARMUP_COMPILE)
            logger.info("[5/5] Step 4: Generating first frame (compiling CUDA graphs)...")
            gen_start = time.perf_counter()
            _ = self.engine.gen_frame(ctrl=self.CtrlInput(button=set(), mouse=(0.0, 0.0)))
            logger.info(f"[5/5] Step 4: First frame generated in {time.perf_counter() - gen_start:.2f}s")

            return time.perf_counter() - warmup_start

        logger.info("=" * 60)
        logger.info("[5/5] WARMUP - First client connected, initializing CUDA graphs...")
        logger.info("=" * 60)

        warmup_time = await self._run_on_cuda_thread(do_warmup)

        logger.info("=" * 60)
        logger.info(f"[5/5] WARMUP COMPLETE - Total time: {warmup_time:.2f}s")
        logger.info("=" * 60)

        self.engine_warmed_up = True
