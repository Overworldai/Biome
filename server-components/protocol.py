"""
Wire protocol for the Biome WebSocket.

Every message that crosses the WS — both directions — is modelled as a
Pydantic discriminated union here.  Parsing happens once at the WS edge:

    msg = ClientMessageAdapter.validate_json(raw)
    match msg:
        case InitRequest():    ...
        case ControlNotif():   ...
        ...

After that, downstream handlers receive typed values; no `dict.get(...)`
or `msg["type"]` access anywhere below this module.

Naming convention: requests/notifications inbound from the client are
suffixed `Request` / `Notif`; outbound server pushes are suffixed
`Message`.  The discriminator field is always `type: Literal["..."]`.

This module is strict-typed by construction — none of the legacy ignore
rules in pyproject.toml fire on this code.  Keep it that way.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

# ──────────────────────────────────────────────────────────────────────
# Translation keys for server-originated error/warning push messages.
# Values are the full i18n key path the renderer resolves via t().
# ──────────────────────────────────────────────────────────────────────


class MessageId(StrEnum):
    # ── Errors ────────────────────────────────────────────────────────
    SERVER_STARTUP_FAILED = "app.server.error.serverStartupFailed"
    TIMEOUT_WAITING_FOR_SEED = "app.server.error.timeoutWaitingForSeed"
    INIT_FAILED = "app.server.error.initFailed"
    QUANT_UNSUPPORTED_GPU = "app.server.error.quantUnsupportedGpu"
    SCENE_AUTHORING_MODEL_LOAD_FAILED = "app.server.error.sceneAuthoringModelLoadFailed"
    SCENE_AUTHORING_EMPTY_PROMPT = "app.server.error.sceneAuthoringEmptyPrompt"
    SCENE_AUTHORING_MODEL_NOT_LOADED = "app.server.error.sceneAuthoringModelNotLoaded"
    SCENE_AUTHORING_ALREADY_IN_PROGRESS = "app.server.error.sceneAuthoringAlreadyInProgress"
    SCENE_EDIT_SAFETY_REJECTED = "app.server.error.sceneEditSafetyRejected"
    GENERATE_SCENE_SAFETY_REJECTED = "app.server.error.generateSceneSafetyRejected"
    CUDA_RECOVERY_FAILED = "app.server.error.cudaRecoveryFailed"

    # ── Warnings ──────────────────────────────────────────────────────
    SEED_MISSING_DATA = "app.server.warning.missingSeedData"
    SEED_INVALID_DATA = "app.server.warning.invalidSeedData"
    SEED_UNSAFE = "app.server.warning.seedUnsafe"
    SEED_SAFETY_CHECK_FAILED = "app.server.warning.seedSafetyCheckFailed"
    SEED_LOAD_FAILED = "app.server.warning.seedLoadFailed"


# ──────────────────────────────────────────────────────────────────────
# Boundary value types — flow on the wire as part of larger messages.
# ──────────────────────────────────────────────────────────────────────


_FrozenStrict = ConfigDict(frozen=True, extra="forbid")
_FrozenLenient = ConfigDict(frozen=True, extra="ignore")


class SystemInfo(BaseModel):
    """Static hardware/runtime identity, snapshot once at startup."""

    model_config = _FrozenStrict

    cpu_name: str | None = None
    gpu_name: str | None = None
    vram_total_bytes: int | None = None
    cuda_version: str | None = None
    driver_version: str | None = None
    torch_version: str
    gpu_count: int = 0


class ErrorSnapshot(BaseModel):
    """Ephemeral state captured at the moment of an error push."""

    model_config = _FrozenStrict

    process_rss_bytes: int | None = None
    ram_used_bytes: int | None = None
    ram_total_bytes: int | None = None
    vram_used_bytes: int | None = None
    vram_reserved_bytes: int | None = None
    gpu_util_percent: int | None = None


# ──────────────────────────────────────────────────────────────────────
# Client → Server: notifications (fire-and-forget, no req_id).
#
# ControlNotif accepts both `buttons` (string names — what the renderer
# sends today) and `button_codes` (int codes — internal representation,
# unused on the wire but kept until step 7 deletes it).  Resolution
# happens in the receiver, not here, so this model stays a faithful
# mirror of the wire format.
# ──────────────────────────────────────────────────────────────────────


class ControlNotif(BaseModel):
    model_config = _FrozenLenient
    type: Literal["control"] = "control"
    buttons: list[str] | None = None
    button_codes: list[int] | None = None
    mouse_dx: float = 0.0
    mouse_dy: float = 0.0
    ts: float | None = None


class PauseNotif(BaseModel):
    model_config = _FrozenStrict
    type: Literal["pause"] = "pause"


class ResumeNotif(BaseModel):
    model_config = _FrozenStrict
    type: Literal["resume"] = "resume"


class ResetNotif(BaseModel):
    model_config = _FrozenStrict
    type: Literal["reset"] = "reset"


class PromptNotif(BaseModel):
    model_config = _FrozenStrict
    type: Literal["prompt"] = "prompt"
    prompt: str = ""


# ──────────────────────────────────────────────────────────────────────
# Client → Server: RPC requests (req_id required, expect a response).
#
# Init carries partial deltas: every flag is optional, and the receiver
# uses Pydantic's model_fields_set to distinguish "field absent" from
# "field present and explicitly None" — preserving the existing
# behaviour where `{"action_logging": false}` turns logging off but
# `{}` leaves it untouched.
# ──────────────────────────────────────────────────────────────────────


class InitRequest(BaseModel):
    model_config = _FrozenLenient
    type: Literal["init"] = "init"
    req_id: str
    model: str = ""
    seed_image_data: str | None = None
    seed_filename: str | None = None
    quant: str | None = None
    scene_authoring: bool | None = None
    action_logging: bool | None = None
    video_recording: bool | None = None
    video_output_dir: str | None = None
    biome_version: str | None = None
    cap_inference_fps: bool | None = None


class SceneEditRequest(BaseModel):
    model_config = _FrozenStrict
    type: Literal["scene_edit"] = "scene_edit"
    req_id: str
    prompt: str


class GenerateSceneRequest(BaseModel):
    model_config = _FrozenStrict
    type: Literal["generate_scene"] = "generate_scene"
    req_id: str
    prompt: str


class CheckSeedSafetyRequest(BaseModel):
    model_config = _FrozenStrict
    type: Literal["check_seed_safety"] = "check_seed_safety"
    req_id: str
    image_data: str


# ──────────────────────────────────────────────────────────────────────
# Discriminated union over every inbound message.  Built from a
# TypeAdapter so callers get O(1) dispatch on `type`.
# ──────────────────────────────────────────────────────────────────────


ClientMessage = Annotated[
    ControlNotif
    | PauseNotif
    | ResumeNotif
    | ResetNotif
    | PromptNotif
    | InitRequest
    | SceneEditRequest
    | GenerateSceneRequest
    | CheckSeedSafetyRequest,
    Field(discriminator="type"),
]

ClientMessageAdapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


# ──────────────────────────────────────────────────────────────────────
# Server → Client: push messages (no req_id, status/log/error/warning).
# ──────────────────────────────────────────────────────────────────────


class StatusMessage(BaseModel):
    """Engine progress stage broadcast.

    `stage` is a stage ID string (e.g. `session.warmup.compile`) — kept
    as `str` for now so progress_stages.py remains the source of truth;
    step 7 promotes it to a StageId StrEnum and decides whether
    progress_stages.py or src/stages.json is canonical.
    """

    model_config = _FrozenStrict
    type: Literal["status"] = "status"
    stage: str
    message: str | None = None


class SystemInfoMessage(BaseModel):
    """Hardware identity broadcast once per session, after handshake."""

    model_config = _FrozenStrict
    type: Literal["system_info"] = "system_info"
    cpu_name: str | None = None
    gpu_name: str | None = None
    vram_total_bytes: int | None = None
    cuda_version: str | None = None
    driver_version: str | None = None
    torch_version: str
    gpu_count: int = 0


class ErrorMessage(BaseModel):
    """Server-originated error.  `message_id` resolves to a translated
    string on the client; `message` carries the raw exception detail
    when the translation key wants to interpolate `{{message}}`."""

    model_config = _FrozenStrict
    type: Literal["error"] = "error"
    message_id: MessageId | None = None
    message: str | None = None
    params: dict[str, str] | None = None
    snapshot: ErrorSnapshot | None = None


class WarningMessage(BaseModel):
    """Transient, non-fatal server warning."""

    model_config = _FrozenStrict
    type: Literal["warning"] = "warning"
    message_id: MessageId
    message: str | None = None
    params: dict[str, str] | None = None


class LogMessage(BaseModel):
    """A line of server log output, mirrored to connected clients."""

    model_config = _FrozenStrict
    type: Literal["log"] = "log"
    line: str
    level: str = "info"


ServerPushMessage = Annotated[
    StatusMessage | SystemInfoMessage | ErrorMessage | WarningMessage | LogMessage,
    Field(discriminator="type"),
]


# ──────────────────────────────────────────────────────────────────────
# Frame header — embedded in the binary frame envelope:
#   [4-byte LE header_len][JSON header][JPEG bytes]
# Sender writes via `header.model_dump_json()`; the binary framing
# itself is built by call sites since it includes raw JPEG payload.
# ──────────────────────────────────────────────────────────────────────


class FrameHeader(BaseModel):
    model_config = _FrozenStrict
    frame_id: int
    client_ts: float
    gen_ms: float
    temporal_compression: int = 1
    vram_used_bytes: int = -1
    gpu_util_percent: int = -1
    # Per-frame profile timings, populated only on the inference path.
    t_infer_ms: float | None = None
    t_sync_ms: float | None = None
    t_enc_ms: float | None = None
    t_metrics_ms: float | None = None
    t_overhead_ms: float | None = None


# ──────────────────────────────────────────────────────────────────────
# RPC response data — typed payload for each request type's success case.
# ──────────────────────────────────────────────────────────────────────


class InitResponseData(BaseModel):
    model_config = _FrozenStrict
    model: str
    inference_fps: int
    system_info: SystemInfo


class SceneEditResponseData(BaseModel):
    model_config = _FrozenStrict
    original_jpeg_b64: str
    preview_jpeg_b64: str
    edit_prompt: str


class GenerateSceneResponseData(BaseModel):
    model_config = _FrozenStrict
    elapsed_ms: int
    image_jpeg_base64: str
    user_prompt: str
    sanitized_prompt: str
    image_model: str


class CheckSeedSafetyResponseData(BaseModel):
    model_config = _FrozenStrict
    is_safe: bool
    hash: str


# ──────────────────────────────────────────────────────────────────────
# RPC response envelope — discriminated by `success`.  Every RPC reply
# is one of `RpcSuccess[T]` or `RpcError`; helpers below construct them.
# ──────────────────────────────────────────────────────────────────────


class RpcSuccess[T: BaseModel](BaseModel):
    model_config = _FrozenStrict
    type: Literal["response"] = "response"
    req_id: str
    success: Literal[True] = True
    data: T


class RpcError(BaseModel):
    """Failed RPC reply.  Prefer `error_id` (a MessageId the renderer
    can translate) over the raw `error` string; the latter is the
    fallback for genuinely-unstructured exception messages."""

    model_config = _FrozenStrict
    type: Literal["response"] = "response"
    req_id: str
    success: Literal[False] = False
    error_id: MessageId | None = None
    error: str | None = None


def rpc_ok[T: BaseModel](req_id: str, data: T) -> RpcSuccess[T]:
    return RpcSuccess[T](req_id=req_id, data=data)


def rpc_err(req_id: str, *, error_id: MessageId | None = None, error: str | None = None) -> RpcError:
    return RpcError(req_id=req_id, error_id=error_id, error=error)
