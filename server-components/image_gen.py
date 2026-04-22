"""
Image generation module - Uses FLUX.2 Klein 4B for reference-based image editing
and text-to-image generation, with Qwen3.5 vision (via llama.cpp) for prompt
construction and content sanitisation.
"""

import asyncio
import base64
import gc
import json
import logging
import time
from dataclasses import asdict, dataclass
from io import BytesIO

import numpy as np
import torch
from PIL import Image

from qwen_tool_parser import parse_tool_calls

logger = logging.getLogger(__name__)

SCENE_EDIT_SAFETY_MESSAGE_ID = "app.server.error.sceneEditSafetyRejected"
GENERATE_SCENE_SAFETY_MESSAGE_ID = "app.server.error.generateSceneSafetyRejected"


@dataclass(frozen=True)
class GeneratedSceneProperties:
    """Metadata embedded into every Scene Authoring generated JPEG — parallel to
    RecordingProperties in video_recorder.py. Callers (server.py) construct this
    explicitly rather than passing a free-form dict, so the schema is fixed and
    searchable. Persisted in the JPEG's COM segment so each image is
    self-describing."""

    biome_version: str = "unknown"
    image_model: str = ""
    user_prompt: str = ""
    sanitized_prompt: str = ""
    generated_at: float = 0.0


def properties_to_jpeg_comment(properties: GeneratedSceneProperties) -> bytes:
    """Encode GeneratedSceneProperties as a compact JSON blob for the JPEG COM
    marker — same shape as video_recorder's `comment` atom, so tooling that
    reads one can trivially read the other."""
    return json.dumps(asdict(properties), separators=(",", ":")).encode("utf-8")


class SafetyRejectionError(RuntimeError):
    """Raised when image generation/editing is rejected by the VLM or output safety checker."""

    message_id: str

    def __init__(self, message_id: str = SCENE_EDIT_SAFETY_MESSAGE_ID):
        self.message_id = message_id
        super().__init__(message_id)

# ── Edit model configuration ────────────────────────────────────────
EDIT_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
EDIT_NUM_STEPS = 4
EDIT_APPEND_COUNT = 32  # How many times to append the edited frame to strengthen it
EDIT_RESET_WITH_FRAME = True  # Reset engine with edited frame as new seed (vs append)

# ── Vision-language model configuration ─────────────────────────────
VLM_GGUF_REPO = "unsloth/Qwen3.5-4B-GGUF"
VLM_GGUF_FILE = "Qwen3.5-4B-UD-Q5_K_XL.gguf"
VLM_MMPROJ_FILE = "mmproj-F16.gguf"
VLM_CTX_SIZE = 4096
VLM_MAX_TOKENS = 1024  # Enough for thinking + tool call, prevents overthinking
VLM_MAX_RETRIES = 3  # Retry tool-call parsing up to this many times
VLM_IMAGE_MAX_SIZE = 384  # Downscale frame to this max dimension before sending to VLM

VLM_TOOL_CALL_SUFFIX = (
    "You MUST call one of these tools:\n\n"
    "To submit an edit instruction:\n"
    "<tool_call>\n"
    "<function=submit_edit_instruction>\n"
    "<parameter=instruction>YOUR INSTRUCTION HERE</parameter>\n"
    "</function>\n"
    "</tool_call>\n\n"
    "To reject an unsafe request:\n"
    "<tool_call>\n"
    "<function=reject_request>\n"
    "</function>\n"
    "</tool_call>"
)

VLM_CONTENT_POLICY = (
    "CONTENT POLICY: You MUST sanitize the user's request before "
    "producing the instruction.\n"
    "   - COPYRIGHTED CHARACTERS/IP: Replace any named copyrighted "
    "characters, brands, or intellectual property with generic "
    "equivalents. E.g. 'Master Chief' → 'armored sci-fi soldier', "
    "'Pikachu' → 'small yellow electric creature', 'Coca-Cola' → "
    "'red soda can'.\n"
    "   - NUDITY/SEXUAL CONTENT: Remove or replace any request for "
    "nudity or sexual content with a clothed/appropriate equivalent. "
    "Violence (weapons, combat, monsters) is acceptable.\n"
    "   - If the ENTIRE request is only about NSFW "
    "content with no salvageable intent, call the reject_request "
    "tool instead of submit_edit_instruction."
)

