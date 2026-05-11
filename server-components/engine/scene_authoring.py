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

# pyright: reportMissingTypeArgument=none, reportPrivateImportUsage=none, reportUnknownArgumentType=none, reportUnknownMemberType=none, reportUnknownParameterType=none, reportUnknownVariableType=none

import asyncio
import base64
import gc
import io
import json
import re
import time
from dataclasses import asdict, dataclass, field
from io import BytesIO
from typing import TYPE_CHECKING, Any, Literal

import numpy as np
import structlog
import torch
from PIL import Image, ImageFilter

from engine import devices
from engine.devices import SCENE_AUTHORING_DEVICE
from server.protocol import GenerateSceneResponseData, SceneEditResponseData, ScenePropEditResponseData

if TYPE_CHECKING:
    from engine import Engines
    from engine.manager import WorldEngineManager

logger = structlog.stdlib.get_logger(__name__)


SCENE_EDIT_SAFETY_MESSAGE_ID = "app.server.error.sceneEditSafetyRejected"
GENERATE_SCENE_SAFETY_MESSAGE_ID = "app.server.error.generateSceneSafetyRejected"


# ─── Pageable model identities + VRAM accounting ─────────────────────
# Three GPU-resident model classes share VRAM with the world engine.
# `vlm` writes Klein prompts, `ti2i` is the Klein image editor, `ti2v`
# is the video model used for prop spawn / scene transition animations.
# Each is loaded / unloaded independently; `SceneAuthoringManager.ensure`
# is the LRU-with-VRAM-budget policy that brings the right ones into
# residence for the op at hand. World engine VRAM is a fixed cost the
# manager doesn't account for — only the pageable bucket below is.

ModelKind = Literal["vlm", "ti2i", "ti2v"]

# Approximate steady-state GPU residency per kind. All three are fully
# resident on GPU when loaded. The LRU policy in `ensure` is the only
# control on simultaneous residency; ops that need exclusive use of
# the pageable bucket pass `exclusive=True` to force-evict everything
# else.
MODEL_VRAM_GB: dict[ModelKind, float] = {
    "vlm": 4.0,  # Gemma 4 E4B GGUF Q4 + mmproj
    "ti2i": 7.0,  # FLUX.2 Klein 4B Q8 GGUF + UMT5 4-bit
    "ti2v": 8.0,  # LTX-Video 2B FP8 layerwise + T5-XXL bf16 + VAE
}

# Hard cap on simultaneously-loaded pageable model weights, sized for
# 24 GB VRAM target with the world engine taking ~5 GB. Pairs that fit:
#   vlm(4) + ti2i(7)  = 11 ✓   (default scene-edit ops; baseline pair)
#   vlm(4) + ti2v(9)  = 13 ✓
#   ti2i(7) + ti2v(9) = 16 ✗   (forces eviction; the video path requests
#                                exclusive ti2v anyway, so this is fine)
# All three (20) never fit; warmup verifies each in sequence.
VRAM_BUDGET_GB = 15.0


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


class VlmNotLoadedError(RuntimeError):
    """Raised when an operation requires the scene-authoring VLM but it
    isn't loaded yet. Use `SceneAuthoringManager.is_loaded` to gate calls."""

    def __init__(self) -> None:
        super().__init__("VLM is not loaded")


class KleinPipelineNotLoadedError(RuntimeError):
    """Raised when an operation requires the FLUX.2 Klein pipeline but it
    isn't loaded yet. Use `SceneAuthoringManager.is_loaded` to gate calls."""

    def __init__(self) -> None:
        super().__init__("Klein pipeline is not loaded")


class VideoPipelineNotLoadedError(RuntimeError):
    """Raised when an operation requires the video pipeline but it
    isn't loaded. Lazy-loaded on first `video` mode op via
    `SceneAuthoringManager.ensure`."""

    def __init__(self) -> None:
        super().__init__("Video pipeline is not loaded")


class InsufficientVramError(RuntimeError):
    """Raised when `SceneAuthoringManager.ensure` cannot honour a request
    even after evicting every non-required model — i.e. the requested
    set itself exceeds `VRAM_BUDGET_GB`. Indicates either a misconfigured
    budget or trying to hold too many models simultaneously."""

    def __init__(self, requested: set[ModelKind], required_gb: float, budget_gb: float) -> None:
        self.requested = requested
        self.required_gb = required_gb
        self.budget_gb = budget_gb
        super().__init__(
            f"Cannot fit models {sorted(requested)} ({required_gb:.1f} GB) into VRAM budget {budget_gb:.1f} GB"
        )


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


# ─── Video editor configuration (LTX-Video 2B FLF) ───────────────────
# Concrete model: `Lightricks/LTX-Video-0.9.5`. Picked for native FLF
# support (keyframe conditioning via `LTXConditionPipeline`), small
# size (~2 B params), and a clean FP8 path via diffusers' layerwise
# weight casting that cuts the transformer storage to ~3 GB while
# computing in bf16 — no GGUF dance required. Inference is fast enough
# (~tens of seconds per spawn) that we can run video transitions on
# the interactive prop-spawn flow rather than treating them as an
# offline op.

VIDEO_MODEL_ID = "Lightricks/LTX-Video-0.9.5"
VIDEO_NUM_INFERENCE_STEPS = 40  # model card default for FLF
VIDEO_GUIDANCE_SCALE = 3.0  # model card default; raise to 5.0 for higher quality
# Frame count must satisfy `(N-1) % 8 == 0` (VAE temporal compression
# of 8 + 1 init frame). Valid: 9, 17, 25, 33, 41, 49, …, 161.
VIDEO_NUM_FRAMES = 33
# Sharper FLF endpoint adherence than the diffusers default of 0.15.
# `decode_*` taken from the official FLF example.
VIDEO_IMAGE_COND_NOISE_SCALE = 0.025
VIDEO_DECODE_TIMESTEP = 0.05
VIDEO_DECODE_NOISE_SCALE = 0.025
VIDEO_NEGATIVE_PROMPT = "worst quality, inconsistent motion, blurry, jittery, distorted"
# When True, replace the manifest-supplied `video_prompt` with one the
# VLM authors at request time from both pre- and post-edit frames. The
# extra VLM round-trip is non-trivial relative to total spawn latency;
# flip to True only for iterating on prompt phrasings.
VIDEO_USE_VLM_PROMPT = False
# Hold frames appended after the video transition. Lets the WM settle
# on the new state in its KV cache before normal generation resumes.
# Streamed at ANIM_PLAYBACK_FPS (60 fps), so 60 frames ≈ 1 s held.
VIDEO_HOLD_FRAMES = 60
# Render at 1280x704: pipeline requires h/w divisible by 32, and 704 is
# the closest valid value below the WM's typical 720-pixel seed height.
# Output is resized to `seed_target_size` for the engine append.
VIDEO_HEIGHT = 704
VIDEO_WIDTH = 1280


