// THIS FILE IS GENERATED. DO NOT EDIT BY HAND.
//
// Source:    server-components/server/protocol.py
// Regenerate: cd server-components && uv run python scripts/codegen_ts.py
//
// CI fails if this file is stale relative to its source. If you change
// the Python protocol, re-run the codegen and commit the result.

// ─── Enums ────────────────────────────────────────────────────────────

export type ServerStageId =
  | 'startup.begin'
  | 'startup.world_engine_manager'
  | 'startup.safety_checker'
  | 'startup.safety_ready'
  | 'startup.ready'
  | 'session.waiting_for_seed'
  | 'session.loading_model.load'
  | 'session.loading_model.instantiate'
  | 'session.loading_model.done'
  | 'session.warmup.reset'
  | 'session.warmup.seed'
  | 'session.warmup.compile'
  | 'session.inpainting.load'
  | 'session.inpainting.ready'
  | 'session.init.reset'
  | 'session.init.seed'
  | 'session.init.frame'
  | 'session.reset'
  | 'session.ready'

export type MessageId =
  | 'app.server.error.serverStartupFailed'
  | 'app.server.error.timeoutWaitingForSeed'
  | 'app.server.error.initFailed'
  | 'app.server.error.quantUnsupportedGpu'
  | 'app.server.error.sceneAuthoringModelLoadFailed'
  | 'app.server.error.sceneAuthoringEmptyPrompt'
  | 'app.server.error.sceneAuthoringModelNotLoaded'
  | 'app.server.error.sceneAuthoringAlreadyInProgress'
  | 'app.server.error.sceneEditSafetyRejected'
  | 'app.server.error.generateSceneSafetyRejected'
  | 'app.server.error.deviceRecoveryFailed'
  | 'app.server.warning.missingSeedData'
  | 'app.server.warning.invalidSeedData'
  | 'app.server.warning.seedUnsafe'
  | 'app.server.warning.seedSafetyCheckFailed'
  | 'app.server.warning.seedLoadFailed'

// ─── Models ───────────────────────────────────────────────────────────

/** Static hardware/runtime identity, snapshot once at startup. */
export interface SystemInfo {
  cpu_name?: string
  gpu_name?: string
  vram_total_bytes?: number
  runtime_version?: string
  driver_version?: string
  torch_version: string
  gpu_count?: number
}

/** Ephemeral state captured at the moment of an error push. */
export interface ErrorSnapshot {
  process_rss_bytes?: number
  ram_used_bytes?: number
  ram_total_bytes?: number
  vram_used_bytes?: number
  vram_reserved_bytes?: number
  gpu_util_percent?: number
}

/**
 * Per-frame input snapshot from the renderer. `buttons` carries
 * the keycap names (e.g. "W", "MOUSE_LEFT"); the receiver resolves
 * each via `keymap.BUTTON_CODES` into the int codes the
 * world engine consumes.
 */
export interface ControlNotif {
  type: 'control'
  buttons?: string[]
  mouse_dx?: number
  mouse_dy?: number
  ts?: number
}

export interface PauseNotif {
  type: 'pause'
}

export interface ResumeNotif {
  type: 'resume'
}

export interface ResetNotif {
  type: 'reset'
}

export interface PromptNotif {
  type: 'prompt'
  prompt?: string
}

export interface InitRequest {
  type: 'init'
  req_id: string
  model?: string
  seed_image_data?: string
  seed_filename?: string
  quant?: string
  scene_authoring?: boolean
  action_logging?: boolean
  video_recording?: boolean
  video_output_dir?: string
  biome_version?: string
  cap_inference_fps?: boolean
}

export interface SceneEditRequest {
  type: 'scene_edit'
  req_id: string
  prompt: string
}

export interface GenerateSceneRequest {
  type: 'generate_scene'
  req_id: string
  prompt: string
}

export interface CheckSeedSafetyRequest {
  type: 'check_seed_safety'
  req_id: string
  image_data: string
}

