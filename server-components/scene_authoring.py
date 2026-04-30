"""
Scene authoring orchestration: scene_edit and generate_scene flows.

Both functions run on the per-session generator thread (synchronous,
called between gen_frame calls), reach into the WorldEngineManager and
ImageGenManager via the AppState handle they're given, hand off the
GPU-side mutation through the CUDA executor, and return typed Pydantic
response data ready for `rpc_ok(...)`.

The function-scoped `from image_gen import ...` is intentional — it
keeps the diffusers/llama_cpp/transformers import graph out of this
module's load-time so importing scene_authoring from `server.py` is light.
The heavy import waterfall lives in `main.py`.

This module is strict-typed by construction — none of the legacy ignore
rules in pyproject.toml fire on this code. Keep it that way.
"""

import base64
import io
import logging
import time

from PIL import Image

from app_state import AppState
from protocol import GenerateSceneResponseData, SceneEditResponseData

logger = logging.getLogger(__name__)


def run_generate_scene(
    state: AppState,
    prompt: str,
    biome_version: str | None,
) -> GenerateSceneResponseData:
    """Generate a new scene from a text prompt and load it as the current seed.

    Uses the inpainting pipeline with a blank canvas so the VLM can
    sanitise the prompt.  Returns the generated image (base64 JPEG)
    plus metadata (user prompt, sanitised prompt, model id) so the
    client can persist it if Scene Authoring auto-save is enabled.
    Unlike scene_edit, this is a new world — `original_seed_frame`
    is updated so a subsequent reset returns to the generated scene,
    not the previous seed.
    """
    from image_gen import (
        EDIT_MODEL_ID,
        GENERATE_SCENE_SAFETY_MESSAGE_ID,
        GeneratedSceneProperties,
        SafetyRejectionError,
        properties_to_jpeg_comment,
    )

    assert state.world_engine is not None
    assert state.image_gen is not None
    assert state.safety_checker is not None
    world_engine = state.world_engine
    image_gen = state.image_gen
    safety_checker = state.safety_checker

    t0 = time.perf_counter()

    generated, sanitized_prompt = image_gen._generate_scene_sync(prompt, world_engine.seed_target_size)

    # Safety check on the generated image
    generated_np = world_engine._tensor_to_numpy(generated)
    generated_pil = Image.fromarray(generated_np)
    safety_result = safety_checker.check_pil_image(generated_pil)
    if not safety_result["is_safe"]:
        logger.warning(f"[GENERATE_SCENE] Safety checker rejected generated image: {safety_result['scores']}")
        raise SafetyRejectionError(GENERATE_SCENE_SAFETY_MESSAGE_ID)

    # Encode the generated image as JPEG so the client can save it to disk.
    # Done before expanding to multiframe so we encode a single HxWx3 frame.
    # Metadata is embedded via a JPEG COM-marker JSON blob — parallel to how
    # video_recorder.py stuffs RecordingProperties into the MP4 comment atom.
    properties = GeneratedSceneProperties(
        biome_version=biome_version or "unknown",
        image_model=EDIT_MODEL_ID,
        user_prompt=prompt,
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

    # Expand to full temporal_compression for multiframe models
    if world_engine.is_multiframe:
        generated = generated.unsqueeze(0).expand(world_engine.temporal_compression, -1, -1, -1).contiguous()

    # Reset engine with the generated frame as the new seed.
    world_engine.seed_frame = generated
    world_engine.original_seed_frame = generated

    def _reset_with_frame():
        world_engine.engine.reset()
        world_engine.engine.append_frame(generated)

    world_engine.cuda_executor.submit(_reset_with_frame).result()

    elapsed_ms = (time.perf_counter() - t0) * 1000
    logger.info(f"[GENERATE_SCENE] Complete in {elapsed_ms:.0f}ms")
    return GenerateSceneResponseData(
        elapsed_ms=round(elapsed_ms),
        image_jpeg_base64=image_b64,
        user_prompt=prompt,
        sanitized_prompt=sanitized_prompt,
        image_model=EDIT_MODEL_ID,
    )


def run_scene_edit(
    state: AppState,
    prompt: str,
    cpu_frames: list,
) -> SceneEditResponseData:
    """Run inpainting on the last subframe and append the result.

    Takes the last subframe from the most recent gen_frame output,
    inpaints it, expands to a full temporal_compression tensor, submits
    append_frame to the CUDA executor (required for CUDA graph
    compatibility), and returns preview data for the RPC response.
    """
    from image_gen import (
        EDIT_APPEND_COUNT as SCENE_EDIT_APPEND_COUNT,
    )
    from image_gen import (
        EDIT_RESET_WITH_FRAME as SCENE_EDIT_RESET,
    )
    from image_gen import (
        SafetyRejectionError,
    )

    assert state.world_engine is not None
    assert state.image_gen is not None
    assert state.safety_checker is not None
    world_engine = state.world_engine
    image_gen = state.image_gen
    safety_checker = state.safety_checker

    last_frame_np = cpu_frames[-1]

    # Encode original for debug preview
    original_jpeg = world_engine._numpy_to_jpeg(last_frame_np)
    original_b64 = base64.b64encode(original_jpeg).decode("ascii")

    # Run inpainting (diffusers pipeline, not CUDA-graph dependent)
    inpainted, edit_prompt = image_gen._inpaint_sync(last_frame_np, prompt, world_engine.seed_target_size)

    # Encode inpainted for debug preview
    inpainted_np = world_engine._tensor_to_numpy(inpainted)
    preview_jpeg = world_engine._numpy_to_jpeg(inpainted_np)
    preview_b64 = base64.b64encode(preview_jpeg).decode("ascii")

    # Safety check on the inpainted result
    inpainted_pil = Image.fromarray(inpainted_np)
    safety_result = safety_checker.check_pil_image(inpainted_pil)
    if not safety_result["is_safe"]:
        logger.warning(f"[SCENE_EDIT] Safety checker rejected inpainted image: {safety_result['scores']}")
        raise SafetyRejectionError()

    # Expand to full temporal_compression for multiframe models
    if world_engine.is_multiframe:
        inpainted = inpainted.unsqueeze(0).expand(world_engine.temporal_compression, -1, -1, -1).contiguous()

    # Apply the edited frame to the engine on the CUDA executor thread.
    if SCENE_EDIT_RESET:
        # Reset engine with the edited frame as the new seed
        world_engine.seed_frame = inpainted

        def _reset_with_frame():
            world_engine.engine.reset()
            world_engine.engine.append_frame(inpainted)

        world_engine.cuda_executor.submit(_reset_with_frame).result()
    else:
        # Append repeatedly to strengthen the edit in the KV cache
        def _append_repeated(f=inpainted):
            for _ in range(SCENE_EDIT_APPEND_COUNT):
                world_engine.engine.append_frame(f)

        world_engine.cuda_executor.submit(_append_repeated).result()

    return SceneEditResponseData(
        original_jpeg_b64=original_b64,
        preview_jpeg_b64=preview_b64,
        edit_prompt=edit_prompt,
    )
