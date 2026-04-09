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

from progress_stages import (
    SESSION_INIT_FRAME,
    SESSION_INIT_RESET,
    SESSION_INIT_SEED,
    SESSION_LOADING_DONE,
    SESSION_LOADING_IMPORT,
    SESSION_LOADING_MODEL,
    SESSION_LOADING_WEIGHTS,
    SESSION_WARMUP_COMPILE,
    SESSION_WARMUP_PROMPT,
    SESSION_WARMUP_RESET,
    SESSION_WARMUP_SEED,
    Stage,
)

logger = logging.getLogger(__name__)


# ============================================================================
# Configuration
# ============================================================================

DEFAULT_MODEL_URI = "Overworld/Waypoint-1.5-1B"
N_FRAMES = 4096
DEVICE = "cuda"
JPEG_QUALITY = 85

# Model-specific runtime configuration.
# n_frames is derived from model_cfg.temporal_compression at load time;
# the value here is only a fallback for models that don't expose it.
MODEL_CFG = {
    "waypoint-1": {
        "label": "waypoint-1 (single-frame)",
        "n_frames": 1,
        "seed_target_size": (360, 640),
        "has_prompt_conditioning": False,
    },
    "waypoint-1.5": {
        "label": "waypoint-1.5 (multi-frame)",
        "n_frames": 4,
        "seed_target_size": (720, 1280),
        "has_prompt_conditioning": False,
    },
}
DEFAULT_INFERENCE_FPS = 60

BUTTON_CODES = {}
# A-Z keys
for i in range(65, 91):
    BUTTON_CODES[chr(i)] = i
# 0-9 keys
for i in range(10):
    BUTTON_CODES[str(i)] = ord(str(i))
# Special keys
BUTTON_CODES["UP"] = 0x26
BUTTON_CODES["DOWN"] = 0x28
BUTTON_CODES["LEFT"] = 0x25
BUTTON_CODES["RIGHT"] = 0x27
BUTTON_CODES["SHIFT"] = 0x10
BUTTON_CODES["CTRL"] = 0x11
BUTTON_CODES["SPACE"] = 0x20
BUTTON_CODES["TAB"] = 0x09
BUTTON_CODES["ENTER"] = 0x0D
BUTTON_CODES["MOUSE_LEFT"] = 0x01
BUTTON_CODES["MOUSE_RIGHT"] = 0x02
BUTTON_CODES["MOUSE_MIDDLE"] = 0x04

# Default prompt - describes the expected visual style
DEFAULT_PROMPT = (
    "First-person shooter gameplay footage from a true POV perspective, "
    "the camera locked to the player's eyes as assault rifles, carbines, "
    "machine guns, laser-sighted firearms, bullet-fed weapons, magazines, "
    "barrels, muzzles, tracers, ammo, and launchers dominate the frame, "
    "with constant gun handling, recoil, muzzle flash, shell ejection, "
    "and ballistic impacts. Continuous real-time FPS motion with no cuts, "
    "weapon-centric framing, realistic gun physics, authentic firearm "
    "materials, high-caliber ammunition, laser optics, iron sights, and "
    "relentless gun-driven action, rendered in ultra-realistic 4K at 60fps."
)


# ============================================================================
# Session Management
# ============================================================================


@dataclass
class Session:
    """Tracks state for a single WebSocket connection."""

    frame_count: int = 0
    max_frames: int = N_FRAMES - 2


# ============================================================================
# WorldEngine Manager
# ============================================================================


