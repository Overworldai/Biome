"""
Scene authoring: text-to-image generation + reference-based editing.

`SceneAuthoringManager` owns the FLUX.2 Klein image pipeline and the Gemma 4
vision-language model used to write Klein prompts from the user's request.
Two flows ride on top:

  - `run_scene_edit`     → inpaints over the last rendered frame
  - `run_generate_scene` → generates a fresh scene from text on a blank canvas

Both go through the same modular building blocks: a VLM call to write the
Klein prompt, a Klein run, a resize-and-tensorise, and (for the orchestration
free-functions) a safety check + a swap into the world engine. Nothing here
reaches into `WorldEngineManager.engine` or `._device_executor` — those are
private; we go through the public API on the manager (`set_seed_and_reset`,
`append_frame_repeatedly`, `submit_to_device_thread`, `tensor_to_numpy`,
`numpy_to_jpeg`). Device placement goes through `engine.devices.SCENE_AUTHORING_DEVICE`.
"""

# pyright: reportAttributeAccessIssue=none, reportMissingTypeArgument=none, reportOptionalCall=none, reportOptionalMemberAccess=none, reportPrivateImportUsage=none, reportPrivateUsage=none, reportUnknownArgumentType=none, reportUnknownMemberType=none, reportUnknownParameterType=none, reportUnknownVariableType=none

import asyncio
import base64
import gc
import io
import json
import logging
import re
import time
from dataclasses import asdict, dataclass, field
from io import BytesIO
from typing import TYPE_CHECKING, Any

import numpy as np
import torch
from PIL import Image

from engine import devices
from engine.devices import SCENE_AUTHORING_DEVICE
from server.protocol import GenerateSceneResponseData, SceneEditResponseData

if TYPE_CHECKING:
    from engine import Engines
    from engine.manager import WorldEngineManager

logger = logging.getLogger(__name__)


SCENE_EDIT_SAFETY_MESSAGE_ID = "app.server.error.sceneEditSafetyRejected"
GENERATE_SCENE_SAFETY_MESSAGE_ID = "app.server.error.generateSceneSafetyRejected"


# ─── Errors ──────────────────────────────────────────────────────────


class SafetyRejectionError(RuntimeError):
    """Raised when image generation/editing is rejected by the VLM (via the
    `reject_request` tool call) or by the post-classifier safety check on the
    generated image."""

    message_id: str

    def __init__(self, message_id: str = SCENE_EDIT_SAFETY_MESSAGE_ID):
        self.message_id = message_id
        super().__init__(message_id)


class NoToolCallsError(ValueError):
    """Raised when `parse_tool_calls` finds no tool-call blocks in the VLM
    output. Carries the raw text so callers/log lines can show what was
    parsed."""

    def __init__(self, text: str) -> None:
        self.text = text
        super().__init__(f"No valid tool calls found in output: {text!r}")


class MissingEditInstructionError(ValueError):
    """Raised when VLM output contains tool calls but none of them are a
    `submit_edit_instruction` with a non-empty `instruction` argument."""

    def __init__(self, text: str) -> None:
        self.text = text
        super().__init__(f"No submit_edit_instruction tool call with an instruction found in: {text!r}")


class VlmToolCallRetryError(RuntimeError):
    """Raised when the VLM fails to produce a valid tool call within
    `VLM_MAX_RETRIES` attempts. Carries the last underlying parse error so
    diagnostics keep the chain intact."""

    def __init__(self, attempts: int, last_error: BaseException | None) -> None:
        self.attempts = attempts
        self.last_error = last_error
        super().__init__(f"VLM failed to produce a valid tool call after {attempts} attempts: {last_error}")


# ─── JPEG metadata for generated scenes ──────────────────────────────


@dataclass(frozen=True)
class GeneratedSceneProperties:
    """Metadata embedded into every Scene Authoring generated JPEG — parallel
    to RecordingProperties in `recording/video_recorder.py`. The schema is
    fixed and searchable; persisted in the JPEG's COM segment so each image
    is self-describing."""

    biome_version: str = "unknown"
    image_model: str = ""
    user_prompt: str = ""
    sanitized_prompt: str = ""
    generated_at: float = 0.0