/**
 * Engine progress stage broadcast. `stage` is a `StageId` enum
 * value (e.g. `session.warmup.compile`); progress_stages.py is the
 * canonical Python-side registry, mirrored on the renderer in
 * `src/stages.json` for label / percent metadata.
 */
export interface StatusMessage {
  type: 'status'
  stage: ServerStageId
  message?: string
}

/** Hardware identity broadcast once per session, after handshake. */
export interface SystemInfoMessage {
  type: 'system_info'
  cpu_name?: string
  gpu_name?: string
  vram_total_bytes?: number
  runtime_version?: string
  driver_version?: string
  torch_version: string
  gpu_count?: number
}

/**
 * Server-originated error.  `message_id` resolves to a translated
 * string on the client; `message` carries the raw exception detail
 * when the translation key wants to interpolate `{{message}}`.
 */
export interface ErrorMessage {
  type: 'error'
  message_id?: MessageId
  message?: string
  params?: Record<string, string>
  snapshot?: ErrorSnapshot
}

/** Transient, non-fatal server warning. */
export interface WarningMessage {
  type: 'warning'
  message_id: MessageId
  message?: string
  params?: Record<string, string>
}

/** A line of server log output, mirrored to connected clients. */
export interface LogMessage {
  type: 'log'
  line: string
  level?: string
}

export interface FrameHeader {
  frame_id: number
  client_ts: number
  gen_ms: number
  temporal_compression?: number
  vram_used_bytes?: number
  gpu_util_percent?: number
  t_infer_ms?: number
  t_sync_ms?: number
  t_enc_ms?: number
  t_metrics_ms?: number
  t_overhead_ms?: number
}

export interface InitResponseData {
  model: string
  inference_fps: number
  system_info: SystemInfo
}

export interface SceneEditResponseData {
  original_jpeg_b64: string
  preview_jpeg_b64: string
  edit_prompt: string
}

export interface GenerateSceneResponseData {
  elapsed_ms: number
  image_jpeg_base64: string
  user_prompt: string
  sanitized_prompt: string
  image_model: string
}

export interface CheckSeedSafetyResponseData {
  is_safe: boolean
  hash: string
}

export interface RpcSuccessResponse<T> {
  type: 'response'
  req_id: string
  success: true
  data: T
}

/**
 * Failed RPC reply.  Prefer `error_id` (a MessageId the renderer
 * can translate) over the raw `error` string; the latter is the
 * fallback for genuinely-unstructured exception messages.
 */
export interface RpcErrorResponse {
  type: 'response'
  req_id: string
  success: false
  error_id?: MessageId
  error?: string
}

/**
 * Semantic session state captured into the MP4's metadata so each
 * recording is self-describing. The field set is the wire format —
 * callers (the session layer) construct this explicitly rather than
 * passing a free-form dict, so the schema is fixed and searchable.
 * Picked up by the protocol codegen so the renderer side imports a
 * typed `RecordingProperties` alongside the WS protocol types.
 */
export interface RecordingProperties {
  biome_version?: string
  model?: string
  quant?: string
  seed?: string
  scene_authoring_enabled?: boolean
}

// ─── Discriminated unions ─────────────────────────────────────────────

export type ClientMessage =
  | ControlNotif
  | PauseNotif
  | ResumeNotif
  | ResetNotif
  | PromptNotif
  | InitRequest
  | SceneEditRequest
  | GenerateSceneRequest
  | CheckSeedSafetyRequest

export type ServerPushMessage = StatusMessage | SystemInfoMessage | ErrorMessage | WarningMessage | LogMessage

// ─── RPC request ↔ response map ───────────────────────────────────────

export type RpcRequestMap = {
  init: { request: InitRequest; response: InitResponseData }
  scene_edit: { request: SceneEditRequest; response: SceneEditResponseData }
  generate_scene: { request: GenerateSceneRequest; response: GenerateSceneResponseData }
  check_seed_safety: { request: CheckSeedSafetyRequest; response: CheckSeedSafetyResponseData }
}