VLM_SYSTEM_PROMPT = (
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
    "4. STYLE/MOOD changes: Describe the transformation clearly.\n"
    f"5. {VLM_CONTENT_POLICY}\n\n"
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
    "Always end with 'Keep everything else unchanged.'\n\n"
    "IMPORTANT: Be concise. Think briefly (2-3 sentences max), then "
    "immediately submit your instruction. Do not deliberate at length.\n\n"
    + VLM_TOOL_CALL_SUFFIX
)

VLM_GENERATE_SYSTEM_PROMPT = (
    "You write text-to-image prompts for an AI image generator. "
    "The generator will create an image from scratch based on your "
    "description. Write a detailed, vivid description of the COMPLETE "
    "scene to generate.\n\n"
    "The image will be used as a starting frame for a first-person "
    "game world. Follow these rules:\n\n"
    "1. Describe the scene from a FIRST-PERSON perspective.\n"
    "2. Include environment details: setting, lighting, atmosphere, "
    "key objects, and mood.\n"
    "3. ALWAYS include a handheld item held in a right hand at the "
    "bottom-right of the frame, as in a first-person game. A gun or "
    "weapon is preferred, but tools, sticks, or other items fitting "
    "the scene are also fine. Pick something that matches the setting.\n"
    f"4. {VLM_CONTENT_POLICY}\n\n"
    "EXAMPLES:\n"
    '- User: "underwater city" → "A vibrant underwater city seen from '
    "a first-person perspective. Bioluminescent coral buildings rise "
    "from the ocean floor, schools of colorful fish swim between "
    "towering structures. Shafts of sunlight pierce through the deep "
    'blue water. The scene is rich with marine life and ancient ruins."\n'
    '- User: "space station" → "Interior of a futuristic space station '
    "corridor seen from first-person perspective. Metallic walls with "
    "glowing blue panels, a large viewport showing stars and a distant "
    "planet. Emergency lights cast a warm amber glow. The corridor "
    'stretches ahead with sealed bulkhead doors."\n\n'
    "IMPORTANT: Be concise. Think briefly (2-3 sentences max), then "
    "immediately submit your instruction. Do not deliberate at length.\n\n"
    + VLM_TOOL_CALL_SUFFIX
)


def _pil_to_data_uri(image: Image.Image) -> str:
    """Convert a PIL Image to a base64 data URI for llama-cpp-python."""
    buf = BytesIO()
    image.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