def properties_to_jpeg_comment(properties: GeneratedSceneProperties) -> bytes:
    """Encode GeneratedSceneProperties as a compact JSON blob for the JPEG COM
    marker — same shape as `video_recorder`'s `comment` atom, so tooling that
    reads one can trivially read the other."""
    return json.dumps(asdict(properties), separators=(",", ":")).encode("utf-8")


# ─── Gemma 4 tool-call parser ────────────────────────────────────────
# Gemma 4 emits tool calls as:
#   <|tool_call>call:function_name{arg_name:<|"|>value<|"|>, ...}<tool_call|>
# Empty-arg calls render as `<|tool_call>call:function_name{}<tool_call|>`.
# String values are wrapped in the `<|"|>` special token. Reasoning produced
# by the model lands in a separate `<|channel>thought...<channel|>` block
# before the tool call and is ignored by this parser.


@dataclass
class ToolCall:
    """A parsed tool call with function name and string parameters."""

    name: str
    arguments: dict[str, str] = field(default_factory=dict)


_TOOL_CALL_RE = re.compile(r"<\|tool_call>call:(\w+)\{(.*?)\}<tool_call\|>", re.DOTALL)
_ARG_RE = re.compile(r'(\w+)\s*:\s*<\|"\|>(.*?)<\|"\|>', re.DOTALL)


def parse_tool_calls(text: str) -> list[ToolCall]:
    """Parse all tool calls from VLM output. Raises ValueError if none found."""
    results: list[ToolCall] = []
    for m in _TOOL_CALL_RE.finditer(text):
        name = m.group(1)
        args = {am.group(1): am.group(2) for am in _ARG_RE.finditer(m.group(2))}
        results.append(ToolCall(name=name, arguments=args))

    if not results:
        raise NoToolCallsError(text)

    return results


# ─── Klein editor configuration ──────────────────────────────────────

EDIT_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
EDIT_NUM_STEPS = 4
EDIT_APPEND_COUNT = 32  # Times to append the edited frame to strengthen it
EDIT_RESET_WITH_FRAME = True  # Reset engine with edited frame as new seed (vs append)

# ─── VLM configuration ────────────────────────────────────────────────

VLM_GGUF_REPO = "unsloth/gemma-4-E4B-it-GGUF"
VLM_GGUF_FILE = "gemma-4-E4B-it-UD-Q4_K_XL.gguf"
VLM_MMPROJ_FILE = "mmproj-F16.gguf"
VLM_CTX_SIZE = 4096
VLM_MAX_TOKENS = 1024  # Enough for thinking + tool call, prevents overthinking
VLM_MAX_RETRIES = 3  # Retry tool-call parsing up to this many times
VLM_IMAGE_MAX_SIZE = 384  # Downscale frame to this max dimension before sending to VLM

