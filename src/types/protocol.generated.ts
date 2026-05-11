// THIS FILE IS GENERATED. DO NOT EDIT BY HAND.
//
// Source:    server-components/server/protocol.py + recording/video_recorder.py
// Regenerate: cd server-components && uv run python scripts/codegen_ts.py
//
// Each item ships as a Zod schema (the runtime validator) plus a
// `z.infer<typeof ...Schema>` type alias derived from it. Schemas are
// the source of truth — drift between schema and type is structurally
// impossible. CI runs the codegen with `--check` and fails if this
// file is stale relative to its sources.

import { z } from 'zod'

// ─── Constants ────────────────────────────────────────────────────────

export const PROTOCOL_VERSION = 3

// ─── Enums ────────────────────────────────────────────────────────────

export const ServerStageIdSchema = z.enum([
  'startup.begin',
  'startup.world_engine_manager',
  'startup.safety_checker',
  'startup.safety_ready',
  'startup.ready',
  'session.waiting_for_seed',
  'session.loading_model.load',
  'session.loading_model.instantiate',
  'session.warmup.reset',
  'session.warmup.seed',
  'session.warmup.compile',
  'session.scene_authoring.load',
  'session.init.reset',
  'session.init.seed',
  'session.init.frame',
  'session.reset',
  'session.ready'
])
export type ServerStageId = z.infer<typeof ServerStageIdSchema>

export const MessageIdSchema = z.enum([
  'app.server.error.protocolVersionMismatch',
  'app.server.error.serverBusy',
  'app.server.error.serverStartupFailed',
  'app.server.error.timeoutWaitingForSeed',
  'app.server.error.initFailed',
  'app.server.error.quantUnsupportedGpu',
  'app.server.error.sceneAuthoringModelLoadFailed',
  'app.server.error.sceneAuthoringEmptyPrompt',
  'app.server.error.sceneAuthoringModelNotLoaded',
  'app.server.error.sceneAuthoringAlreadyInProgress',
  'app.server.error.sceneEditSafetyRejected',
  'app.server.error.generateSceneSafetyRejected',
  'app.server.error.deviceRecoveryFailed',
  'app.server.warning.missingSeedData',
  'app.server.warning.invalidSeedData',
  'app.server.warning.seedUnsafe',
  'app.server.warning.seedSafetyCheckFailed',
  'app.server.warning.seedLoadFailed'
])
export type MessageId = z.infer<typeof MessageIdSchema>

export const EngineBackendSchema = z.enum(['world_engine', 'quark'])
export type EngineBackend = z.infer<typeof EngineBackendSchema>

export const QuantSchema = z.enum(['none', 'fp8w8a8', 'intw8a8'])
export type Quant = z.infer<typeof QuantSchema>

// ─── Models ───────────────────────────────────────────────────────────

/** Static hardware/runtime identity, snapshot once at startup. */
export const SystemInfoSchema = z.object({
  cpu_name: z.string().optional(),
  gpu_name: z.string().optional(),
  vram_total_bytes: z.number().optional(),
  runtime_version: z.string().optional(),
  driver_version: z.string().optional(),
  torch_version: z.string(),
  gpu_count: z.number().optional()
})
export type SystemInfo = z.infer<typeof SystemInfoSchema>

/** Ephemeral state captured at the moment of an error push. */
export const ErrorSnapshotSchema = z.object({
  process_rss_bytes: z.number().optional(),
  ram_used_bytes: z.number().optional(),
  ram_total_bytes: z.number().optional(),
  vram_used_bytes: z.number().optional(),
  vram_reserved_bytes: z.number().optional(),
  gpu_util_percent: z.number().optional()
})
export type ErrorSnapshot = z.infer<typeof ErrorSnapshotSchema>

/**
 * Per-config support sets the server can honour, surfaced through
 * `/health` so the renderer can clamp its in-flight selections to
 * options that will actually run. The server is the source of truth —
 * anywhere the renderer has a dropdown that maps to a wire-level
 * config, this is the canonical set to filter against. Client-side
 * platform guesses are wrong in server mode where the remote may be
 * on a different platform than the client.
 *
 * `quants` is keyed by `EngineBackend` because the supported quant
 * set genuinely differs across backends on the same host:
 *
 *   - CUDA + `world_engine`: all three modes (`none`, `fp8w8a8`,
 *     `intw8a8`).
 *   - CUDA + `quark`: `none` and `fp8w8a8`. Quark's CUDA path does
 *     not implement INT8 weight-only quantisation today.
 *   - Apple Silicon + `quark`: `none` only — `quark.EngineMetal`
 *     internally forces all-bf16 (no native fp8 in MSL, no int8
 *     KV path), so anything else is silently overridden. (Apple
 *     Silicon doesn't offer `world_engine` at all — the legacy
 *     package is CUDA-only.)
 *
 * The dict only contains entries for backends in `backends`; the
 * renderer indexes by the in-flight backend selection so the quant
 * dropdown reacts instantly to a backend toggle without a save +
 * reconnect round-trip. Surfaced through HTTP rather than WS (lives
 * in `routes.HealthResponse`), but kept here so the codegen mirrors
 * it to a Zod schema + TS type the renderer reuses for both shape
 * parsing and the connection slice.
 */
