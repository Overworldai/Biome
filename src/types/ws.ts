// ============================================================================
// WebSocket Protocol Types
// ============================================================================
// Strongly typed message definitions for the client ↔ server WebSocket protocol.
// See CONTRIBUTING.md "WebSocket Protocol" for the full specification.

import type { ServerCode } from './input'

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
  video_recording?: boolean
  /** Absolute path to write recordings into. Only honoured in standalone mode;
   *  in server mode the server decides where to write. */
  video_output_dir?: string
  /** Biome app version. Embedded into each recorded MP4's metadata so the
   *  recording carries a self-describing record of what produced it. */
  biome_version?: string
  quant?: string | null
  cap_inference_fps?: boolean
}
/** Host identity returned in the init RPC response (Overworldai/Biome#98).
 *  Every CPU/GPU identifier the client shows comes from here — frame
 *  headers and error snapshots carry only dynamic/ephemeral data. */
export type ServerSystemInfo = {
  cpu_name?: string | null
  gpu_name?: string | null
  gpu_count?: number
  vram_total_bytes?: number | null
  cuda_version?: string | null
  driver_version?: string | null
  torch_version?: string
}

/** Ephemeral state captured on the server at the moment an error is emitted.
 *  Included in `ErrorPushMessage.snapshot` so bug reports have context about
 *  what the server was doing at the failure point rather than idle values. */
export type ServerErrorSnapshot = {
  process_rss_bytes?: number
  ram_used_bytes?: number
  ram_total_bytes?: number
  vram_used_bytes?: number
  vram_reserved_bytes?: number
  gpu_util_percent?: number
}

export type InitResponse = {
  model: string
  inference_fps: number
  system_info: ServerSystemInfo
}

export type ControlMessage = {
  type: 'control'
  buttons: ServerCode[]
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
  snapshot?: ServerErrorSnapshot
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