# Tool schemas passed via `tools=` to create_chat_completion. The Gemma 4
# chat template renders these into a system block that documents the wire
# format the model is trained on — putting tool definitions here (rather
# than as literal <tool_call> text in the system prompt) avoids special-
# token tokenisation pitfalls in user content.
VLM_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "submit_edit_instruction",
            "description": "Submit the final edit/generation instruction for the image model.",
            "parameters": {
                "type": "object",
                "properties": {
                    "instruction": {
                        "type": "string",
                        "description": "The instruction to send to the image model.",
                    },
                },
                "required": ["instruction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reject_request",
            "description": "Reject a request that is entirely unsafe with no salvageable intent.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

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
    "the bottom-right corner of the frame, as in a first-person game. "
    'Keep everything else unchanged."\n'
    '- User: "dragon" → "Add a large dragon flying in the sky above '
    'the scene. Keep everything else unchanged."\n'
    '- User: "make it night" → "Change the lighting to nighttime with '
    'a dark sky, moonlight, and shadows. Keep everything else unchanged."\n'
    '- User: "remove the tree" → "Remove the tree from the scene and '
    "fill the area with the surrounding environment. Keep everything "
    'else unchanged."\n'
    '- User: "shotgun" → "Add a pump-action shotgun held in a right '
    "hand in the bottom-right corner of the frame, as in a first-person "
    'shooter. Keep everything else unchanged."\n\n'
    "Always end with 'Keep everything else unchanged.'\n\n"
    "IMPORTANT: Be concise. Think briefly (2-3 sentences max), then "
    "immediately submit your instruction via the submit_edit_instruction "
    "tool. Do not deliberate at length. If the request is entirely unsafe "
    "with no salvageable intent, call reject_request instead."
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
    "immediately submit your prompt via the submit_edit_instruction tool. "
    "Do not deliberate at length. If the request is entirely unsafe with "
    "no salvageable intent, call reject_request instead."
)


def _pil_to_data_uri(image: Image.Image) -> str:
    """Convert a PIL Image to a base64 data URI for llama-cpp-python."""
    buf = BytesIO()
    image.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


# ─── Lazy-imported model libraries ───────────────────────────────────


@dataclass(frozen=True)
class _SceneAuthoringLibs:
    """The classes / functions pulled in lazily for scene-authoring model
    loading. `Any` types are deliberate — properly typing these would
    require importing the libs at the top of this module, which defeats
    the lazy-load purpose."""

    hf_hub_download: Any
    Llama: Any
    Gemma4ChatHandler: Any
    Flux2KleinPipeline: Any
    Flux2Transformer2DModel: Any
    GGUFQuantizationConfig: Any
    AutoModelForCausalLM: Any
    BitsAndBytesConfig: Any


def _import_scene_authoring_libs() -> _SceneAuthoringLibs:
    """Single home for the heavy imports needed by scene-authoring model
    loading. Pulls diffusers / transformers / llama_cpp into the module
    graph; called only when warmup runs (i.e. when a session has scene
    authoring enabled), so disabled-by-default sessions never pay the
    import cost."""
    from diffusers import Flux2KleinPipeline, Flux2Transformer2DModel, GGUFQuantizationConfig
    from huggingface_hub import hf_hub_download
    from llama_cpp import Llama
    from llama_cpp.llama_chat_format import Gemma4ChatHandler
    from transformers import AutoModelForCausalLM, BitsAndBytesConfig

    return _SceneAuthoringLibs(
        hf_hub_download=hf_hub_download,
        Llama=Llama,
        Gemma4ChatHandler=Gemma4ChatHandler,
        Flux2KleinPipeline=Flux2KleinPipeline,
        Flux2Transformer2DModel=Flux2Transformer2DModel,
        GGUFQuantizationConfig=GGUFQuantizationConfig,
        AutoModelForCausalLM=AutoModelForCausalLM,
        BitsAndBytesConfig=BitsAndBytesConfig,
    )


# ─── SceneAuthoringManager ───────────────────────────────────────────


class SceneAuthoringManager:
    """FLUX.2 Klein (image editor) + Gemma 4 E4B (VLM that writes Klein prompts).

    Goes through `WorldEngineManager.submit_to_device_thread` for model
    loading so all device setup serialises behind in-flight world-engine
    work — no direct device-executor access. The flows themselves
    (`_inpaint`, `_generate`) run on whatever thread calls them; the
    diffusers pipeline isn't bound to a compiled-graph thread, so it
    doesn't need the device thread."""

    def __init__(self, world_engine: "WorldEngineManager") -> None:
        self._world_engine = world_engine
        self.pipeline = None
        self.vlm = None  # llama_cpp.Llama instance
        self._loaded = False

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    # ─── Lifecycle ────────────────────────────────────────────────

    async def configure_for_session(self, *, scene_authoring_requested: bool) -> bool:
        """Bring the model state into line with what this session needs.
        Loads if requested-but-unloaded; unloads if loaded-but-unwanted.
        Returns True iff a fresh load happened (so the caller can emit the
        corresponding stage). Re-raises warmup failures."""
        if not scene_authoring_requested and self.is_loaded:
            logger.info("Scene authoring disabled — unloading model")
            await asyncio.to_thread(self.unload)
            return False
        if scene_authoring_requested and not self.is_loaded:
            await self.warmup()
            return True
        return False

    async def warmup(self) -> None:
        """Load both the VLM and the editing pipeline onto the device. Each
        step runs on the world engine's device thread so it serialises behind
        any in-flight world-engine ops. The heavy lib imports (diffusers,
        transformers, llama_cpp) are funneled through
        `_import_scene_authoring_libs` so it's obvious what gets pulled in."""
        libs = await asyncio.wrap_future(self._world_engine.submit_to_device_thread(_import_scene_authoring_libs))

        logger.info(f"[SCENE_EDIT] Loading VLM {VLM_GGUF_REPO}/{VLM_GGUF_FILE}...")
        t0 = time.perf_counter()
        await asyncio.wrap_future(self._world_engine.submit_to_device_thread(lambda: self._load_vlm_sync(libs)))
        logger.info(f"[SCENE_EDIT] VLM loaded in {time.perf_counter() - t0:.1f}s")

        logger.info(f"[SCENE_EDIT] Loading editing model {EDIT_MODEL_ID}...")
        t1 = time.perf_counter()
        await asyncio.wrap_future(self._world_engine.submit_to_device_thread(lambda: self._load_edit_sync(libs)))
        logger.info(f"[SCENE_EDIT] Editing model loaded in {time.perf_counter() - t1:.1f}s")

        self._loaded = True

    def unload(self) -> None:
        """Free device memory used by both models."""
        if self.vlm is not None:
            self.vlm.close()
        self.pipeline = None
        self.vlm = None
        self._loaded = False
        gc.collect()
        devices.empty_cache()

    def _load_vlm_sync(self, libs: _SceneAuthoringLibs) -> None:
        """Load the Gemma 4 vision-language model via llama.cpp (GGUF)."""
        model_path = libs.hf_hub_download(repo_id=VLM_GGUF_REPO, filename=VLM_GGUF_FILE)
        mmproj_path = libs.hf_hub_download(repo_id=VLM_GGUF_REPO, filename=VLM_MMPROJ_FILE)

        chat_handler = libs.Gemma4ChatHandler(
            clip_model_path=mmproj_path,
            verbose=False,
        )
        self.vlm = libs.Llama(
            model_path=model_path,
            chat_handler=chat_handler,
            n_ctx=VLM_CTX_SIZE,
            n_gpu_layers=-1,
            verbose=False,
        )

    def _load_edit_sync(self, libs: _SceneAuthoringLibs) -> None:
        """Load the FLUX.2 Klein editing pipeline (quantized transformer + text encoder)."""
        # Transformer: Q8 GGUF (~4.3GB)
        gguf_config = libs.GGUFQuantizationConfig(compute_dtype=torch.bfloat16)
        transformer = libs.Flux2Transformer2DModel.from_single_file(
            "https://huggingface.co/unsloth/FLUX.2-klein-4B-GGUF/blob/main/flux-2-klein-4b-Q8_0.gguf",
            config=EDIT_MODEL_ID,
            subfolder="transformer",
            quantization_config=gguf_config,
            torch_dtype=torch.bfloat16,
        )

        # Text encoder: 4-bit quantized (~2GB instead of ~8GB)
        bnb_config = libs.BitsAndBytesConfig(load_in_4bit=True)
        text_encoder = libs.AutoModelForCausalLM.from_pretrained(
            EDIT_MODEL_ID,
            subfolder="text_encoder",
            quantization_config=bnb_config,
            torch_dtype=torch.bfloat16,
        )

        pipe = libs.Flux2KleinPipeline.from_pretrained(
            EDIT_MODEL_ID,
            transformer=transformer,
            text_encoder=text_encoder,
            torch_dtype=torch.bfloat16,
        ).to(SCENE_AUTHORING_DEVICE)
        pipe.set_progress_bar_config(disable=True)
        self.pipeline = pipe

    # ─── VLM (writes Klein prompts) ──────────────────────────────

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
        raise MissingEditInstructionError(text)

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
                tools=VLM_TOOLS,
                max_tokens=VLM_MAX_TOKENS,
                temperature=1.0,
                top_p=0.95,
                top_k=64,
                min_p=0.0,
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000

            raw_output = result["choices"][0]["message"]["content"] or ""  # pyright: ignore[reportIndexIssue]  # llama_cpp returns a stream-or-dict union; we never use stream=True
            logger.info(f"[{log_prefix}] VLM raw (attempt {attempt}, {elapsed_ms:.0f}ms): {raw_output}")

            try:
                prompt = self._parse_edit_instruction(raw_output, safety_message_id)
            except ValueError as exc:
                last_error = exc
                logger.warning(f"[{log_prefix}] Tool call parse failed (attempt {attempt}/{VLM_MAX_RETRIES}): {exc}")
            else:
                logger.info(f"[{log_prefix}] Prompt: {prompt}")
                return prompt

        raise VlmToolCallRetryError(VLM_MAX_RETRIES, last_error)

    def _build_edit_prompt(self, frame_pil: Image.Image, user_request: str) -> str:
        """Ask the VLM for a Klein edit instruction given a reference frame."""
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
        """Ask the VLM for a text-to-image prompt (no reference frame)."""
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

    # ─── Klein pipeline (shared building blocks) ─────────────────

    @staticmethod
    def _aligned_size(h: int, w: int) -> tuple[int, int]:
        """Round (h, w) down to the FLUX.2 transformer's 16-pixel grid."""
        return h // 16 * 16, w // 16 * 16

    def _run_klein(self, image: Image.Image, prompt: str, target_h: int, target_w: int) -> Image.Image:
        """Run a single FLUX.2 Klein pass on `image` with `prompt`."""
        t0 = time.perf_counter()
        result = self.pipeline(
            image=image,
            prompt=prompt,
            num_inference_steps=EDIT_NUM_STEPS,
            height=target_h,
            width=target_w,
        ).images[0]
        logger.info(f"[KLEIN] Generation took {(time.perf_counter() - t0) * 1000:.0f}ms")
        return result

    @staticmethod
    def _to_seed_tensor(image: Image.Image, seed_target_size: tuple[int, int]) -> torch.Tensor:
        """Resize a PIL image to the world engine's seed target size and
        convert to a uint8 device tensor (HxWx3) ready for the engine."""
        h, w = seed_target_size
        image = image.resize((w, h), Image.LANCZOS)
        return torch.from_numpy(np.array(image)).to(dtype=torch.uint8, device=SCENE_AUTHORING_DEVICE).contiguous()

    # ─── Flows: edit + generate ──────────────────────────────────

    def _inpaint(
        self,
        frame_numpy: np.ndarray,
        user_request: str,
        seed_target_size: tuple[int, int],
    ) -> tuple[torch.Tensor, str]:
        """Edit a reference frame: VLM writes the prompt, Klein generates,
        result is resized to the engine's seed target size. Returns the
        edited frame as a uint8 device tensor + the VLM-authored prompt."""
        h_orig, w_orig = frame_numpy.shape[:2]
        frame_pil = Image.fromarray(frame_numpy)

        edit_prompt = self._build_edit_prompt(frame_pil, user_request)

        target_h, target_w = self._aligned_size(h_orig, w_orig)
        frame_resized = frame_pil.resize((target_w, target_h))
        result = self._run_klein(frame_resized, edit_prompt, target_h, target_w)

        return self._to_seed_tensor(result, seed_target_size), edit_prompt

    def _generate(
        self,
        user_request: str,
        seed_target_size: tuple[int, int],
    ) -> tuple[torch.Tensor, str]:
        """Generate a fresh scene: VLM writes the prompt (no reference image),
        Klein generates over a blank canvas, result is resized to the
        engine's seed target size. Returns the generated frame as a uint8
        device tensor + the VLM-authored prompt."""
        h, w = seed_target_size
        target_h, target_w = self._aligned_size(h, w)
        blank = Image.new("RGB", (target_w, target_h), (255, 255, 255))

        generation_prompt = self._build_generation_prompt(user_request)
        result = self._run_klein(blank, generation_prompt, target_h, target_w)

        return self._to_seed_tensor(result, seed_target_size), generation_prompt


# ─── Free orchestration functions (called from the generator thread) ──


def run_scene_edit(
    engines: "Engines",
    user_request: str,
    cpu_frames: list,
) -> SceneEditResponseData:
    """Run inpainting on the last subframe and apply the result to the engine.

    Takes the last subframe from the most recent gen_frame output, asks the
    VLM + Klein to inpaint it, safety-checks the result, and either resets
    the engine with the edit as the new seed or appends it repeatedly to
    strengthen it in the KV cache. Returns preview data for the RPC."""
    world_engine = engines.world_engine
    scene_authoring = engines.scene_authoring
    safety_checker = engines.safety_checker

    last_frame_np = cpu_frames[-1]

    # Encode original for client-side preview
    original_jpeg = world_engine.numpy_to_jpeg(last_frame_np)
    original_b64 = base64.b64encode(original_jpeg).decode("ascii")

    inpainted, edit_prompt = scene_authoring._inpaint(last_frame_np, user_request, world_engine.seed_target_size)

    # Encode inpainted for client-side preview
    inpainted_np = world_engine.tensor_to_numpy(inpainted)
    preview_jpeg = world_engine.numpy_to_jpeg(inpainted_np)
    preview_b64 = base64.b64encode(preview_jpeg).decode("ascii")

    inpainted_pil = Image.fromarray(inpainted_np)
    verdict = safety_checker.check_pil_image(inpainted_pil)
    if not verdict.is_safe:
        logger.warning(f"[SCENE_EDIT] Safety checker rejected inpainted image: {verdict.scores}")
        raise SafetyRejectionError()

    if EDIT_RESET_WITH_FRAME:
        world_engine.set_seed_and_reset(inpainted)
    else:
        world_engine.append_frame_repeatedly(inpainted, EDIT_APPEND_COUNT)

    return SceneEditResponseData(
        original_jpeg_b64=original_b64,
        preview_jpeg_b64=preview_b64,
        edit_prompt=edit_prompt,
    )


def run_generate_scene(
    engines: "Engines",
    user_request: str,
    biome_version: str | None,
) -> GenerateSceneResponseData:
    """Generate a fresh scene from a text prompt and load it as the new seed.

    Unlike scene_edit, this is a brand-new world: `original_seed_frame` is
    overwritten so a subsequent reset returns to this generated scene rather
    than the previous seed. The generated JPEG is returned (with embedded
    metadata) so the client can persist it if Scene Authoring auto-save is
    on."""
    world_engine = engines.world_engine
    scene_authoring = engines.scene_authoring
    safety_checker = engines.safety_checker

    t0 = time.perf_counter()

    generated, sanitized_prompt = scene_authoring._generate(user_request, world_engine.seed_target_size)

    # Safety check on the generated image
    generated_np = world_engine.tensor_to_numpy(generated)
    generated_pil = Image.fromarray(generated_np)
    verdict = safety_checker.check_pil_image(generated_pil)
    if not verdict.is_safe:
        logger.warning(f"[GENERATE_SCENE] Safety checker rejected generated image: {verdict.scores}")
        raise SafetyRejectionError(GENERATE_SCENE_SAFETY_MESSAGE_ID)

    # Encode the generated image as JPEG for the client to persist. Done
    # before any multiframe expansion so we encode a single HxWx3 frame.
    properties = GeneratedSceneProperties(
        biome_version=biome_version or "unknown",
        image_model=EDIT_MODEL_ID,
        user_prompt=user_request,
        sanitized_prompt=sanitized_prompt,
        generated_at=time.time(),
    )
    jpeg_buf = io.BytesIO()
    generated_pil.save(
        jpeg_buf,
        format="JPEG",
        quality=92,
        comment=properties_to_jpeg_comment(properties),
    )
    image_b64 = base64.b64encode(jpeg_buf.getvalue()).decode("ascii")

    # Reset the engine with the generated frame as the new seed AND the new
    # `original_seed_frame` (so a subsequent U-key reset returns here).
    world_engine.set_seed_and_reset(generated, set_as_original=True)

    elapsed_ms = (time.perf_counter() - t0) * 1000
    logger.info(f"[GENERATE_SCENE] Complete in {elapsed_ms:.0f}ms")
    return GenerateSceneResponseData(
        elapsed_ms=round(elapsed_ms),
        image_jpeg_base64=image_b64,
        user_prompt=user_request,
        sanitized_prompt=sanitized_prompt,
        image_model=EDIT_MODEL_ID,
    )