export const ServerCapabilitiesSchema = z.object({
  backends: z.array(EngineBackendSchema),
  quants: z.record(EngineBackendSchema, z.array(QuantSchema))
})
export type ServerCapabilities = z.infer<typeof ServerCapabilitiesSchema>

/**
 * Per-frame input snapshot from the renderer. `buttons` carries
 * the keycap names (e.g. "W", "MOUSE_LEFT"); the receiver resolves
 * each via `keymap.BUTTON_CODES` into the int codes the
 * world engine consumes.
 */
export const ControlNotifSchema = z.object({
  type: z.literal('control'),
  buttons: z.array(z.string()).optional(),
  mouse_dx: z.number().optional(),
  mouse_dy: z.number().optional(),
  ts: z.number().optional()
})
export type ControlNotif = z.infer<typeof ControlNotifSchema>

export const PauseNotifSchema = z.object({
  type: z.literal('pause')
})
export type PauseNotif = z.infer<typeof PauseNotifSchema>

export const ResumeNotifSchema = z.object({
  type: z.literal('resume')
})
export type ResumeNotif = z.infer<typeof ResumeNotifSchema>

export const ResetNotifSchema = z.object({
  type: z.literal('reset')
})
export type ResetNotif = z.infer<typeof ResetNotifSchema>

export const PromptNotifSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string().optional()
})
export type PromptNotif = z.infer<typeof PromptNotifSchema>

/**
 * Live session configuration. Sent in full on every init — the
 * server compares against the running session and reconfigures the
 * deltas. `quant` is the only nullable field: `None` means "no
 * quantization" (the renderer maps its `'none'` UI sentinel to null
 * on the wire). `engine_backend` selects the inference package — a
 * backend change forces a model reload, same as a `quant` change.
 */
export const SessionConfigSchema = z.object({
  quant: z.enum(['fp8w8a8', 'intw8a8']).optional(),
  engine_backend: EngineBackendSchema.optional(),
  scene_authoring: z.boolean(),
  action_logging: z.boolean(),
  video_recording: z.boolean(),
  video_output_dir: z.string().nullable(),
  cap_inference_fps: z.boolean()
})
export type SessionConfig = z.infer<typeof SessionConfigSchema>

export const InitRequestSchema = z.object({
  type: z.literal('init'),
  req_id: z.string(),
  model: z.string(),
  config: SessionConfigSchema,
  seed_image_data: z.string().optional(),
  seed_filename: z.string().optional(),
  biome_version: z.string().optional()
})
export type InitRequest = z.infer<typeof InitRequestSchema>

export const SceneEditRequestSchema = z.object({
  type: z.literal('scene_edit'),
  req_id: z.string(),
  prompt: z.string()
})
export type SceneEditRequest = z.infer<typeof SceneEditRequestSchema>

export const GenerateSceneRequestSchema = z.object({
  type: z.literal('generate_scene'),
  req_id: z.string(),
  prompt: z.string()
})
export type GenerateSceneRequest = z.infer<typeof GenerateSceneRequestSchema>

export const CheckSeedSafetyRequestSchema = z.object({
  type: z.literal('check_seed_safety'),
  req_id: z.string(),
  image_data: z.string()
})
export type CheckSeedSafetyRequest = z.infer<typeof CheckSeedSafetyRequestSchema>

/**
 * Engine progress stage broadcast. `stage` is a `StageId` enum
 * value (e.g. `session.warmup.compile`); progress_stages.py is the
 * canonical Python-side registry, mirrored on the renderer in
 * `src/stages.json` for label / percent metadata.
 */
export const StatusMessageSchema = z.object({
  type: z.literal('status'),
  stage: ServerStageIdSchema,
  message: z.string().optional()
})
export type StatusMessage = z.infer<typeof StatusMessageSchema>

/** Hardware identity broadcast once per session, after handshake. */
export const SystemInfoMessageSchema = z.object({
  type: z.literal('system_info'),
  cpu_name: z.string().optional(),
  gpu_name: z.string().optional(),
  vram_total_bytes: z.number().optional(),
  runtime_version: z.string().optional(),
  driver_version: z.string().optional(),
  torch_version: z.string(),
  gpu_count: z.number().optional()
})
export type SystemInfoMessage = z.infer<typeof SystemInfoMessageSchema>

/**
 * Server-originated error.  `message_id` resolves to a translated
 * string on the client; `message` carries the raw exception detail
 * when the translation key wants to interpolate `{{message}}`.
 */
export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  message_id: MessageIdSchema.optional(),
  message: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
  snapshot: ErrorSnapshotSchema.optional()
})
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>