# ─── Klein editor configuration ──────────────────────────────────────

EDIT_MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
EDIT_NUM_STEPS = 4

# ─── Edit application mode ───────────────────────────────────────────
# "reset" replays the edited frame as the new seed (clean KV — robust but
# discontinuous). "fall" diffs the changed region, animates it tweening in
# from the top of the frame, and appends the resulting tween frames to the
# engine so prior context survives. The fall path keeps the model "in
# distribution" by showing the edit as a gradual change rather than a sudden
# pop. One mode per edit class so each can be A/B tuned independently —
# whole-scene edits and held-item edits don't generally make sense as a
# vertical drop, but we keep them switchable for testing.

SceneEditMode = Literal["reset", "fall", "video"]

SCENE_EDIT_PROMPTED_MODE: SceneEditMode = "video"  # VLM-authored full-frame edit
SCENE_EDIT_DIRECT_MODE: SceneEditMode = "video"  # environment / weather presets
PROP_EDIT_SPAWNABLE_MODE: SceneEditMode = "video"  # placed-in-world prop
PROP_EDIT_HOLDABLE_MODE: SceneEditMode = "reset"  # first-person held item

# Tween animation tuning (used when mode == "fall"). The fall portion is the
# visible drop-in; the hold portion locks the landed image so the user (and
# the model's KV cache) settle on the new state before control resumes.
# Frame counts are sized in WM-frame units (~1 s fall + ~0.5 s hold at the
# WM's 60 fps playback rate).
ANIM_FALL_FRAMES = 60
ANIM_HOLD_FRAMES = 30
ANIM_PLAYBACK_FPS = 60.0  # matches the WM's native frame rate
ANIM_FALLBACK_APPEND_COUNT = 32  # appends used when fall is requested but no bbox is detectable

# Bbox-isolation tuning (see `_compute_edit_bbox`). Klein re-encodes the
# whole frame, so a naïve per-pixel threshold mask spans everything; we
# need to filter for *spatially-coherent* change rather than scattered
# noise. Tunables are kept as constants so we can iterate on them without
# code churn.
ANIM_DELTA_THRESHOLD = 18  # luma-weighted Euclidean diff threshold (post-blur)
ANIM_BLUR_RADIUS = 3.0  # Gaussian blur radius used to suppress per-pixel Klein noise
ANIM_OPENING_KERNEL = 11  # PIL MinFilter / MaxFilter kernel for morphological opening (must be odd)
ANIM_MAX_BBOX_FRACTION = 0.7  # if the bbox covers more than this fraction of the frame, treat as whole-scene

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
    "2. HANDHELD OBJECTS (weapons, tools, items): The player must hold "
    "ONLY the new object in the bottom-right of the frame, as in a "
    "first-person shooter. If a hand currently holds anything, REMOVE "
    "that item and replace it with the new one — never have the player "
    "holding multiple items at once. If the hands are empty, add a hand "
    "holding the object in the bottom-right corner.\n"
    "3. SCENE ELEMENTS (buildings, creatures, weather): Place ON TOP of "
    "or alongside existing scene content — do not erase or overwrite "
    "existing buildings, terrain, or props in the scene.\n"
    "4. STYLE/MOOD changes: Describe the transformation clearly.\n"
    f"5. {VLM_CONTENT_POLICY}\n\n"
    "EXAMPLES:\n"
    '- User: "sword" → "Remove any item currently in the player\'s '
    "hands and replace it with a glowing sword, held in a right hand "
    "in the bottom-right corner of the frame, as in a first-person "
    'game. Keep the background scene unchanged."\n'
    '- User: "dragon" → "Add a large dragon flying in the sky above '
    'the scene. Keep everything else unchanged."\n'
    '- User: "make it night" → "Change the lighting to nighttime with '
    'a dark sky, moonlight, and shadows. Keep everything else unchanged."\n'
    '- User: "remove the tree" → "Remove the tree from the scene and '
    "fill the area with the surrounding environment. Keep everything "
    'else unchanged."\n'
    '- User: "shotgun" → "Remove any item currently in the player\'s '
    "hands and replace it with a pump-action shotgun, held in a right "
    "hand in the bottom-right corner of the frame, as in a first-person "
    'shooter. Keep the background scene unchanged."\n\n'
    "Always end with 'Keep everything else unchanged.' (or 'Keep the "
    "background scene unchanged.' for handheld replacements).\n\n"
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

VLM_VIDEO_PROMPT_SYSTEM_PROMPT = (
    "You write motion descriptions for an AI video generator. The video "
    "starts at the FIRST image (before) and ends at the SECOND image "
    "(after). The endpoints are already locked in via latent injection — "
    "your job is to describe the natural motion that takes the scene "
    "from before to after, so the in-between frames flow correctly.\n\n"
    "Look at both images. Identify what's NEW or CHANGED in the after "
    "image, and describe the action that brings about that change, "
    "using verbs that fit the actual scene. Match the direction implied "
    "by the endpoints — don't say 'from the left' if the new element "
    "ends up on the right. Don't add motion the endpoints don't "
    "support. Single short sentence, under 25 words.\n\n"
    "EXAMPLES:\n"
    '- before: empty street; after: ambulance parked on street → "An '
    'ambulance pulls up and parks on the side of the street."\n'
    '- before: forest clearing; after: tree in clearing → "A tall oak '
    'tree grows up out of the ground in the forest clearing."\n'
    '- before: empty wall; after: framed painting on wall → "A framed '
    'oil painting drops down and hangs on the wall."\n'
    '- before: empty room; after: chair in room → "A wooden chair '
    'lowers into place in the centre of the room."\n\n'
    "Submit your description via the submit_edit_instruction tool. Do "
    "not deliberate at length."
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
    LTXConditionPipeline: Any
    LTXVideoCondition: Any
    AutoModel: Any


def _import_scene_authoring_libs() -> _SceneAuthoringLibs:
    """Single home for the heavy imports needed by scene-authoring model
    loading. Pulls diffusers / transformers / llama_cpp into the module
    graph; called only when warmup runs (i.e. when a session has scene
    authoring enabled), so disabled-by-default sessions never pay the
    import cost."""
    from diffusers import (
        AutoModel,
        Flux2KleinPipeline,
        Flux2Transformer2DModel,
        GGUFQuantizationConfig,
        LTXConditionPipeline,
    )
    from diffusers.pipelines.ltx.pipeline_ltx_condition import LTXVideoCondition
    from huggingface_hub import hf_hub_download
    from llama_cpp import Llama
    from llama_cpp.llama_chat_format import (
        Gemma4ChatHandler,  # pyright: ignore[reportAttributeAccessIssue]  -- llama_cpp.llama_chat_format stubs lag the runtime API
    )
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
        LTXConditionPipeline=LTXConditionPipeline,
        LTXVideoCondition=LTXVideoCondition,
        AutoModel=AutoModel,
    )


