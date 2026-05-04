// THIS FILE IS GENERATED. DO NOT EDIT BY HAND.
//
// Source:    server-components/server/protocol.py
// Regenerate: cd server-components && uv run python scripts/codegen_ts.py
//
// Runtime validators paired with `protocol.generated.ts`. Each schema
// asserts `satisfies z.ZodType<T>` against the matching type so any
// drift between this file and the type definitions is a tsc error.

import { z } from 'zod'

import type {
  CheckSeedSafetyRequest,
  CheckSeedSafetyResponseData,
  ClientMessage,
  ControlNotif,
  ErrorMessage,
  ErrorSnapshot,
  FrameHeader,
  GenerateSceneRequest,
  GenerateSceneResponseData,
  InitRequest,
  InitResponseData,
  LogMessage,
  MessageId,
  PauseNotif,
  PromptNotif,
  ResetNotif,
  ResumeNotif,
  RpcErrorResponse,
  SceneEditRequest,
  SceneEditResponseData,
  ServerPushMessage,
  ServerStageId,
  StatusMessage,
  SystemInfo,
  SystemInfoMessage,
  WarningMessage
} from './protocol.generated'

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
  'session.loading_model.done',
  'session.warmup.reset',
  'session.warmup.seed',
  'session.warmup.compile',
  'session.inpainting.load',
  'session.inpainting.ready',
  'session.init.reset',
  'session.init.seed',
  'session.init.frame',
  'session.reset',
  'session.ready'
]) satisfies z.ZodType<ServerStageId>

export const MessageIdSchema = z.enum([
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
]) satisfies z.ZodType<MessageId>

// ─── Models ───────────────────────────────────────────────────────────

export const SystemInfoSchema = z.object({
  cpu_name: z.string().optional(),
  gpu_name: z.string().optional(),
  vram_total_bytes: z.number().optional(),
  runtime_version: z.string().optional(),
  driver_version: z.string().optional(),
  torch_version: z.string(),
  gpu_count: z.number().optional()
}) satisfies z.ZodType<SystemInfo>

export const ErrorSnapshotSchema = z.object({
  process_rss_bytes: z.number().optional(),
  ram_used_bytes: z.number().optional(),
  ram_total_bytes: z.number().optional(),
  vram_used_bytes: z.number().optional(),
  vram_reserved_bytes: z.number().optional(),
  gpu_util_percent: z.number().optional()
}) satisfies z.ZodType<ErrorSnapshot>

export const ControlNotifSchema = z.object({
  type: z.literal('control'),
  buttons: z.array(z.string()).optional(),
  mouse_dx: z.number().optional(),
  mouse_dy: z.number().optional(),
  ts: z.number().optional()
}) satisfies z.ZodType<ControlNotif>

export const PauseNotifSchema = z.object({
  type: z.literal('pause')
}) satisfies z.ZodType<PauseNotif>

export const ResumeNotifSchema = z.object({
  type: z.literal('resume')
}) satisfies z.ZodType<ResumeNotif>

export const ResetNotifSchema = z.object({
  type: z.literal('reset')
}) satisfies z.ZodType<ResetNotif>

export const PromptNotifSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string().optional()
}) satisfies z.ZodType<PromptNotif>

export const InitRequestSchema = z.object({
  type: z.literal('init'),
  req_id: z.string(),
  model: z.string().optional(),
  seed_image_data: z.string().optional(),
  seed_filename: z.string().optional(),
  quant: z.string().optional(),
  scene_authoring: z.boolean().optional(),
  action_logging: z.boolean().optional(),
  video_recording: z.boolean().optional(),
  video_output_dir: z.string().optional(),
  biome_version: z.string().optional(),
  cap_inference_fps: z.boolean().optional()
}) satisfies z.ZodType<InitRequest>

export const SceneEditRequestSchema = z.object({
  type: z.literal('scene_edit'),
  req_id: z.string(),
  prompt: z.string()
}) satisfies z.ZodType<SceneEditRequest>

export const GenerateSceneRequestSchema = z.object({
  type: z.literal('generate_scene'),
  req_id: z.string(),
  prompt: z.string()
}) satisfies z.ZodType<GenerateSceneRequest>

export const CheckSeedSafetyRequestSchema = z.object({
  type: z.literal('check_seed_safety'),
  req_id: z.string(),
  image_data: z.string()
}) satisfies z.ZodType<CheckSeedSafetyRequest>

export const StatusMessageSchema = z.object({
  type: z.literal('status'),
  stage: ServerStageIdSchema,
  message: z.string().optional()
}) satisfies z.ZodType<StatusMessage>

export const SystemInfoMessageSchema = z.object({
  type: z.literal('system_info'),
  cpu_name: z.string().optional(),
  gpu_name: z.string().optional(),
  vram_total_bytes: z.number().optional(),
  runtime_version: z.string().optional(),
  driver_version: z.string().optional(),
  torch_version: z.string(),
  gpu_count: z.number().optional()
}) satisfies z.ZodType<SystemInfoMessage>

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  message_id: MessageIdSchema.optional(),
  message: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
  snapshot: ErrorSnapshotSchema.optional()
}) satisfies z.ZodType<ErrorMessage>

export const WarningMessageSchema = z.object({
  type: z.literal('warning'),
  message_id: MessageIdSchema,
  message: z.string().optional(),
  params: z.record(z.string(), z.string()).optional()
}) satisfies z.ZodType<WarningMessage>

export const LogMessageSchema = z.object({
  type: z.literal('log'),
  line: z.string(),
  level: z.string().optional()
}) satisfies z.ZodType<LogMessage>

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
}) satisfies z.ZodType<FrameHeader>

export const InitResponseDataSchema = z.object({
  model: z.string(),
  inference_fps: z.number(),
  system_info: SystemInfoSchema
}) satisfies z.ZodType<InitResponseData>

export const SceneEditResponseDataSchema = z.object({
  original_jpeg_b64: z.string(),
  preview_jpeg_b64: z.string(),
  edit_prompt: z.string()
}) satisfies z.ZodType<SceneEditResponseData>

export const GenerateSceneResponseDataSchema = z.object({
  elapsed_ms: z.number(),
  image_jpeg_base64: z.string(),
  user_prompt: z.string(),
  sanitized_prompt: z.string(),
  image_model: z.string()
}) satisfies z.ZodType<GenerateSceneResponseData>

export const CheckSeedSafetyResponseDataSchema = z.object({
  is_safe: z.boolean(),
  hash: z.string()
}) satisfies z.ZodType<CheckSeedSafetyResponseData>

export const RpcSuccessResponseSchema = z.object({
  type: z.literal('response'),
  req_id: z.string(),
  success: z.literal(true),
  data: z.unknown()
})

export const RpcErrorResponseSchema = z.object({
  type: z.literal('response'),
  req_id: z.string(),
  success: z.literal(false),
  error_id: MessageIdSchema.optional(),
  error: z.string().optional()
}) satisfies z.ZodType<RpcErrorResponse>

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
]) satisfies z.ZodType<ClientMessage>

export const ServerPushMessageSchema = z.discriminatedUnion('type', [
  StatusMessageSchema,
  SystemInfoMessageSchema,
  ErrorMessageSchema,
  WarningMessageSchema,
  LogMessageSchema
]) satisfies z.ZodType<ServerPushMessage>
