"""
WorldEngine module - Handles AI world generation and frame streaming.

Extracted from monolithic server.py to provide clean separation of concerns.
"""

import asyncio
import base64
import io
import logging
import time
import urllib.request
from dataclasses import dataclass

import torch
import torch.nn.functional as F
from PIL import Image

logger = logging.getLogger(__name__)

# ============================================================================
# Configuration
# ============================================================================

MODEL_URI = "Overworld/Waypoint-1-Small"
QUANT = "w8a8"
N_FRAMES = 4096
DEVICE = "cuda"
JPEG_QUALITY = 85

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
        self.CtrlInput = None
        self.current_prompt = DEFAULT_PROMPT
        self.engine_warmed_up = False

    def load_seed_from_base64(
        self, base64_data: str, target_size: tuple[int, int] = (360, 640)
    ) -> torch.Tensor:
        """Load a seed frame from base64 encoded data."""
        try:
            img_data = base64.b64decode(base64_data)
            img = Image.open(io.BytesIO(img_data)).convert("RGB")
            import numpy as np

            img_tensor = (
                torch.from_numpy(np.array(img)).permute(2, 0, 1).unsqueeze(0).float()
            )
            frame = F.interpolate(
                img_tensor, size=target_size, mode="bilinear", align_corners=False
            )[0]
            return (
                frame.to(dtype=torch.uint8, device=DEVICE)
                .permute(1, 2, 0)
                .contiguous()
            )
        except Exception as e:
            logger.error(f"Failed to load seed from base64: {e}")
            return None

    def load_seed_from_url(
        self, url: str, target_size: tuple[int, int] = (360, 640)
    ) -> torch.Tensor:
        """Load a seed frame from URL (used for prompt_with_seed)"""
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                img_data = response.read()
            img = Image.open(io.BytesIO(img_data)).convert("RGB")
            import numpy as np

            img_tensor = (
                torch.from_numpy(np.array(img)).permute(2, 0, 1).unsqueeze(0).float()
            )
            frame = F.interpolate(
                img_tensor, size=target_size, mode="bilinear", align_corners=False
            )[0]
            return (
                frame.to(dtype=torch.uint8, device=DEVICE)
                .permute(1, 2, 0)
                .contiguous()
            )
        except Exception as e:
            logger.error(f"Failed to load seed from URL: {e}")
            return None

    async def load_engine(self):
        """Initialize the WorldEngine with configured model."""
        logger.info("=" * 60)
        logger.info("BIOME ENGINE STARTUP")
        logger.info("=" * 60)

        logger.info("[1/4] Importing WorldEngine...")
        import_start = time.perf_counter()
        from world_engine import CtrlInput as CI
        from world_engine import WorldEngine

        self.CtrlInput = CI
        logger.info(
            f"[1/4] WorldEngine imported in {time.perf_counter() - import_start:.2f}s"
        )

        logger.info(f"[2/4] Loading model: {MODEL_URI}")
        logger.info(f"      Quantization: {QUANT}")
        logger.info(f"      Device: {DEVICE}")
        logger.info(f"      N_FRAMES: {N_FRAMES}")
        logger.info(f"      Prompt: {self.current_prompt[:60]}...")

        # Model config overrides
        # scheduler_sigmas: diffusion denoising schedule (MUST end with 0.0)
        # ae_uri: VAE model for encoding/decoding frames
        model_start = time.perf_counter()
        self.engine = WorldEngine(
            MODEL_URI,
            device=DEVICE,
            model_config_overrides={
                "n_frames": N_FRAMES,
                "ae_uri": "OpenWorldLabs/owl_vae_f16_c16_distill_v0_nogan",
                "scheduler_sigmas": [1.0, 0.8, 0.2, 0.0],
            },
            quant=QUANT,
            dtype=torch.bfloat16,
        )
        logger.info(
            f"[2/4] Model loaded in {time.perf_counter() - model_start:.2f}s"
        )

        # Seed frame will be provided by frontend via set_initial_seed message
        logger.info(
            "[3/4] Seed frame: waiting for client to provide initial seed via base64"
        )
        self.seed_frame = None

        logger.info("[4/4] Engine initialization complete")
        logger.info("=" * 60)
        logger.info("SERVER READY - Waiting for WebSocket connections on /ws")
        logger.info("         (Client must send set_initial_seed with base64 data)")
        logger.info("=" * 60)

    def frame_to_jpeg(self, frame: torch.Tensor, quality: int = JPEG_QUALITY) -> bytes:
        """Convert frame tensor to JPEG bytes."""
        if frame.dtype != torch.uint8:
            frame = frame.clamp(0, 255).to(torch.uint8)
        img = Image.fromarray(frame.cpu().numpy(), mode="RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        return buf.getvalue()

    async def generate_frame(self, ctrl_input) -> torch.Tensor:
        """Generate next frame using WorldEngine."""
        frame = await asyncio.to_thread(self.engine.gen_frame, ctrl=ctrl_input)
        return frame

    async def reset_state(self):
        """Reset engine state."""
        await asyncio.to_thread(self.engine.reset)
        await asyncio.to_thread(self.engine.append_frame, self.seed_frame)
        await asyncio.to_thread(self.engine.set_prompt, self.current_prompt)

    async def warmup(self):
        """Perform initial warmup to compile CUDA graphs."""

        def do_warmup():
            warmup_start = time.perf_counter()

            logger.info("[5/5] Step 1: Resetting engine state...")
            reset_start = time.perf_counter()
            self.engine.reset()
            logger.info(
                f"[5/5] Step 1: Reset complete in {time.perf_counter() - reset_start:.2f}s"
            )

            logger.info("[5/5] Step 2: Appending seed frame...")
            append_start = time.perf_counter()
            self.engine.append_frame(self.seed_frame)
            logger.info(
                f"[5/5] Step 2: Seed frame appended in {time.perf_counter() - append_start:.2f}s"
            )

            logger.info("[5/5] Step 3: Setting prompt...")
            prompt_start = time.perf_counter()
            self.engine.set_prompt(self.current_prompt)
            logger.info(
                f"[5/5] Step 3: Prompt set in {time.perf_counter() - prompt_start:.2f}s"
            )

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

        warmup_time = await asyncio.to_thread(do_warmup)

        logger.info("=" * 60)
        logger.info(f"[5/5] WARMUP COMPLETE - Total time: {warmup_time:.2f}s")
        logger.info("=" * 60)

        self.engine_warmed_up = True
