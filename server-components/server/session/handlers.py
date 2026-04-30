"""
Typed message handlers + session-phase orchestration for the WebSocket protocol.

Each handler takes the values it needs explicitly (Connection + engine
refs) and returns / produces typed Pydantic models. Stateless dispatchers
— they read/write `conn.X` and call into the engine via the explicitly
passed handles, but own no per-handler state.

`run_receiver` (in `workers.py`) dispatches inbound game-loop messages
to the per-message handlers. `run_preinit_handshake` dispatches the
pre-init message loop directly. `prepare_session` runs the warmup +
init phase between handshake and game loop. These let the route shell
(`server/routes.py`) stay a thin protocol layer.

This module is strict-typed by construction — none of the legacy ignore
rules in pyproject.toml fire on this code. Keep it that way.
"""

import asyncio
import base64
import logging
from typing import TYPE_CHECKING

from recording.action_logger import ActionLogger
from server.protocol import (
    CheckSeedSafetyRequest,
    CheckSeedSafetyResponseData,
    ClientMessage,
    ClientMessageAdapter,
    ControlNotif,
    GenerateSceneRequest,
    InitRequest,
    InitResponseData,
    MessageId,
    PauseNotif,
    PromptNotif,
    ResetNotif,
    ResumeNotif,
    RpcError,
    RpcSuccess,
    SceneEditRequest,
    StageId,
    SystemInfo,
    rpc_err,
    rpc_ok,
)
from server.session.connection import Connection, build_error_message

if TYPE_CHECKING:
    from engine.image_gen import ImageGenManager
    from engine.manager import WorldEngineManager
    from engine.safety import SafetyChecker

logger = logging.getLogger(__name__)


def build_init_response_data(world_engine: "WorldEngineManager", system_info: SystemInfo) -> InitResponseData:
    """Pack post-warmup session metrics into the typed init RPC response."""
    return InitResponseData(
        model=world_engine.model_uri or "",
        inference_fps=world_engine.inference_fps,
        system_info=system_info,
    )


async def handle_check_seed_safety(
    safety_checker: "SafetyChecker",
    req: CheckSeedSafetyRequest,
) -> RpcSuccess[CheckSeedSafetyResponseData] | RpcError:
    """Check whether a seed image passes the NSFW classifier. Cache lookup +
    persistence are owned by `SafetyChecker.check_image_bytes`."""
    if not req.image_data:
        return rpc_err(req.req_id, error=MessageId.SEED_MISSING_DATA.value)

    try:
        image_bytes = base64.b64decode(req.image_data)
    except Exception as e:
        return rpc_err(req.req_id, error=f"Invalid base64 data: {e}")

    try:
        result = await asyncio.to_thread(safety_checker.check_image_bytes, image_bytes)
    except Exception as e:
        logger.error(f"Safety check failed: {e}")
        return rpc_err(req.req_id, error=f"Safety check failed: {e}")

    return rpc_ok(req.req_id, CheckSeedSafetyResponseData(is_safe=result.is_safe, hash=result.image_hash))


async def load_seed_from_data(
    conn: Connection,
    world_engine: "WorldEngineManager",
    safety_checker: "SafetyChecker",
    image_data_b64: str | None,
    seed_filename: str | None = None,
) -> bool:
    """Validate safety and load a seed from base64 image data.

    Returns True iff the seed was loaded (or already loaded and matched).
    Failure paths surface a typed warning over the websocket and return False.
    """
    if not image_data_b64:
        logger.warning(f"[{conn.client_host}] Missing seed image data")
        await conn.send_warning(MessageId.SEED_MISSING_DATA)
        return False

    try:
        image_bytes = base64.b64decode(image_data_b64)
    except Exception as e:
        logger.warning(f"[{conn.client_host}] Invalid base64 seed data: {e}")
        await conn.send_warning(MessageId.SEED_INVALID_DATA)
        return False

    # Safety check (cache lookup is internal to SafetyChecker; same-hash repeat
    # is a fast cache hit, so we don't pre-screen against `current_seed_hash`).
    try:
        result = await asyncio.to_thread(safety_checker.check_image_bytes, image_bytes)
    except Exception as e:
        logger.warning(f"[{conn.client_host}] Safety check failed: {e}")
        await conn.send_warning(MessageId.SEED_SAFETY_CHECK_FAILED)
        return False

    img_hash = result.image_hash

    # Same seed already loaded onto the engine? Skip the redundant reload.
    if img_hash == conn.current_seed_hash:
        logger.info(f"[{conn.client_host}] Seed unchanged (hash match), skipping reload")
        return True

    if not result.is_safe:
        logger.warning(f"[{conn.client_host}] Seed marked as unsafe")
        await conn.send_warning(MessageId.SEED_UNSAFE)
        return False

    # Load the seed onto the engine
    display_name = seed_filename or img_hash[:12]
    logger.info(f"[{conn.client_host}] Loading seed '{display_name}'")
    loaded_frame = await world_engine.load_seed_from_base64(image_data_b64)
    if loaded_frame is None:
        logger.error(f"[{conn.client_host}] Failed to load seed")
        await conn.send_warning(MessageId.SEED_LOAD_FAILED)
        return False

    world_engine.seed_frame = loaded_frame
    world_engine.original_seed_frame = loaded_frame
    conn.current_seed_hash = img_hash
    conn.current_seed_filename = seed_filename
    logger.info(f"[{conn.client_host}] Seed loaded successfully")
    return True


