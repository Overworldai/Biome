"""
Scene editing module - Uses FLUX.2 Klein 4B for reference-based image editing,
with Qwen3.5 vision to construct an edit-aware prompt grounded in the frame.
"""

import asyncio
import gc
import logging
import time

import numpy as np
import torch
from PIL import Image

logger = logging.getLogger(__name__)

# ── Edit model configuration ────────────────────────────────────────
EDIT_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
EDIT_NUM_STEPS = 4
EDIT_APPEND_COUNT = 32  # How many times to append the edited frame to strengthen it
EDIT_RESET_WITH_FRAME = True  # Reset engine with edited frame as new seed (vs append)

# ── Vision-language model configuration ─────────────────────────────
VLM_MODEL_ID = "Qwen/Qwen3.5-4B"
VLM_MAX_PIXELS = 512 * 28 * 28  # Cap vision tokens for speed/VRAM


class InpaintingManager:
    """Manages FLUX.2 Klein (editing) + Qwen3.5 (vision-language) for scene editing."""

    def __init__(self, cuda_executor):
        self.cuda_executor = cuda_executor
        self.pipeline = None
        self.vlm_model = None
        self.vlm_processor = None
        self._loaded = False

    @property
    def is_loaded(self):
        return self._loaded

    async def _run_on_cuda_thread(self, fn):
        """Run callable on the dedicated CUDA thread."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self.cuda_executor, fn)

    async def warmup(self):
        """Load both the VLM and editing model to GPU."""
        logger.info(f"[SCENE_EDIT] Loading VLM {VLM_MODEL_ID}...")
        t0 = time.perf_counter()
        await self._run_on_cuda_thread(self._load_vlm_sync)
        logger.info(f"[SCENE_EDIT] VLM loaded in {time.perf_counter() - t0:.1f}s")

        logger.info(f"[SCENE_EDIT] Loading editing model {EDIT_MODEL_ID}...")
        t1 = time.perf_counter()
        await self._run_on_cuda_thread(self._load_edit_sync)
        logger.info(f"[SCENE_EDIT] Editing model loaded in {time.perf_counter() - t1:.1f}s")

        self._loaded = True

    def _load_vlm_sync(self):
        """Load the Qwen3.5 vision-language model (int4 quantized)."""
        from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig

        bnb_config = BitsAndBytesConfig(load_in_4bit=True)
        self.vlm_model = AutoModelForImageTextToText.from_pretrained(
            VLM_MODEL_ID,
            torch_dtype=torch.float16,
            quantization_config=bnb_config,
            device_map="auto",
        )
        self.vlm_processor = AutoProcessor.from_pretrained(
            VLM_MODEL_ID,
            max_pixels=VLM_MAX_PIXELS,
        )

    def _load_edit_sync(self):
        """Load the FLUX.2 Klein editing pipeline (Q8 GGUF quantized)."""
        from diffusers import Flux2KleinPipeline, Flux2Transformer2DModel, GGUFQuantizationConfig

        gguf_config = GGUFQuantizationConfig(compute_dtype=torch.bfloat16)
        transformer = Flux2Transformer2DModel.from_single_file(
            "https://huggingface.co/unsloth/FLUX.2-klein-4B-GGUF/blob/main/flux-2-klein-4b-Q8_0.gguf",
            config=EDIT_MODEL_ID,
            subfolder="transformer",
            quantization_config=gguf_config,
            torch_dtype=torch.bfloat16,
        )
        pipe = Flux2KleinPipeline.from_pretrained(
            EDIT_MODEL_ID,
            transformer=transformer,
            torch_dtype=torch.bfloat16,
        ).to("cuda")
        pipe.set_progress_bar_config(disable=True)
        self.pipeline = pipe

    def _build_edit_prompt(self, frame_pil: Image.Image, user_request: str) -> str:
        """Ask the VLM to write a Klein edit instruction from the user's request."""
        from qwen_vl_utils import process_vision_info

        messages = [
            {
                "role": "system",
                "content": (
                    "You write image editing instructions for an AI image editor. "
                    "The editor receives a reference image and your instruction, then "
                    "produces an edited version. Instructions should describe WHAT TO "
                    "CHANGE, not the full scene — the reference image provides the "
                    "visual context.\n\n"
                    "This is a first-person game screenshot. Follow these rules:\n\n"
                    "1. DEFAULT: ADD elements to the scene unless told to replace/remove.\n"
                    "2. HANDHELD OBJECTS (weapons, tools, items): Place in a right hand "
                    "at the bottom-right of the frame, as in a first-person shooter. "
                    "If a hand is already visible, put the object in it. If not, add "
                    "a hand holding the object in the bottom-right corner.\n"
                    "3. SCENE ELEMENTS (buildings, creatures, weather): Place naturally "
                    "in the environment.\n"
                    "4. STYLE/MOOD changes: Describe the transformation clearly.\n\n"
                    "EXAMPLES:\n"
                    '- User: "sword" → "Add a glowing sword held in a right hand in '
                    'the bottom-right corner of the frame, as in a first-person game. '
                    'Keep everything else unchanged."\n'
                    '- User: "dragon" → "Add a large dragon flying in the sky above '
                    'the scene. Keep everything else unchanged."\n'
                    '- User: "make it night" → "Change the lighting to nighttime with '
                    'a dark sky, moonlight, and shadows. Keep everything else unchanged."\n'
                    '- User: "remove the tree" → "Remove the tree from the scene and '
                    'fill the area with the surrounding environment. Keep everything '
                    'else unchanged."\n'
                    '- User: "shotgun" → "Add a pump-action shotgun held in a right '
                    'hand in the bottom-right corner of the frame, as in a first-person '
                    'shooter. Keep everything else unchanged."\n\n'
                    "Always end with 'Keep everything else unchanged.'\n"
                    "Reply with ONLY a single one-line instruction. No preamble, "
                    "no explanation, no line breaks."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": frame_pil},
                    {
                        "type": "text",
                        "text": (
                            f"The user wants: \"{user_request}\"\n\n"
                            "Look at the image and write a specific edit instruction."
                        ),
                    },
                ],
            },
        ]

        text = self.vlm_processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
            enable_thinking=False,
        )
        image_inputs, video_inputs = process_vision_info(messages)
        inputs = self.vlm_processor(
            text=[text],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        ).to(self.vlm_model.device)

        with torch.no_grad():
            output_ids = self.vlm_model.generate(
                **inputs,
                max_new_tokens=256,
            )

        generated_ids = output_ids[0, inputs.input_ids.shape[1] :].tolist()

        # Find </think> token (ID 151668) and take only what follows.
        # With enable_thinking=False this shouldn't be needed, but as a
        # safety net in case reasoning leaks through.
        THINK_END_TOKEN = 151668
        try:
            index = len(generated_ids) - generated_ids[::-1].index(THINK_END_TOKEN)
        except ValueError:
            index = 0

        edit_prompt = self.vlm_processor.tokenizer.decode(
            generated_ids[index:], skip_special_tokens=True
        ).strip()

        raw_full = self.vlm_processor.tokenizer.decode(
            generated_ids, skip_special_tokens=True
        ).strip()
        logger.info(f"[SCENE_EDIT] VLM raw: {raw_full}")
        logger.info(f"[SCENE_EDIT] Edit prompt: {edit_prompt}")
        return edit_prompt

    async def inpaint(
        self,
        frame_numpy: np.ndarray,
        prompt: str,
        seed_target_size: tuple[int, int],
    ) -> torch.Tensor:
        """Edit a frame: VLM writes the edit prompt, Klein generates.

        Args:
            frame_numpy: HxWx3 uint8 numpy array (the last generated frame).
            prompt: User's vague description of the desired change.
            seed_target_size: (height, width) tuple for the output tensor.

        Returns:
            Edited frame as a uint8 CUDA tensor (HxWx3).
        """
        if not self._loaded:
            raise RuntimeError("Editing models not loaded")
        return await self._run_on_cuda_thread(
            lambda: self._inpaint_sync(frame_numpy, prompt, seed_target_size)
        )

    def _inpaint_sync(
        self,
        frame_numpy: np.ndarray,
        prompt: str,
        seed_target_size: tuple[int, int],
    ) -> tuple[torch.Tensor, str]:
        h_orig, w_orig = frame_numpy.shape[:2]
        frame_pil = Image.fromarray(frame_numpy)

        # Step 1: VLM sees the frame + user request, writes the full edit prompt
        edit_prompt = self._build_edit_prompt(frame_pil, prompt)

        # Step 2: Align to 16px boundaries for the transformer
        target_w = w_orig // 16 * 16
        target_h = h_orig // 16 * 16
        frame_resized = frame_pil.resize((target_w, target_h))

        # Step 3: Run Klein with the VLM-authored prompt
        t0 = time.perf_counter()
        result = self.pipeline(
            image=frame_resized,
            prompt=edit_prompt,
            num_inference_steps=EDIT_NUM_STEPS,
            height=target_h,
            width=target_w,
        ).images[0]
        logger.info(
            f"[SCENE_EDIT] Generation took {(time.perf_counter() - t0) * 1000:.0f}ms"
        )

        # Step 4: Resize to seed target size and convert to tensor
        h, w = seed_target_size
        result = result.resize((w, h), Image.LANCZOS)
        result_tensor = (
            torch.from_numpy(np.array(result))
            .to(dtype=torch.uint8, device="cuda")
            .contiguous()
        )
        return result_tensor, edit_prompt

    def unload(self):
        """Free GPU memory used by both models."""
        self.pipeline = None
        self.vlm_model = None
        self.vlm_processor = None
        self._loaded = False
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