# ─── SceneAuthoringManager ───────────────────────────────────────────


class SceneAuthoringManager:
    """FLUX.2 Klein (image editor) + Gemma 4 E4B (VLM that writes Klein
    prompts) + LTX-Video 2B (video editor for prop spawn / scene
    transition animations).

    The three model classes share a fixed `VRAM_BUDGET_GB` slice of GPU
    memory; the world engine's footprint is outside that slice and stays
    resident. `ensure(kinds)` is the LRU-with-budget paging policy: it
    loads anything in `kinds` that isn't already resident, evicting
    least-recently-used pageables along the way to stay under budget.
    Each op (scene_edit, scene_prop_edit, video_gen, …) calls `ensure`
    with its required kinds before reaching for the underlying instance.

    Loading runs on the world engine's device thread so it serialises
    behind in-flight gen_frame work — no direct device-executor access.
    Inference itself runs on whatever thread calls into the flow methods;
    the diffusers / llama_cpp instances aren't bound to a compiled-graph
    thread."""

    def __init__(self, world_engine: "WorldEngineManager") -> None:
        self._world_engine = world_engine
        self._libs: _SceneAuthoringLibs | None = None
        self._last_used: dict[ModelKind, float] = {}
        self._configured = False
        # Public per-model handles, set by load + cleared by unload.
        self.pipeline = None  # FLUX.2 Klein pipeline (ti2i)
        self.vlm = None  # llama_cpp.Llama instance (vlm)
        self.video_pipeline = None  # LTX-Video pipeline (ti2v)

    @property
    def is_loaded(self) -> bool:
        """True iff the current session has scene-authoring enabled. The
        actual VRAM residency varies under LRU paging — this is purely a
        session-config signal that callers use to gate scene-authoring
        RPCs."""
        return self._configured

    def is_kind_loaded(self, kind: ModelKind) -> bool:
        """True iff `kind`'s underlying instance is currently resident in
        VRAM. Used internally by `ensure`; exposed for diagnostics."""
        if kind == "vlm":
            return self.vlm is not None
        if kind == "ti2i":
            return self.pipeline is not None
        return self.video_pipeline is not None

    @property
    def _loaded_kinds(self) -> set[ModelKind]:
        return {k for k in ("vlm", "ti2i", "ti2v") if self.is_kind_loaded(k)}

    def _current_vram_gb(self) -> float:
        return sum(MODEL_VRAM_GB[k] for k in self._loaded_kinds)

    # ─── Lifecycle ────────────────────────────────────────────────

    async def configure_for_session(self, *, scene_authoring_requested: bool) -> None:
        """Bring the model state into line with what this session needs.
        At session start, walk every pageable kind (VLM → TI2I → TI2V)
        so each downloads its weights and instantiates at least once
        before gameplay — surfaces missing files, broken kernels, and
        OOM at warmup rather than mid-edit. The LRU paging policy
        evicts as we go (vlm + ti2i + ti2v together don't fit). Warmup
        settles on `{ti2i, ti2v}` — the spawn-then-animate baseline —
        so the first prop click runs Klein → video model with no swap.
        VLM is reloaded on demand when scene_edit-by-prompt or
        build_video_prompt fires (~3 s, llama.cpp GGUF)."""
        if not scene_authoring_requested and self._configured:
            logger.info("Scene authoring disabled — unloading models")
            await asyncio.to_thread(self.unload)
            return
        if not (scene_authoring_requested and not self._configured):
            return

        # 1. VLM by itself — verification load, will get evicted by step 3.
        await asyncio.to_thread(self.ensure, {"vlm"})
        # 2. Add TI2I (4 + 7 = 11 ≤ budget).
        await asyncio.to_thread(self.ensure, {"vlm", "ti2i"})
        # 3. Add TI2V — vlm + ti2i + ti2v = 19 > 15 budget, so LRU
        #    evicts vlm (oldest). Lands on {ti2i, ti2v} = 15, exactly
        #    at budget. This is the steady-state for prop-spawn flows.
        await asyncio.to_thread(self.ensure, {"ti2v"})

        self._configured = True

    def unload(self) -> None:
        """Free device memory used by every pageable model and clear the
        session-configured flag."""
        for kind in tuple(self._loaded_kinds):
            self._unload_kind(kind)
        self._configured = False
        gc.collect()
        devices.empty_cache()

    # ─── Paging policy ────────────────────────────────────────────

    def ensure(self, kinds: set[ModelKind], *, exclusive: bool = False) -> None:
        """Synchronously make sure each model in `kinds` is resident,
        evicting LRU pageables as needed to stay under `VRAM_BUDGET_GB`.
        Loads / unloads run on the world engine's device thread so they
        serialise behind in-flight gen_frame work; this method blocks
        until everything in `kinds` is loaded.

        With `exclusive=True`, eagerly unload every loaded kind that
        isn't in `kinds` regardless of budget pressure. Used by ops
        that need the whole pageable bucket — typically heavy video
        inference paths that would otherwise OOM trying to migrate
        their text encoder onto a GPU still holding Klein + VLM.

        Safe to call from the generator thread or from async code via
        `asyncio.to_thread(...)`. Bumps `_last_used` for every kind in
        `kinds` (including already-resident ones), so frequently-used
        models keep their slots when newer requests need to evict."""
        if exclusive:
            for kind in tuple(self._loaded_kinds - kinds):
                self._unload_kind(kind)

        needed_load = kinds - self._loaded_kinds
        pending_gb = sum(MODEL_VRAM_GB[k] for k in needed_load)

        while self._current_vram_gb() + pending_gb > VRAM_BUDGET_GB:
            evictable = self._loaded_kinds - kinds
            if not evictable:
                # Even with everything held-aside-for-eviction unloaded
                # we still wouldn't fit → caller asked for too much.
                requested_gb = sum(MODEL_VRAM_GB[k] for k in kinds)
                raise InsufficientVramError(kinds, requested_gb, VRAM_BUDGET_GB)
            lru = min(evictable, key=lambda k: self._last_used.get(k, 0.0))
            self._unload_kind(lru)

        for kind in needed_load:
            self._load_kind(kind)

        now = time.perf_counter()
        for kind in kinds:
            self._last_used[kind] = now

    def _ensure_libs(self) -> _SceneAuthoringLibs:
        """Lazy-load the heavy import waterfall the first time any kind is
        loaded; cached for subsequent loads in the same process."""
        libs = self._libs
        if libs is None:
            future = self._world_engine.submit_to_device_thread(_import_scene_authoring_libs)
            libs = future.result()
            assert isinstance(libs, _SceneAuthoringLibs)
            self._libs = libs
        return libs

    def _load_kind(self, kind: ModelKind) -> None:
        libs = self._ensure_libs()
        log = logger.bind(kind=kind)
        log.info("Loading model")
        t0 = time.perf_counter()
        if kind == "vlm":
            self._world_engine.submit_to_device_thread(lambda: self._load_vlm_sync(libs)).result()
        elif kind == "ti2i":
            self._world_engine.submit_to_device_thread(lambda: self._load_ti2i_sync(libs)).result()
        else:
            self._world_engine.submit_to_device_thread(lambda: self._load_ti2v_sync(libs)).result()
        log.info("Model loaded", duration_s=round(time.perf_counter() - t0, 1))

    def _unload_kind(self, kind: ModelKind) -> None:
        log = logger.bind(kind=kind)
        log.info("Unloading model")
        if kind == "vlm":
            if self.vlm is not None:
                self.vlm.close()
            self.vlm = None
        elif kind == "ti2i":
            self.pipeline = None
        else:
            self.video_pipeline = None
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

    def _load_ti2i_sync(self, libs: _SceneAuthoringLibs) -> None:
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

    def _load_ti2v_sync(self, libs: _SceneAuthoringLibs) -> None:
        """Load the LTX-Video pipeline: bf16 transformer cast to fp8
        layerwise (~3 GB storage, bf16 compute) + T5-XXL text encoder
        + AutoencoderKLLTXVideo (both auto-loaded from
        `Lightricks/LTX-Video-0.9.5`'s model_index.json)."""
        # FP8 layerwise weight casting is the officially documented FP8
        # path — no separate FP8 file needed, just
        # `enable_layerwise_casting` after `from_pretrained` loads bf16
        # weights (which are then cast to fp8 storage in place).
        transformer = libs.AutoModel.from_pretrained(
            VIDEO_MODEL_ID,
            subfolder="transformer",
            torch_dtype=torch.bfloat16,
        )
        transformer.enable_layerwise_casting(
            storage_dtype=torch.float8_e4m3fn,
            compute_dtype=torch.bfloat16,
        )

        # Text encoder, VAE, tokenizer, scheduler are auto-loaded from
        # the repo's model_index.json. T5-XXL is ~9 GB at bf16, but
        # inference uses it briefly per prompt; if VRAM gets tight we
        # can add a quantization_config override.
        pipe = libs.LTXConditionPipeline.from_pretrained(
            VIDEO_MODEL_ID,
            transformer=transformer,
            torch_dtype=torch.bfloat16,
        ).to(SCENE_AUTHORING_DEVICE)
        pipe.set_progress_bar_config(disable=True)
        # VAE tiling + slicing keeps decode memory bounded at higher
        # resolutions / frame counts.
        pipe.vae.enable_tiling()
        pipe.vae.enable_slicing()
        self.video_pipeline = pipe

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
        operation: str,
        safety_message_id: str = SCENE_EDIT_SAFETY_MESSAGE_ID,
    ) -> str:
        """Run the VLM with retries, parse a tool call, return the instruction.

        Raises SafetyRejectionError if the VLM calls reject_request.
        Raises RuntimeError after VLM_MAX_RETRIES failed attempts.
        """
        if self.vlm is None:
            raise VlmNotLoadedError
        vlm = self.vlm
        log = logger.bind(operation=operation)
        last_error = None
        for attempt in range(1, VLM_MAX_RETRIES + 1):
            t0 = time.perf_counter()
            result = vlm.create_chat_completion(
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
            log.info(
                "VLM raw output",
                attempt=attempt,
                total_attempts=VLM_MAX_RETRIES,
                elapsed_ms=round(elapsed_ms),
                raw_output=raw_output,
            )

            try:
                prompt = self._parse_edit_instruction(raw_output, safety_message_id)
            except ValueError as exc:
                last_error = exc
                log.warning("Tool call parse failed", attempt=attempt, total_attempts=VLM_MAX_RETRIES, error=str(exc))
            else:
                log.info("Prompt", prompt=prompt)
                return prompt

        raise VlmToolCallRetryError(VLM_MAX_RETRIES, last_error)

    def _build_edit_prompt(self, frame_pil: Image.Image, user_request: str) -> str:
        """Ask the VLM for a Klein edit instruction given a reference frame."""
        # Downscale frame to reduce vision token count and speed up inference
        vlm_frame = frame_pil.copy()
        vlm_frame.thumbnail((VLM_IMAGE_MAX_SIZE, VLM_IMAGE_MAX_SIZE), Image.Resampling.LANCZOS)
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
        return self._run_vlm(messages, "scene_edit", SCENE_EDIT_SAFETY_MESSAGE_ID)

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
        return self._run_vlm(messages, "generate_scene", GENERATE_SCENE_SAFETY_MESSAGE_ID)

    def build_video_prompt(self, pre_edit: np.ndarray, post_edit: np.ndarray) -> str:
        """Ask the VLM to describe the motion that takes the scene from
        `pre_edit` (the video model's first-frame anchor) to `post_edit`
        (Klein's end-frame anchor). The VLM sees both endpoints, so it
        can pick verbs and direction consistent with the actual
        composition — unlike a static manifest template which has no
        way to know where Klein placed the prop. Caller is responsible
        for keeping the VLM resident before calling — typically by
        running this before the video pipeline load."""

        def _to_uri(arr: np.ndarray) -> str:
            pil = Image.fromarray(arr)
            pil.thumbnail((VLM_IMAGE_MAX_SIZE, VLM_IMAGE_MAX_SIZE), Image.Resampling.LANCZOS)
            return _pil_to_data_uri(pil)

        pre_uri = _to_uri(pre_edit)
        post_uri = _to_uri(post_edit)
        messages = [
            {"role": "system", "content": VLM_VIDEO_PROMPT_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Before image:"},
                    {"type": "image_url", "image_url": {"url": pre_uri}},
                    {"type": "text", "text": "After image:"},
                    {"type": "image_url", "image_url": {"url": post_uri}},
                    {
                        "type": "text",
                        "text": (
                            "Describe the motion that takes the scene from the before "
                            "image to the after image, in a single short sentence. "
                            "Submit via the submit_edit_instruction tool."
                        ),
                    },
                ],
            },
        ]
        return self._run_vlm(messages, "video_prompt", SCENE_EDIT_SAFETY_MESSAGE_ID)

    # ─── Klein pipeline (shared building blocks) ─────────────────

    @staticmethod
    def _aligned_size(h: int, w: int) -> tuple[int, int]:
        """Round (h, w) down to the FLUX.2 transformer's 16-pixel grid."""
        return h // 16 * 16, w // 16 * 16

    def _run_klein(self, image: Image.Image, prompt: str, target_h: int, target_w: int) -> Image.Image:
        """Run a single FLUX.2 Klein pass on `image` with `prompt`."""
        if self.pipeline is None:
            raise KleinPipelineNotLoadedError
        t0 = time.perf_counter()
        result = self.pipeline(
            image=image,
            prompt=prompt,
            num_inference_steps=EDIT_NUM_STEPS,
            height=target_h,
            width=target_w,
        ).images[0]
        logger.info("Klein generation complete", elapsed_ms=round((time.perf_counter() - t0) * 1000))
        return result

    @staticmethod
    def _to_seed_tensor(image: Image.Image, seed_target_size: tuple[int, int]) -> torch.Tensor:
        """Resize a PIL image to the world engine's seed target size and
        convert to a uint8 device tensor (HxWx3) ready for the engine."""
        h, w = seed_target_size
        image = image.resize((w, h), Image.Resampling.LANCZOS)
        return torch.from_numpy(np.array(image)).to(dtype=torch.uint8, device=SCENE_AUTHORING_DEVICE).contiguous()

    # ─── Flows: edit + generate ──────────────────────────────────

    def inpaint(
        self,
        frame_numpy: np.ndarray,
        user_request: str,
        seed_target_size: tuple[int, int],
        *,
        direct: bool = False,
    ) -> tuple[torch.Tensor, str]:
        """Edit a reference frame: VLM writes the prompt (unless `direct`,
        in which case `user_request` is sent to Klein verbatim), Klein
        generates, result is resized to the engine's seed target size.
        Returns the edited frame as a uint8 device tensor + the prompt
        that was actually used."""
        # `direct` mode skips the VLM entirely so we don't need it loaded.
        self.ensure({"ti2i"} if direct else {"vlm", "ti2i"})

        h_orig, w_orig = frame_numpy.shape[:2]
        frame_pil = Image.fromarray(frame_numpy)

        edit_prompt = user_request if direct else self._build_edit_prompt(frame_pil, user_request)

        target_h, target_w = self._aligned_size(h_orig, w_orig)
        frame_resized = frame_pil.resize((target_w, target_h))
        result = self._run_klein(frame_resized, edit_prompt, target_h, target_w)

        return self._to_seed_tensor(result, seed_target_size), edit_prompt

    def generate(
        self,
        user_request: str,
        seed_target_size: tuple[int, int],
    ) -> tuple[torch.Tensor, str]:
        """Generate a fresh scene: VLM writes the prompt (no reference image),
        Klein generates over a blank canvas, result is resized to the
        engine's seed target size. Returns the generated frame as a uint8
        device tensor + the VLM-authored prompt."""
        self.ensure({"vlm", "ti2i"})

        h, w = seed_target_size
        target_h, target_w = self._aligned_size(h, w)
        blank = Image.new("RGB", (target_w, target_h), (255, 255, 255))

        generation_prompt = self._build_generation_prompt(user_request)
        result = self._run_klein(blank, generation_prompt, target_h, target_w)

        return self._to_seed_tensor(result, seed_target_size), generation_prompt

    def inpaint_with_prop(
        self,
        frame_numpy: np.ndarray,
        reference: Image.Image,
        kind: str,
        target: str,
        subject: str,
        seed_target_size: tuple[int, int],
    ) -> tuple[torch.Tensor, str]:
        """Edit a reference frame by compositing in a known prop.

        Bypasses the VLM: builds a deterministic edit instruction from
        `kind` ("spawnable" / "holdable") and `target` ("centre" /
        "appropriate"), then runs Klein with [scene, prop] as a
        multi-image edit. Returns the edited frame as a uint8 device
        tensor + the prompt that was used."""
        self.ensure({"ti2i"})
        if self.pipeline is None:
            raise KleinPipelineNotLoadedError

        h_orig, w_orig = frame_numpy.shape[:2]
        target_h, target_w = self._aligned_size(h_orig, w_orig)

        scene_pil = Image.fromarray(frame_numpy).resize((target_w, target_h))
        reference_pil = _flatten_and_letterbox(reference, target_h, target_w)

        prompt = _build_prop_edit_prompt(kind=kind, target=target, subject=subject)

        t0 = time.perf_counter()
        result = self.pipeline(
            image=[scene_pil, reference_pil],
            prompt=prompt,
            num_inference_steps=EDIT_NUM_STEPS,
            height=target_h,
            width=target_w,
        ).images[0]
        logger.info(
            "Klein prop edit complete",
            elapsed_ms=round((time.perf_counter() - t0) * 1000),
            kind=kind,
            target=target,
        )

        return self._to_seed_tensor(result, seed_target_size), prompt

    # ─── Video pipeline (native first/last-frame conditioning) ─────

    def generate_flf(
        self,
        first_frame: np.ndarray,
        last_frame: np.ndarray,
        prompt: str,
        seed_target_size: tuple[int, int],
        *,
        num_frames: int = VIDEO_NUM_FRAMES,
    ) -> list[np.ndarray]:
        """Render a video that transitions from `first_frame` to `last_frame`
        guided by `prompt`. Pins both endpoints via `LTXVideoCondition`
        keyframes at frame 0 and `num_frames-1` — LTX is trained for
        arbitrary frame conditioning so endpoint adherence is supervised
        rather than coaxed via latent injection. Returns frames as a
        list of uint8 HxWx3 numpy arrays at `seed_target_size`."""
        if self.video_pipeline is None:
            raise VideoPipelineNotLoadedError
        pipe = self.video_pipeline
        libs = self._ensure_libs()

        target_h, target_w = VIDEO_HEIGHT, VIDEO_WIDTH
        first_pil = Image.fromarray(first_frame).resize((target_w, target_h), Image.Resampling.LANCZOS)
        last_pil = Image.fromarray(last_frame).resize((target_w, target_h), Image.Resampling.LANCZOS)

        # The pipeline expresses FLF as a list of conditions at specific frame
        # indices, not `image=` / `last_image=` kwargs. We pin frame 0
        # to the pre-edit and the last frame to Klein's post-edit; the
        # model interpolates the middle.
        conditions = [
            libs.LTXVideoCondition(image=first_pil, frame_index=0),
            libs.LTXVideoCondition(image=last_pil, frame_index=num_frames - 1),
        ]

        t0 = time.perf_counter()
        output = pipe(
            conditions=conditions,
            prompt=prompt,
            negative_prompt=VIDEO_NEGATIVE_PROMPT,
            height=target_h,
            width=target_w,
            num_frames=num_frames,
            num_inference_steps=VIDEO_NUM_INFERENCE_STEPS,
            guidance_scale=VIDEO_GUIDANCE_SCALE,
            image_cond_noise_scale=VIDEO_IMAGE_COND_NOISE_SCALE,
            decode_timestep=VIDEO_DECODE_TIMESTEP,
            decode_noise_scale=VIDEO_DECODE_NOISE_SCALE,
            output_type="pil",
        )
        logger.info(
            "Video FLF generation complete",
            prompt=prompt,
            elapsed_ms=round((time.perf_counter() - t0) * 1000),
            num_frames=num_frames,
            steps=VIDEO_NUM_INFERENCE_STEPS,
            size=(target_h, target_w),
        )

        # `output.frames[0]` is a list of PIL Images (default `output_type='pil'`).
        pil_frames = output.frames[0]
        target_size = (seed_target_size[1], seed_target_size[0])  # PIL wants (W, H)
        return [
            np.asarray(frame.convert("RGB").resize(target_size, Image.Resampling.LANCZOS))
            if frame.size != target_size
            else np.asarray(frame.convert("RGB"))
            for frame in pil_frames
        ]