/** Transient, non-fatal server warning. */
export const WarningMessageSchema = z.object({
  type: z.literal('warning'),
  message_id: MessageIdSchema,
  message: z.string().optional(),
  params: z.record(z.string(), z.string()).optional()
})
export type WarningMessage = z.infer<typeof WarningMessageSchema>

/**
 * One emitted server-side log event, mirrored to connected clients.
 *
 * Carries the structured event_dict from structlog: the message string,
 * severity, logger name, rendered timestamp, formatted exception
 * traceback (when present), and the merged contextvars + per-call
 * kwargs. The renderer reconstructs any human-readable form it wants
 * — there is no pre-rendered text on the wire.
 */
export const LogMessageSchema = z.object({
  type: z.literal('log'),
  event: z.string(),
  level: z.string().optional(),
  logger: z.string().optional(),
  timestamp: z.string().optional(),
  exception: z.string().optional(),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
})
export type LogMessage = z.infer<typeof LogMessageSchema>

export const FrameHeaderSchema = z.object({
  frame_id: z.number(),
  client_ts: z.number(),
  gen_ms: z.number(),
  temporal_compression: z.number().optional(),
  vram_used_bytes: z.number().optional(),
  gpu_util_percent: z.number().optional(),
  t_infer_ms: z.number().optional(),
  t_sync_ms: z.number().optional(),
  t_enc_ms: z.number().optional(),
  t_metrics_ms: z.number().optional(),
  t_overhead_ms: z.number().optional()
})
export type FrameHeader = z.infer<typeof FrameHeaderSchema>

export const InitResponseDataSchema = z.object({
  model: z.string(),
  inference_fps: z.number(),
  system_info: SystemInfoSchema
})
export type InitResponseData = z.infer<typeof InitResponseDataSchema>

export const SceneEditResponseDataSchema = z.object({
  original_jpeg_b64: z.string(),
  preview_jpeg_b64: z.string(),
  edit_prompt: z.string()
})
export type SceneEditResponseData = z.infer<typeof SceneEditResponseDataSchema>

export const GenerateSceneResponseDataSchema = z.object({
  elapsed_ms: z.number(),
  image_jpeg_base64: z.string(),
  user_prompt: z.string(),
  sanitized_prompt: z.string(),
  image_model: z.string()
})
export type GenerateSceneResponseData = z.infer<typeof GenerateSceneResponseDataSchema>

export const CheckSeedSafetyResponseDataSchema = z.object({
  is_safe: z.boolean(),
  hash: z.string()
})
export type CheckSeedSafetyResponseData = z.infer<typeof CheckSeedSafetyResponseDataSchema>

export const RpcSuccessResponseSchema = z.object({
  type: z.literal('response'),
  req_id: z.string(),
  success: z.literal(true),
  data: z.unknown()
})
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
export const RpcErrorResponseSchema = z.object({
  type: z.literal('response'),
  req_id: z.string(),
  success: z.literal(false),
  error_id: MessageIdSchema.optional(),
  error: z.string().optional()
})
export type RpcErrorResponse = z.infer<typeof RpcErrorResponseSchema>

/**
 * Semantic session state captured into the MP4's metadata so each
 * recording is self-describing. The field set is the wire format —
 * callers (the session layer) construct this explicitly rather than
 * passing a free-form dict, so the schema is fixed and searchable.
 * Picked up by the protocol codegen so the renderer side imports a
 * typed `RecordingProperties` alongside the WS protocol types.
 */
export const RecordingPropertiesSchema = z.object({
  biome_version: z.string().optional(),
  model: z.string().optional(),
  quant: z.string().optional(),
  seed: z.string().optional(),
  scene_authoring_enabled: z.boolean().optional()
})
export type RecordingProperties = z.infer<typeof RecordingPropertiesSchema>

// ─── Discriminated unions ─────────────────────────────────────────────

export const ClientMessageSchema = z.discriminatedUnion('type', [
  ControlNotifSchema,
  PauseNotifSchema,
  ResumeNotifSchema,
  ResetNotifSchema,
  PromptNotifSchema,
  InitRequestSchema,
  SceneEditRequestSchema,
  GenerateSceneRequestSchema,
  CheckSeedSafetyRequestSchema
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

export const ServerPushMessageSchema = z.discriminatedUnion('type', [
  StatusMessageSchema,
  SystemInfoMessageSchema,
  ErrorMessageSchema,
  WarningMessageSchema,
  LogMessageSchema
])
export type ServerPushMessage = z.infer<typeof ServerPushMessageSchema>

// ─── RPC request ↔ response map ───────────────────────────────────────

export type RpcRequestMap = {
  init: { request: InitRequest; response: InitResponseData }
  scene_edit: { request: SceneEditRequest; response: SceneEditResponseData }
  generate_scene: { request: GenerateSceneRequest; response: GenerateSceneResponseData }
  check_seed_safety: { request: CheckSeedSafetyRequest; response: CheckSeedSafetyResponseData }
}