class ImageGenManager:
    """Manages FLUX.2 Klein (editing) + Qwen3.5 (vision-language) for scene editing."""

    def __init__(self, cuda_executor):
        self.cuda_executor = cuda_executor
        self.pipeline = None
        self.vlm = None  # llama_cpp.Llama instance
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
        logger.info(f"[SCENE_EDIT] Loading VLM {VLM_GGUF_REPO}/{VLM_GGUF_FILE}...")
        t0 = time.perf_counter()
        await self._run_on_cuda_thread(self._load_vlm_sync)
        logger.info(f"[SCENE_EDIT] VLM loaded in {time.perf_counter() - t0:.1f}s")

        logger.info(f"[SCENE_EDIT] Loading editing model {EDIT_MODEL_ID}...")
        t1 = time.perf_counter()
        await self._run_on_cuda_thread(self._load_edit_sync)
        logger.info(f"[SCENE_EDIT] Editing model loaded in {time.perf_counter() - t1:.1f}s")

        self._loaded = True

    def _load_vlm_sync(self):
        """Load the Qwen3.5 vision-language model via llama.cpp (GGUF)."""
        from huggingface_hub import hf_hub_download
        from llama_cpp import Llama
        from llama_cpp.llama_chat_format import Qwen35ChatHandler

        model_path = hf_hub_download(repo_id=VLM_GGUF_REPO, filename=VLM_GGUF_FILE)
        mmproj_path = hf_hub_download(repo_id=VLM_GGUF_REPO, filename=VLM_MMPROJ_FILE)

        chat_handler = Qwen35ChatHandler(
            clip_model_path=mmproj_path,
            enable_thinking=True,
            add_vision_id=False,
            verbose=False,
        )
        self.vlm = Llama(
            model_path=model_path,
            chat_handler=chat_handler,
            n_ctx=VLM_CTX_SIZE,
            n_gpu_layers=-1,
            verbose=False,
        )

    def _load_edit_sync(self):
        """Load the FLUX.2 Klein editing pipeline (quantized transformer + text encoder)."""
        from diffusers import Flux2KleinPipeline, Flux2Transformer2DModel, GGUFQuantizationConfig
        from transformers import AutoModelForCausalLM, BitsAndBytesConfig

        # Transformer: Q8 GGUF (~4.3GB)
        gguf_config = GGUFQuantizationConfig(compute_dtype=torch.bfloat16)
        transformer = Flux2Transformer2DModel.from_single_file(
            "https://huggingface.co/unsloth/FLUX.2-klein-4B-GGUF/blob/main/flux-2-klein-4b-Q8_0.gguf",
            config=EDIT_MODEL_ID,
            subfolder="transformer",
            quantization_config=gguf_config,
            torch_dtype=torch.bfloat16,
        )

        # Text encoder: 4-bit quantized (~2GB instead of ~8GB)
        bnb_config = BitsAndBytesConfig(load_in_4bit=True)
        text_encoder = AutoModelForCausalLM.from_pretrained(
            EDIT_MODEL_ID,
            subfolder="text_encoder",
            quantization_config=bnb_config,
            torch_dtype=torch.bfloat16,
        )

        pipe = Flux2KleinPipeline.from_pretrained(
            EDIT_MODEL_ID,
            transformer=transformer,
            text_encoder=text_encoder,
            torch_dtype=torch.bfloat16,
        ).to("cuda")
        pipe.set_progress_bar_config(disable=True)
        self.pipeline = pipe

    @staticmethod
    def _parse_edit_instruction(text: str, safety_message_id: str = SCENE_EDIT_SAFETY_MESSAGE_ID) -> str:
        """Extract the 'instruction' from a submit_edit_instruction tool call.

        Raises SafetyRejectionError if a reject_request tool call is found.
        Raises ValueError if no valid tool call is found or the instruction is missing.
        """
        tool_calls = parse_tool_calls(text)
        for call in tool_calls:
            if call.name == "reject_request":
                raise SafetyRejectionError(safety_message_id)
            if call.name == "submit_edit_instruction":
                instruction = call.arguments.get("instruction", "")
                if instruction:
                    return instruction
        raise ValueError(
            f"No submit_edit_instruction tool call with an instruction found in: {text!r}"
        )

    def _run_vlm(
        self,
        messages: list[dict],
        log_prefix: str,
        safety_message_id: str = SCENE_EDIT_SAFETY_MESSAGE_ID,
    ) -> str:
        """Run the VLM with retries, parse a tool call, return the instruction.

        Raises SafetyRejectionError if the VLM calls reject_request.
        Raises RuntimeError after VLM_MAX_RETRIES failed attempts.
        """
        last_error = None
        for attempt in range(1, VLM_MAX_RETRIES + 1):
            t0 = time.perf_counter()
            result = self.vlm.create_chat_completion(
                messages=messages,
                max_tokens=VLM_MAX_TOKENS,
                temperature=1.0,
                top_p=0.95,
                top_k=20,
                min_p=0.0,
                present_penalty=1.5,
                repeat_penalty=1.0,
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000

            raw_output = result["choices"][0]["message"]["content"] or ""
            logger.info(
                f"[{log_prefix}] VLM raw (attempt {attempt}, {elapsed_ms:.0f}ms): {raw_output}"
            )

            # Strip thinking block — the model wraps reasoning in
            # <think>...</think> which confuses the tool call parser.
            if "</think>" in raw_output:
                raw_output = raw_output.split("</think>", 1)[1]

            try:
                prompt = self._parse_edit_instruction(raw_output, safety_message_id)
                logger.info(f"[{log_prefix}] Prompt: {prompt}")
                return prompt
            except ValueError as exc:
                last_error = exc
                logger.warning(
                    f"[{log_prefix}] Tool call parse failed (attempt {attempt}/{VLM_MAX_RETRIES}): {exc}"
                )

        raise RuntimeError(
            f"VLM failed to produce a valid tool call after {VLM_MAX_RETRIES} attempts: {last_error}"
        )

    def _build_edit_prompt(self, frame_pil: Image.Image, user_request: str) -> str:
        """Ask the VLM to write a Klein edit instruction from the user's request.

        Uses tool calling for structured output, with retries on parse failure.
        Raises RuntimeError after VLM_MAX_RETRIES failed attempts.
        """
        # Downscale frame to reduce vision token count and speed up inference
        vlm_frame = frame_pil.copy()
        vlm_frame.thumbnail((VLM_IMAGE_MAX_SIZE, VLM_IMAGE_MAX_SIZE), Image.LANCZOS)
        image_uri = _pil_to_data_uri(vlm_frame)
        messages = [
            {"role": "system", "content": VLM_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_uri}},
                    {
                        "type": "text",
                        "text": (
                            f'The user wants: "{user_request}"\n\n'
                            "Look at the image and write a specific edit instruction. "
                            "Submit it using the submit_edit_instruction tool."
                        ),
                    },
                ],
            },
        ]
        return self._run_vlm(messages, "SCENE_EDIT", SCENE_EDIT_SAFETY_MESSAGE_ID)

    def _build_generation_prompt(self, user_request: str) -> str:
        """Ask the VLM to write a text-to-image prompt from the user's request.

        Text-only (no image input). Sanitises content and produces a detailed
        scene description suitable for image generation.
        """
        messages = [
            {"role": "system", "content": VLM_GENERATE_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f'The user wants to play: "{user_request}"\n\n'
                    "Write a detailed text-to-image prompt describing this scene "
                    "from a first-person perspective. "
                    "Submit it using the submit_edit_instruction tool."
                ),
            },
        ]
        return self._run_vlm(messages, "GENERATE_SCENE", GENERATE_SCENE_SAFETY_MESSAGE_ID)

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

    def _generate_scene_sync(
        self,
        prompt: str,
        seed_target_size: tuple[int, int],
    ) -> tuple[torch.Tensor, str]:
        """Generate a new scene from a text prompt using a blank canvas as the
        reference image.  The VLM sanitises / refines the prompt (text-only,
        no image input), then Klein produces the image.

        Returns:
            (generated frame as uint8 CUDA tensor HxWx3, sanitised prompt string).
        """
        h, w = seed_target_size

        # Align to 16px boundaries for the transformer
        target_w = w // 16 * 16
        target_h = h // 16 * 16
        blank = Image.new("RGB", (target_w, target_h), (255, 255, 255))

        # VLM sanitises and refines the user prompt (text-only, no image)
        generation_prompt = self._build_generation_prompt(prompt)

        # Run Klein with the blank canvas and refined prompt
        t0 = time.perf_counter()
        result = self.pipeline(
            image=blank,
            prompt=generation_prompt,
            num_inference_steps=EDIT_NUM_STEPS,
            height=target_h,
            width=target_w,
        ).images[0]
        logger.info(
            f"[GENERATE_SCENE] Generation took {(time.perf_counter() - t0) * 1000:.0f}ms"
        )

        # Resize to seed target size and convert to tensor
        result = result.resize((w, h), Image.LANCZOS)
        result_tensor = (
            torch.from_numpy(np.array(result))
            .to(dtype=torch.uint8, device="cuda")
            .contiguous()
        )
        return result_tensor, generation_prompt

    def unload(self):
        """Free GPU memory used by both models."""
        if self.vlm is not None:
            self.vlm.close()
        self.pipeline = None
        self.vlm = None
        self._loaded = False
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