# ─── Edit application helpers (mode dispatch + fall animation) ──────


def _compute_edit_bbox(original: np.ndarray, edited: np.ndarray) -> tuple[int, int, int, int] | None:
    """Bounding box (y0, x0, y1, x1) of the substantively-changed region.

    Klein re-encodes the entire frame on every pass, so a naïve `abs_diff
    > threshold` picks up low-amplitude noise everywhere — the bbox ends up
    covering the whole image. This pipeline favours spatially-coherent
    change over scattered specks:

      1. Luma-weighted Euclidean diff (Rec. 601 weights) — closer to
         perceived brightness change than per-channel max.
      2. Gaussian blur (`ANIM_BLUR_RADIUS`) to wash out per-pixel JPEG /
         re-encode noise that the threshold would otherwise pick up.
      3. Threshold (`ANIM_DELTA_THRESHOLD`) → boolean mask.
      4. Morphological opening (PIL MinFilter then MaxFilter, kernel
         `ANIM_OPENING_KERNEL`) — drops blobs smaller than the kernel
         while preserving the prop-sized regions we care about.
      5. Treat as None if the surviving bbox covers more than
         `ANIM_MAX_BBOX_FRACTION` of the frame — the edit is effectively
         whole-scene and a fall animation would look silly.

    ML alternatives we considered: LPIPS yields a single perceptual
    distance scalar (no per-pixel localisation), and SAM-style
    segmentation would pinpoint the new object but adds a heavyweight
    model load. The pure-CPU pipeline above runs in ~tens of ms on a
    1280x720 frame and avoids loading anything new."""
    original_f = original.astype(np.float32)
    edited_f = edited.astype(np.float32)
    luma_weights = np.array([0.299, 0.587, 0.114], dtype=np.float32)
    diff = np.sqrt((((original_f - edited_f) ** 2) * luma_weights).sum(axis=2))

    diff_pil = Image.fromarray(np.clip(diff, 0, 255).astype(np.uint8), mode="L")
    blurred = diff_pil.filter(ImageFilter.GaussianBlur(radius=ANIM_BLUR_RADIUS))
    raw_mask = np.array(blurred) > ANIM_DELTA_THRESHOLD
    mask_pil = Image.fromarray(raw_mask.astype(np.uint8) * 255, mode="L")
    opened = mask_pil.filter(ImageFilter.MinFilter(ANIM_OPENING_KERNEL)).filter(
        ImageFilter.MaxFilter(ANIM_OPENING_KERNEL)
    )
    mask = np.array(opened) > 128

    if not mask.any():
        return None

    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    y0, y1 = int(rows[0]), int(rows[-1]) + 1
    x0, x1 = int(cols[0]), int(cols[-1]) + 1
    h, w = original.shape[:2]
    if (y1 - y0) * (x1 - x0) > ANIM_MAX_BBOX_FRACTION * h * w:
        return None
    return (y0, x0, y1, x1)