async def handle_init(
    conn: Connection,
    world_engine: "WorldEngineManager",
    safety_checker: "SafetyChecker",
    req: InitRequest,
    *,
    is_game_loop: bool = False,
) -> tuple[bool, bool]:
    """Apply an InitRequest's deltas to the connection / engine.

    Returns `(ready, seed_loaded)`: `ready` means the session has a
    seed frame and can begin generating; `seed_loaded` means a fresh
    seed was applied in this call.

    `model_fields_set` distinguishes "field absent" from "field present
    and explicitly None", so partial updates (`{"action_logging": false}`
    while leaving everything else untouched) work as the renderer expects.
    """
    present = req.model_fields_set
    model_uri = (req.model or "").strip()
    seed_data = req.seed_image_data
    seed_filename = req.seed_filename
    quant = req.quant

    # Update flags
    if "scene_authoring" in present and req.scene_authoring is not None:
        conn.scene_authoring_requested = req.scene_authoring
    if "action_logging" in present and req.action_logging is not None:
        conn.action_logging_requested = req.action_logging
    if "video_recording" in present and req.video_recording is not None:
        conn.video_recording_requested = req.video_recording
    if "video_output_dir" in present:
        conn.video_output_dir = req.video_output_dir
    if "biome_version" in present:
        conn.biome_version = req.biome_version
    if "cap_inference_fps" in present and req.cap_inference_fps is not None:
        conn.cap_inference_fps = req.cap_inference_fps

    # Sync recorder lifecycle with requested state during gameplay
    if is_game_loop:
        if conn.action_logging_requested and conn.action_logger is None:
            conn.action_logger = ActionLogger(conn.client_host)
            conn.start_action_log_segment(world_engine)
            logger.info(f"[{conn.client_host}] Action logging enabled")
        elif not conn.action_logging_requested and conn.action_logger is not None:
            conn.action_logger.end_segment()
            conn.action_logger = None
            logger.info(f"[{conn.client_host}] Action logging disabled")

        if conn.video_recording_requested and conn.video_recorder is None:
            conn.start_video_segment(world_engine)
            logger.info(f"[{conn.client_host}] Video recording enabled")
        elif not conn.video_recording_requested and conn.video_recorder is not None:
            conn.video_recorder.end_segment()
            conn.video_recorder = None
            logger.info(f"[{conn.client_host}] Video recording disabled")

    # Model delta — reload if model URI or quantization changed.
    # The engine must be loaded before the seed so that seed_target_size
    # and temporal_compression are resolved from the actual model config.
    model_changed = False
    quant_changed = "quant" in present and quant != world_engine.quant
    if model_uri and (model_uri != world_engine.model_uri or quant_changed):
        verb = "Live model switch" if is_game_loop else "Requested model"
        logger.info(f"[{conn.client_host}] {verb}: {model_uri} (quant={quant})")
        world_engine.set_progress_callback(conn.push_progress, conn.main_loop)
        await world_engine.load_engine(model_uri, quant=quant)
        world_engine.set_progress_callback(None)
        world_engine.seed_frame = None
        conn.perceptual_frame_count = 0
        conn.max_perceptual_frames = (world_engine.n_frames - 2) * world_engine.temporal_compression
        model_changed = True
        logger.info(f"[{conn.client_host}] Model loaded: {world_engine.model_uri}")

    # Seed delta
    seed_loaded = False
    if seed_data:
        seed_loaded = await load_seed_from_data(conn, world_engine, safety_checker, seed_data, seed_filename)

    if model_changed and not seed_loaded and not world_engine.seed_frame:
        await conn.send_stage(StageId.SESSION_WAITING_FOR_SEED)

    ready = seed_loaded or (world_engine.seed_frame is not None)
    return ready, seed_loaded


