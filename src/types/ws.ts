// ============================================================================
// WebSocket Protocol Types
// ============================================================================
// Strongly typed message definitions for the client ↔ server WebSocket protocol.
// See CONTRIBUTING.md "WebSocket Protocol" for the full specification.

// ── Client → Server: Fire-and-forget messages ──────────────────────────────

/** Unified session init/update RPC.
 * Server compares against current state and only applies what changed:
 *   - model changed? → reload engine
 *   - seed_image_data changed? → load new seed (server computes hash for safety + dedup)
 *   - scene_edit/action_logging changed? → update flags
 * Responds with session metrics on success. */
export type InitMessage = {
  type: 'init'
  req_id?: string
  model?: string
  seed_image_data?: string
  seed_filename?: string // informational, for action logging only
  scene_edit?: boolean
  action_logging?: boolean
  quant?: string | null
  cap_inference_fps?: boolean
}
export type InitResponse = {
  gpu_name: string | null
  cpu_name: string | null
  model: string
  inference_fps: number
}

export type ControlMessage = {
  type: 'control'
  buttons: string[]
  mouse_dx: number
  mouse_dy: number
  ts?: number
}

export type PauseMessage = { type: 'pause' }
export type ResumeMessage = { type: 'resume' }
export type ResetMessage = { type: 'reset' }

export type ClientMessage = InitMessage | ControlMessage | PauseMessage | ResumeMessage | ResetMessage

// ── Client → Server: RPC requests (include req_id, get a response) ─────────

export type CheckSeedSafetyRequest = {
  type: 'check_seed_safety'
  req_id: string
  image_data: string
}
export type CheckSeedSafetyResponse = {
  is_safe: boolean
  hash: string
}

export type SceneEditRequest = {
  type: 'scene_edit'
  req_id: string
  prompt: string
}
export type SceneEditResponse = {
  elapsed_ms: number
  original_jpeg_b64?: string
  preview_jpeg_b64?: string
  edit_prompt?: string
}

export type GenerateSceneRequest = {
  type: 'generate_scene'
  req_id: string
  prompt: string
}
export type GenerateSceneResponse = {
  elapsed_ms: number
}

export type ClientRpcRequest = CheckSeedSafetyRequest | SceneEditRequest | GenerateSceneRequest

// ── Server → Client: Push messages ─────────────────────────────────────────

export type StatusMessage = {
  type: 'status'
  code: string
  stage?: { id: string; label: string; percent: number }
}

export type LogMessage = {
  type: 'log'
  line: string
}

export type ErrorPushMessage = {
  type: 'error'
  message_id?: string
  message?: string
  params?: Record<string, string>
}

export type WarningPushMessage = {
  type: 'warning'
  message_id?: string
  message?: string
  params?: Record<string, string>
}

export type ServerPushMessage = StatusMessage | LogMessage | ErrorPushMessage | WarningPushMessage

// ── Server → Client: RPC responses ─────────────────────────────────────────

export type RpcSuccessResponse<T = unknown> = {
  type: 'response'
  req_id: string
  success: true
  data: T
}

export type RpcErrorResponse = {
  type: 'response'
  req_id: string
  success: false
  error?: string
  error_id?: string
}

export type RpcResponse<T = unknown> = RpcSuccessResponse<T> | RpcErrorResponse