def _ease_out_cubic(t: float) -> float:
    return 1.0 - (1.0 - t) ** 3


def _generate_fall_animation(
    original: np.ndarray,
    edited: np.ndarray,
    bbox: tuple[int, int, int, int],
    fall_frames: int,
    hold_frames: int,
) -> list[np.ndarray]:
    """Tween frames where the edited bbox region drops from above the frame
    onto its final position via ease-out-cubic, then locks the fully-edited
    frame for `hold_frames`. During the fall, areas outside the bbox come
    from `original`; on landing we switch to `edited` so any out-of-bbox
    side-effects (shadows, lighting tweaks) appear together with the prop."""
    y0, x0, y1, x1 = bbox
    bbox_h = y1 - y0
    region = edited[y0:y1, x0:x1, :]
    frame_h = original.shape[0]

    frames: list[np.ndarray] = []
    for i in range(fall_frames):
        t = (i + 1) / fall_frames
        eased = _ease_out_cubic(t)
        # Map eased ∈ [0, 1] to top-of-region position ∈ [-bbox_h, y0].
        top_y = round(-bbox_h + eased * (y0 + bbox_h))
        canvas = original.copy()
        # Clip the region against the canvas so partial off-screen pastes work.
        src_y0 = max(0, -top_y)
        src_y1 = min(bbox_h, frame_h - top_y)
        if src_y1 > src_y0:
            dst_y0 = top_y + src_y0
            dst_y1 = top_y + src_y1
            canvas[dst_y0:dst_y1, x0:x1, :] = region[src_y0:src_y1, :, :]
        frames.append(canvas)

    landed = edited.copy()
    frames.extend([landed] * hold_frames)
    return frames