async def run_preinit_handshake(
    conn: Connection,
    world_engine: "WorldEngineManager",
    safety_checker: "SafetyChecker",
) -> bool:
    """Drive the pre-init message loop until the client's InitRequest
    yields a loaded seed frame, or 60 s elapses without one.

    Returns True iff a seed is now loaded. Authoring RPCs and gameplay
    notifications received during this phase are explicitly rejected /
    ignored. On timeout, surfaces `MessageId.TIMEOUT_WAITING_FOR_SEED`
    and returns False."""
    await conn.send_stage(StageId.SESSION_WAITING_FOR_SEED)
    logger.info(f"[{conn.client_host}] Waiting for init message...")

    while world_engine.seed_frame is None:
        try:
            raw = await asyncio.wait_for(conn.websocket.receive_text(), timeout=60.0)
        except TimeoutError:
            logger.error(f"[{conn.client_host}] Timeout waiting for init")
            await conn.send_message(build_error_message(message_id=MessageId.TIMEOUT_WAITING_FOR_SEED))
            return False

        try:
            parsed: ClientMessage = ClientMessageAdapter.validate_json(raw)
        except Exception as e:
            logger.info(f"[{conn.client_host}] Ignoring invalid message during pre-init: {e}")
            continue

        match parsed:
            case CheckSeedSafetyRequest() as req:
                result = await handle_check_seed_safety(safety_checker, req)
                await conn.websocket.send_text(result.model_dump_json(exclude_none=True))
            case InitRequest() as req:
                # init RPC: response is deferred until after warmup/session init completes
                conn.init_req_id = req.req_id
                ready, _ = await handle_init(conn, world_engine, safety_checker, req)
                if not ready:
                    await conn.websocket.send_text(
                        rpc_err(conn.init_req_id, error_id=MessageId.INIT_FAILED).model_dump_json(exclude_none=True)
                    )
                    conn.init_req_id = None
            case SceneEditRequest() | GenerateSceneRequest():
                await conn.websocket.send_text(
                    rpc_err(parsed.req_id, error_id=MessageId.INIT_FAILED).model_dump_json(exclude_none=True)
                )
            case ControlNotif() | PauseNotif() | ResumeNotif() | ResetNotif() | PromptNotif():
                logger.info(f"[{conn.client_host}] Ignoring notification '{parsed.type}' while waiting for init")

    return True


async def prepare_session(
    conn: Connection,
    world_engine: "WorldEngineManager",
    image_gen: "ImageGenManager",
) -> bool:
    """Run the post-handshake preparation phase: scene-authoring model
    load/unload, engine warmup, session init, initial frame.

    Returns True iff the session is ready to enter the game loop. On
    failure, surfaces the appropriate typed error + acks the deferred
    init RPC with the matching `MessageId`. The progress callback is
    wired only for the duration of this function."""
    from engine.manager import QuantUnsupportedError

    world_engine.set_progress_callback(conn.push_progress, conn.main_loop)
    try:
        if world_engine.seed_frame is None:
            # Race: client disconnected/reconnected mid-handshake; bail cleanly.
            logger.info(
                f"[{conn.client_host}] Seed frame missing before initialization; "
                "client likely disconnected/reconnected during model switch"
            )
            if conn.init_req_id:
                await conn.send_message(rpc_err(conn.init_req_id, error_id=MessageId.INIT_FAILED))
            return False

        # Scene-authoring: bring the image_gen state in line with what
        # this session needs. Loading happens BEFORE WorldEngine warmup
        # so the CUDA graphs see the model's memory already allocated.
        try:
            loaded = await image_gen.configure_for_session(conn.scene_authoring_requested)
        except Exception as e:
            logger.error(f"[{conn.client_host}] Scene authoring warmup failed: {e}", exc_info=True)
            await conn.send_message(
                build_error_message(message_id=MessageId.SCENE_AUTHORING_MODEL_LOAD_FAILED, message=str(e))
            )
            if conn.init_req_id:
                await conn.send_message(rpc_err(conn.init_req_id, error_id=MessageId.SCENE_AUTHORING_MODEL_LOAD_FAILED))
            return False
        if loaded:
            await conn.send_stage(StageId.SESSION_INPAINTING_LOAD)
            await conn.send_stage(StageId.SESSION_INPAINTING_READY)

        # Engine warmup (first connection only). Quantization-not-supported
        # is mapped from a raw torch error to a typed exception inside
        # `WorldEngineManager.warmup`, so this catch site stays clean.
        if not world_engine.engine_warmed_up:
            try:
                await world_engine.warmup()
            except QuantUnsupportedError:
                await conn.send_message(
                    build_error_message(
                        message_id=MessageId.QUANT_UNSUPPORTED_GPU,
                        params={"quant": world_engine.quant or "unknown"},
                    )
                )
                return False

        await asyncio.to_thread(world_engine.init_session)
        await conn.send_initial_frame(world_engine)
    finally:
        world_engine.set_progress_callback(None)

    return True