class WorldEngineManager:
    """Manages WorldEngine state and operations."""

    def __init__(self):
        self.engine = None
        self.seed_frame = None
        self.original_seed_frame = None  # Preserved across scene edits for U-key reset
        self.CtrlInput = None
        self.model_uri = DEFAULT_MODEL_URI
        self.quant = None
        self.current_prompt = DEFAULT_PROMPT
        self.engine_warmed_up = False
        self.cfg = MODEL_CFG["waypoint-1"].copy()
        self.n_frames = self.cfg["n_frames"]
        self.is_multiframe = self.n_frames > 1
        self.seed_target_size = self.cfg["seed_target_size"]
        self.has_prompt_conditioning = self.cfg["has_prompt_conditioning"]
        self._progress_callback = None
        self._progress_loop = None
        # Prevent concurrent model loads from overlapping across websocket sessions.
        self._model_load_lock = asyncio.Lock()
        # Single-threaded executor for CUDA operations to maintain thread-local storage
        # This is critical for CUDA graphs which must run in the same thread they were compiled in
        self.cuda_executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="cuda-thread"
        )

    def set_progress_callback(self, callback, loop=None):
        """Set a progress callback and event loop for cross-thread reporting."""
        self._progress_callback = callback
        self._progress_loop = loop

    def _report_progress(self, stage: Stage):
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
            logger.info(
                f"[CUDA] {stage}: allocated={allocated:.2f} GiB reserved={reserved:.2f} GiB"
            )
        except Exception:
            # Memory stats are best-effort diagnostics only.
            pass

    def _normalize_model_uri(self, model_uri: str | None) -> str:
        return (
            model_uri or self.model_uri or DEFAULT_MODEL_URI
        ).strip() or DEFAULT_MODEL_URI

    def _resolve_runtime_cfg(self, model_cfg) -> dict:
        """Resolve runtime config from defaults, overridden by model_cfg attributes."""
        model_type = getattr(model_cfg, "model_type", None)
        if model_type not in MODEL_CFG:
            raise RuntimeError(
                f"Unsupported model_type '{model_type}'. Only 'waypoint-1' and 'waypoint-1.5' are supported."
            )

        cfg_key = model_type
        cfg = MODEL_CFG[cfg_key].copy()
        cfg["has_prompt_conditioning"] = (
            getattr(model_cfg, "prompt_conditioning", None) is not None
        )

        # Prefer temporal_compression from the model config over the hardcoded default
        temporal_compression = getattr(model_cfg, "temporal_compression", None)
        if temporal_compression is not None:
            cfg["n_frames"] = int(temporal_compression)

        cfg["inference_fps"] = int(
            getattr(model_cfg, "inference_fps", DEFAULT_INFERENCE_FPS)
        )

        return cfg

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
        """Drop current engine/tensors and aggressively free CUDA memory."""
        self.engine = None
        self.seed_frame = None
        self.engine_warmed_up = False
        self.cfg = MODEL_CFG["waypoint-1"].copy()
        self.n_frames = self.cfg["n_frames"]
        self.is_multiframe = self.n_frames > 1
        self.seed_target_size = self.cfg["seed_target_size"]
        self.has_prompt_conditioning = self.cfg["has_prompt_conditioning"]
        self._free_cuda_memory_sync()

    def _load_seed_from_file_sync(self, file_path: str) -> torch.Tensor:
        """Synchronous helper to load a seed frame from a file path."""
        try:
            img = Image.open(file_path).convert("RGB")
            import numpy as np

            img_tensor = (
                torch.from_numpy(np.array(img)).permute(2, 0, 1).unsqueeze(0).float()
            )
            frame = F.interpolate(
                img_tensor,
                size=self.seed_target_size,
                mode="bilinear",
                align_corners=False,
            )[0]
            frame = (
                frame.to(dtype=torch.uint8, device=DEVICE).permute(1, 2, 0).contiguous()
            )
            if self.is_multiframe:
                frame = (
                    frame.unsqueeze(0).expand(self.n_frames, -1, -1, -1).contiguous()
                )
            return frame
        except Exception as e:
            logger.error(f"Failed to load seed from file {file_path}: {e}")
            return None

    async def load_seed_from_file(self, file_path: str) -> torch.Tensor:
        """Load a seed frame from a file path (async wrapper)."""
        return await self._run_on_cuda_thread(
            lambda: self._load_seed_from_file_sync(file_path)
        )

    def _load_seed_from_base64_sync(self, base64_data: str) -> torch.Tensor:
        """Synchronous helper to load a seed frame from base64 encoded data."""
        try:
            img_data = base64.b64decode(base64_data)
            img = Image.open(io.BytesIO(img_data)).convert("RGB")
            import numpy as np

            img_tensor = (
                torch.from_numpy(np.array(img)).permute(2, 0, 1).unsqueeze(0).float()
            )
            frame = F.interpolate(
                img_tensor,
                size=self.seed_target_size,
                mode="bilinear",
                align_corners=False,
            )[0]
            frame = (
                frame.to(dtype=torch.uint8, device=DEVICE).permute(1, 2, 0).contiguous()
            )
            if self.is_multiframe:
                frame = (
                    frame.unsqueeze(0).expand(self.n_frames, -1, -1, -1).contiguous()
                )
            return frame
        except Exception as e:
            logger.error(f"Failed to load seed from base64: {e}")
            return None

    async def load_seed_from_base64(self, base64_data: str) -> torch.Tensor:
        """Load a seed frame from base64 encoded data (async wrapper)."""
        return await self._run_on_cuda_thread(
            lambda: self._load_seed_from_base64_sync(base64_data)
        )

    async def load_engine(self, model_uri: str | None = None, quant: str | None = None):
        """Initialize or switch the WorldEngine model."""
        async with self._model_load_lock:
            # Re-evaluate after acquiring lock in case another task just loaded this model.
            requested_model = self._normalize_model_uri(model_uri)
            requested_quant = quant or None  # Normalize empty string to None

            model_unchanged = requested_model == self.model_uri
            quant_unchanged = requested_quant == self.quant

            if self.engine is not None and model_unchanged and quant_unchanged:
                logger.info(
                    f"[ENGINE] Model already loaded: {requested_model} (quant={self.quant})"
                )
                return

            if self.engine is not None:
                if not model_unchanged:
                    logger.info(
                        f"[ENGINE] Switching model: {self.model_uri} -> {requested_model}"
                    )
                if not quant_unchanged:
                    logger.info(
                        f"[ENGINE] Switching quant: {self.quant} -> {requested_quant}"
                    )
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
            self._report_progress(SESSION_LOADING_IMPORT)
            import_start = time.perf_counter()
            from world_engine import CtrlInput as CI
            from world_engine import WorldEngine

            self.CtrlInput = CI
            logger.info(
                f"[1/4] WorldEngine imported in {time.perf_counter() - import_start:.2f}s"
            )

            self._report_progress(SESSION_LOADING_MODEL)
            logger.info(f"[2/4] Loading model: {requested_model}")
            logger.info(f"      Quantization: {requested_quant}")
            logger.info(f"      Device: {DEVICE}")
            logger.info(f"      N_FRAMES: {N_FRAMES}")
            logger.info(f"      Prompt: {self.current_prompt[:60]}...")

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
                raise (
                    last_error
                    if last_error is not None
                    else RuntimeError("Failed to initialize WorldEngine")
                )

            self._report_progress(SESSION_LOADING_WEIGHTS)
            self.engine = new_engine
            logger.info(
                f"[2/4] Model loaded in {time.perf_counter() - model_start:.2f}s"
            )
            logger.info(f"[2/4] Loaded with dtype={selected_dtype}")
            self._log_cuda_memory("after load")

            # Resolve runtime config from defaults overridden by model config.
            self.cfg = self._resolve_runtime_cfg(self.engine.model_cfg)
            self.n_frames = self.cfg["n_frames"]
            self.is_multiframe = self.n_frames > 1
            self.seed_target_size = self.cfg["seed_target_size"]
            self.has_prompt_conditioning = self.cfg["has_prompt_conditioning"]
            self.inference_fps = self.cfg.get("inference_fps", DEFAULT_INFERENCE_FPS)
            logger.info(f"[2/4] Model type: {self.cfg['label']}")
            logger.info(f"[2/4] Seed target size: {self.seed_target_size}")
            logger.info(f"[2/4] Prompt conditioning: {self.has_prompt_conditioning}")

            self._report_progress(SESSION_LOADING_DONE)
            self.model_uri = requested_model
            self.quant = requested_quant

            # Keep any existing seed frame. Server-side set_model flow explicitly clears
            # seed_frame when a new seed is required after a model switch.
            if self.seed_frame is None:
                logger.info(
                    "[3/4] Seed frame: waiting for client to provide initial seed"
                )
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

    async def generate_frame(self, ctrl_input) -> torch.Tensor:
        """Generate next frame using WorldEngine."""
        if self.engine is None:
            raise RuntimeError("WorldEngine is not loaded")
        frame = await self._run_on_cuda_thread(
            lambda: self.engine.gen_frame(ctrl=ctrl_input)
        )
        return frame

    async def reset_state(self):
        """Reset engine state."""
        if self.engine is None:
            raise RuntimeError("WorldEngine is not loaded")
        if self.seed_frame is None:
            raise RuntimeError("Seed frame is not set")

        t0 = time.perf_counter()
        logger.info("[RESET] Starting engine.reset()...")
        await self._run_on_cuda_thread(self.engine.reset)
        logger.info(f"[RESET] engine.reset() took {time.perf_counter() - t0:.2f}s")

        t0 = time.perf_counter()
        logger.info("[RESET] Starting engine.append_frame()...")
        await self._run_on_cuda_thread(
            lambda: self.engine.append_frame(self.seed_frame)
        )
        logger.info(
            f"[RESET] engine.append_frame() took {time.perf_counter() - t0:.2f}s"
        )

        t0 = time.perf_counter()
        logger.info("[RESET] Starting engine.set_prompt()...")
        await self._run_on_cuda_thread(
            lambda: self.engine.set_prompt(self.current_prompt)
        )
        logger.info(f"[RESET] engine.set_prompt() took {time.perf_counter() - t0:.2f}s")

    async def init_session(self):
        """Reset engine, load seed, render initial frame and report progress."""
        if self.engine is None:
            raise RuntimeError("WorldEngine is not loaded")
        if self.seed_frame is None:
            raise RuntimeError("Seed frame is not set")

        self._report_progress(SESSION_INIT_RESET)
        t0 = time.perf_counter()
        logger.info("[INIT] Starting engine.reset()...")
        await self._run_on_cuda_thread(self.engine.reset)
        logger.info(f"[INIT] engine.reset() took {time.perf_counter() - t0:.2f}s")

        self._report_progress(SESSION_INIT_SEED)
        t0 = time.perf_counter()
        logger.info("[INIT] Starting engine.append_frame()...")
        await self._run_on_cuda_thread(
            lambda: self.engine.append_frame(self.seed_frame)
        )
        logger.info(
            f"[INIT] engine.append_frame() took {time.perf_counter() - t0:.2f}s"
        )

        self._report_progress(SESSION_INIT_FRAME)
        if self.has_prompt_conditioning:
            t0 = time.perf_counter()
            logger.info("[INIT] Starting engine.set_prompt()...")
            await self._run_on_cuda_thread(
                lambda: self.engine.set_prompt(self.current_prompt)
            )
            logger.info(
                f"[INIT] engine.set_prompt() took {time.perf_counter() - t0:.2f}s"
            )
        else:
            logger.info(
                f"[INIT] No prompt conditioning enabled, skipping engine.set_prompt()"
            )

    async def recover_from_cuda_error(self):
        """
        Recover from CUDA errors by clearing caches and resetting compilation.
        This is needed when CUDA graphs become corrupted.
        """
        logger.warning("[CUDA RECOVERY] Attempting to recover from CUDA error...")

        def clear_cuda():
            # Synchronize to ensure all operations are complete
            if torch.cuda.is_available():
                torch.cuda.synchronize()

            # Clear CUDA caches
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            # Clear compiled functions cache (this clears corrupted CUDA graphs)
            torch._dynamo.reset()

            logger.info("[CUDA RECOVERY] CUDA caches cleared and dynamo reset")

        try:
            await self._run_on_cuda_thread(clear_cuda)

            # Reset engine state after clearing CUDA caches
            await self.reset_state()

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

            self._report_progress(SESSION_WARMUP_RESET)
            logger.info("[5/5] Step 1: Resetting engine state...")
            reset_start = time.perf_counter()
            self.engine.reset()
            logger.info(
                f"[5/5] Step 1: Reset complete in {time.perf_counter() - reset_start:.2f}s"
            )

            self._report_progress(SESSION_WARMUP_SEED)
            logger.info("[5/5] Step 2: Appending seed frame...")
            append_start = time.perf_counter()
            self.engine.append_frame(self.seed_frame)
            logger.info(
                f"[5/5] Step 2: Seed frame appended in {time.perf_counter() - append_start:.2f}s"
            )

            self._report_progress(SESSION_WARMUP_PROMPT)

            if self.has_prompt_conditioning:
                logger.info("[5/5] Step 3: Setting prompt...")
                prompt_start = time.perf_counter()
                self.engine.set_prompt(self.current_prompt)
                logger.info(
                    f"[5/5] Step 3: Prompt set in {time.perf_counter() - prompt_start:.2f}s"
                )
            else:
                logger.info("[5/5] Step 3: Skipping prompt conditioning...")

            self._report_progress(SESSION_WARMUP_COMPILE)
            logger.info(
                "[5/5] Step 4: Generating first frame (compiling CUDA graphs)..."
            )
            gen_start = time.perf_counter()
            _ = self.engine.gen_frame(
                ctrl=self.CtrlInput(button=set(), mouse=(0.0, 0.0))
            )
            logger.info(
                f"[5/5] Step 4: First frame generated in {time.perf_counter() - gen_start:.2f}s"
            )

            return time.perf_counter() - warmup_start

        logger.info("=" * 60)
        logger.info(
            "[5/5] WARMUP - First client connected, initializing CUDA graphs..."
        )
        logger.info("=" * 60)

        warmup_time = await self._run_on_cuda_thread(do_warmup)

        logger.info("=" * 60)
        logger.info(f"[5/5] WARMUP COMPLETE - Total time: {warmup_time:.2f}s")
        logger.info("=" * 60)

        self.engine_warmed_up = True