def _np_to_seed_tensor(frame: np.ndarray) -> torch.Tensor:
    """uint8 numpy HxWxC → uint8 device tensor on SCENE_AUTHORING_DEVICE,
    laid out the way the engine expects edited frames to be."""
    return torch.from_numpy(frame).to(dtype=torch.uint8, device=SCENE_AUTHORING_DEVICE).contiguous()


def _apply_edit(
    world_engine: "WorldEngineManager",
    scene_authoring: "SceneAuthoringManager",
    original_np: np.ndarray,
    edited_np: np.ndarray,
    edited_tensor: torch.Tensor,
    mode: SceneEditMode,
    video_prompt: str | None,
) -> list[np.ndarray]:
    """Apply an edit to the engine per `mode` and return the visible tween
    frames (numpy uint8 HxWx3, in playback order). Modes:

      - "reset": reseed the engine with `edited_tensor`. Empty tween list.
      - "fall": diff old vs edited, animate the changed bbox falling in,
        append every tween to the engine so prior KV context survives.
      - "video": render an FLF transition video from `original_np` to
        `edited_np` using `video_prompt`, append every frame to the
        engine. Falls back to "fall" if `video_prompt` is None (e.g. a
        prop without a manifest entry). Triggers `ensure({TI2V})` which
        may LRU-evict VLM / TI2I.

    "video" mode is the longest path (~tens of seconds for inference);
    "reset" is fastest but most disruptive to model context; "fall"
    sits between."""
    if mode == "reset":
        world_engine.set_seed_and_reset(edited_tensor)
        return []

    if mode == "video" and video_prompt is not None:
        # Optionally rewrite the manifest prompt with a fresh VLM-authored
        # one based on both pre- and post-edit frames. The VLM call
        # may evict TI2V via LRU (4+7+8 > 15 GB budget); the subsequent
        # `ensure({"ti2v"})` reloads it. With VIDEO_USE_VLM_PROMPT=False
        # the warmup-loaded TI2V stays hot across spawns — recommended
        # for the iteration loop.
        if VIDEO_USE_VLM_PROMPT:
            scene_authoring.ensure({"vlm"})
            inference_prompt = scene_authoring.build_video_prompt(original_np, edited_np)
        else:
            inference_prompt = video_prompt
        # Non-exclusive ensure: with `ti2v` at ~8 GB it coexists with
        # Klein (7 GB) at exactly the 15 GB budget. The warmup leaves
        # us on `{ti2i, ti2v}`, so when the prompt path didn't need
        # VLM this is a no-op and the spawn flow runs with zero swap
        # overhead.
        scene_authoring.ensure({"ti2v"})
        transition = scene_authoring.generate_flf(
            original_np, edited_np, inference_prompt, world_engine.seed_target_size
        )
        if not transition:
            return []
        # Sharp hold at native resolution: `edited_np` is the Klein
        # output at seed-target resolution, so swapping in
        # `VIDEO_HOLD_FRAMES` copies of it both gives the WM time to
        # settle on the new state in its KV cache and ensures the last
        # frames the user sees are at the WM's native sharpness.
        frames = transition + [edited_np] * VIDEO_HOLD_FRAMES
        tensors = [_np_to_seed_tensor(f) for f in frames]
        world_engine.append_frames_sequence(tensors)
        return frames

    if mode == "video":
        logger.info("Video mode requested without prompt; falling back to fall animation")

    bbox = _compute_edit_bbox(original_np, edited_np)
    if bbox is None:
        world_engine.append_frame_repeatedly(edited_tensor, ANIM_FALLBACK_APPEND_COUNT)
        return []

    frames = _generate_fall_animation(original_np, edited_np, bbox, ANIM_FALL_FRAMES, ANIM_HOLD_FRAMES)
    tensors = [_np_to_seed_tensor(f) for f in frames]
    world_engine.append_frames_sequence(tensors)
    return frames


# ─── Free orchestration functions (called from the generator thread) ──


def run_scene_edit(
    engines: "Engines",
    user_request: str,
    cpu_frames: list,
    *,
    direct: bool = False,
    video_prompt: str | None = None,
) -> tuple[SceneEditResponseData, list[np.ndarray]]:
    """Run inpainting on the last subframe and apply the result to the engine.

    Takes the last subframe from the most recent gen_frame output, asks the
    VLM + Klein to inpaint it (or skips the VLM when `direct` is True and
    sends `user_request` to Klein verbatim), safety-checks the result, then
    applies it via the per-class mode (`SCENE_EDIT_PROMPTED_MODE` /
    `SCENE_EDIT_DIRECT_MODE`). Returns the preview data for the RPC plus
    any tween frames (empty for "reset" mode, populated for "fall" or
    "video") that the caller should stream out paced.

    `video_prompt` is the motion description forwarded to the video
    model when the edit's mode is `video`. When None (typed prompts),
    falls back to `edit_prompt` — the Klein prompt itself. For env
    presets the client should pass a transition-oriented prompt
    distinct from the detailed static-end-state Klein prompt."""
    world_engine = engines.world_engine
    scene_authoring = engines.scene_authoring
    safety_checker = engines.safety_checker

    last_frame_np = cpu_frames[-1]

    # Encode original for client-side preview
    original_jpeg = world_engine.numpy_to_jpeg(last_frame_np)
    original_b64 = base64.b64encode(original_jpeg).decode("ascii")

    inpainted, edit_prompt = scene_authoring.inpaint(
        last_frame_np, user_request, world_engine.seed_target_size, direct=direct
    )

    # Encode inpainted for client-side preview
    inpainted_np = world_engine.tensor_to_numpy(inpainted)
    preview_jpeg = world_engine.numpy_to_jpeg(inpainted_np)
    preview_b64 = base64.b64encode(preview_jpeg).decode("ascii")

    inpainted_pil = Image.fromarray(inpainted_np)
    verdict = safety_checker.check_pil_image(inpainted_pil)
    if not verdict.is_safe:
        logger.warning("Safety checker rejected inpainted image", operation="scene_edit", scores=verdict.scores)
        raise SafetyRejectionError()

    mode: SceneEditMode = SCENE_EDIT_DIRECT_MODE if direct else SCENE_EDIT_PROMPTED_MODE
    # Use the explicit video_prompt when supplied (env presets carry
    # motion-oriented prompts distinct from the detailed Klein prompt);
    # otherwise fall back to the Klein prompt for typed user input.
    effective_video_prompt = video_prompt if video_prompt is not None else edit_prompt
    tween_frames = _apply_edit(
        world_engine, scene_authoring, last_frame_np, inpainted_np, inpainted, mode, effective_video_prompt
    )

    return (
        SceneEditResponseData(
            original_jpeg_b64=original_b64,
            preview_jpeg_b64=preview_b64,
            edit_prompt=edit_prompt,
        ),
        tween_frames,
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

    generated, sanitized_prompt = scene_authoring.generate(user_request, world_engine.seed_target_size)

    # Safety check on the generated image
    generated_np = world_engine.tensor_to_numpy(generated)
    generated_pil = Image.fromarray(generated_np)
    verdict = safety_checker.check_pil_image(generated_pil)
    if not verdict.is_safe:
        logger.warning("Safety checker rejected generated image", operation="generate_scene", scores=verdict.scores)
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
    logger.info("Generate scene complete", operation="generate_scene", elapsed_ms=round(elapsed_ms))
    return GenerateSceneResponseData(
        elapsed_ms=round(elapsed_ms),
        image_jpeg_base64=image_b64,
        user_prompt=user_request,
        sanitized_prompt=sanitized_prompt,
        image_model=EDIT_MODEL_ID,
    )


def _flatten_to_white(image: Image.Image) -> Image.Image:
    """Composite an RGBA prop reference (alpha-cut PNG from the gallery)
    onto a clean white background. Klein's image processor would otherwise
    just drop the alpha channel and expose whatever near-white pixels
    sit beneath the mask, defeating the rembg cleanup."""
    if image.mode != "RGBA":
        return image.convert("RGB")
    bg = Image.new("RGB", image.size, (255, 255, 255))
    bg.paste(image, mask=image.split()[3])
    return bg


def _flatten_and_letterbox(reference: Image.Image, target_h: int, target_w: int) -> Image.Image:
    """Flatten the reference onto white and letterbox it onto a white
    target_w-by-target_h canvas (uniform scale, centred). Used so the
    multi-image Klein edit receives a reference with the same aspect
    as the scene -- a non-uniform resize here is what causes the
    horizontal-stretch artefacts on spawned props."""
    flat = _flatten_to_white(reference)
    src_w, src_h = flat.size
    scale = min(target_w / src_w, target_h / src_h)
    new_w = max(1, round(src_w * scale))
    new_h = max(1, round(src_h * scale))
    scaled = flat.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (target_w, target_h), (255, 255, 255))
    canvas.paste(scaled, ((target_w - new_w) // 2, (target_h - new_h) // 2))
    return canvas


def _build_prop_edit_prompt(kind: str, target: str, subject: str) -> str:
    """Construct a deterministic edit instruction for the multi-image
    prop edit. The reference image is always the second of two; we
    instruct the model to integrate it into the scene (the first)."""
    if kind == "holdable":
        return (
            f"Remove any item currently held in the player's hands and "
            f"replace it with the {subject} from the second image. The "
            f"{subject} must occupy the same lower-right grip space as "
            f"the previously held item -- nothing else should remain in "
            f"the player's hands. Show the {subject} in first-person "
            f"held viewmodel pose, gripped by the player's right hand "
            f"entering from the lower-right of the frame. If the hands "
            f"were already empty, simply add the {subject} in this held "
            f"pose. Match scene lighting and perspective. Keep the "
            f"background scene (everything other than the held item) "
            f"unchanged."
        )
    if target == "appropriate":
        return (
            f"Add the {subject} from the second image into this scene. "
            f"Place it at a natural, plausible location somewhere in the "
            f"visible scene — on a sensible surface or floor. Integrate "
            f"it with matching lighting and perspective. Keep the rest "
            f"of the scene unchanged."
        )
    return (
        f"Add the {subject} from the second image into this scene. "
        f"Place it at the centre of the camera's view, directly in "
        f"front of the player, on a sensible surface or floor. "
        f"Integrate it with matching lighting and perspective. Keep "
        f"the rest of the scene unchanged."
    )


def run_scene_prop_edit(
    engines: "Engines",
    *,
    reference_jpeg_b64: str,
    kind: str,
    target: str,
    subject: str,
    video_prompt: str | None,
    cpu_frames: list,
) -> tuple[ScenePropEditResponseData, list[np.ndarray]]:
    """Run a tile-driven prop edit on the last subframe and apply the
    result to the engine. Bypasses the VLM (the edit instruction is
    built deterministically from `kind` / `target` / `subject`); feeds
    Klein both the scene and the decoded reference image. Mode is selected
    per-`kind` (`PROP_EDIT_SPAWNABLE_MODE` / `PROP_EDIT_HOLDABLE_MODE`).
    `video_prompt` is forwarded to the video model when mode == "video".
    Returns the RPC preview plus tween frames the caller should stream."""
    world_engine = engines.world_engine
    scene_authoring = engines.scene_authoring
    safety_checker = engines.safety_checker

    last_frame_np = cpu_frames[-1]

    # Encode original for client-side preview
    original_jpeg = world_engine.numpy_to_jpeg(last_frame_np)
    original_b64 = base64.b64encode(original_jpeg).decode("ascii")

    # Decode the reference jpeg the renderer uploaded.
    reference_pil = Image.open(io.BytesIO(base64.b64decode(reference_jpeg_b64)))

    inpainted, _prompt = scene_authoring.inpaint_with_prop(
        frame_numpy=last_frame_np,
        reference=reference_pil,
        kind=kind,
        target=target,
        subject=subject,
        seed_target_size=world_engine.seed_target_size,
    )

    inpainted_np = world_engine.tensor_to_numpy(inpainted)
    preview_jpeg = world_engine.numpy_to_jpeg(inpainted_np)
    preview_b64 = base64.b64encode(preview_jpeg).decode("ascii")

    inpainted_pil = Image.fromarray(inpainted_np)
    verdict = safety_checker.check_pil_image(inpainted_pil)
    if not verdict.is_safe:
        logger.warning(
            "Safety checker rejected prop-edit result",
            operation="scene_prop_edit",
            scores=verdict.scores,
        )
        raise SafetyRejectionError()

    mode: SceneEditMode = PROP_EDIT_SPAWNABLE_MODE if kind == "spawnable" else PROP_EDIT_HOLDABLE_MODE
    tween_frames = _apply_edit(
        world_engine, scene_authoring, last_frame_np, inpainted_np, inpainted, mode, video_prompt
    )

    return (
        ScenePropEditResponseData(
            original_jpeg_b64=original_b64,
            preview_jpeg_b64=preview_b64,
        ),
        tween_frames,
    )
