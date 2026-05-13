import { invoke } from '../../bridge'
import type { SessionConfig } from '../../types/protocol.generated'
import type { ServerCapabilities } from '../../types/ipc'
import type { EngineBackend, QuantOption, Settings } from '../../types/settings'

/** Clamp saved `engine_backend` / `engine_quant` against what the
 *  active server reports it can run. Backend resolves first because
 *  the quant set is keyed off the post-clamp backend (`capabilities.quants`
 *  is per-backend). Returns the saved values unchanged when capabilities
 *  are unknown (no probe yet) or when the saved values are already valid.
 *
 *  Internal to `useClampedSettings`, which is the single seam where
 *  this policy is applied — every consumer downstream of that hook
 *  reads the already-clamped settings, so `buildSessionConfig`,
 *  `useSessionInit` etc. never re-run the policy and can't drift. */
export const clampToCapabilities = (
  settings: Settings,
  serverCapabilities: ServerCapabilities | null
): { engine_backend: EngineBackend; engine_quant: QuantOption } => {
  const savedBackend = settings.engine_backend ?? 'world_engine'
  const engine_backend: EngineBackend =
    serverCapabilities && !serverCapabilities.backends.includes(savedBackend)
      ? (serverCapabilities.backends[0] ?? 'world_engine')
      : savedBackend
  const savedQuant = settings.engine_quant ?? 'none'
  const backendQuants = serverCapabilities?.quants[engine_backend]
  const engine_quant: QuantOption =
    backendQuants && !backendQuants.includes(savedQuant) ? (backendQuants[0] ?? 'none') : savedQuant
  return { engine_backend, engine_quant }
}

/** Build the wire-canonical `SessionConfig` from current settings. Sent
 *  in every InitRequest — the server diffs each field against current
 *  state and reconfigures the deltas. The renderer's `'none'` quant
 *  sentinel maps to `undefined` (omitted on the wire); the server reads
 *  that as no-quantization. Recording is gated to standalone mode,
 *  matching what the server expects to receive.
 *
 *  Expects `settings` to already be the *effective* settings produced
 *  by `useClampedSettings` — i.e. `engine_backend` and `engine_quant`
 *  have already been clamped against the active server's capability
 *  matrix. This function trusts that contract and does no clamping
 *  of its own. */
export const buildSessionConfig = async (settings: Settings, isStandaloneMode: boolean): Promise<SessionConfig> => {
  const recordingEnabled = isStandaloneMode && (settings.recording?.enabled ?? false)
  const videoOutputDir = recordingEnabled
    ? ((await invoke('resolve-video-dir', settings.recording?.output_dir ?? '')) ?? null)
    : null
  const engine_quant: QuantOption = settings.engine_quant ?? 'none'
  return {
    quant: engine_quant !== 'none' ? engine_quant : undefined,
    engine_backend: settings.engine_backend ?? 'world_engine',
    scene_authoring: settings.scene_authoring_enabled ?? false,
    action_logging: settings.debug_overlays?.action_logging ?? false,
    video_recording: recordingEnabled,
    video_output_dir: videoOutputDir,
    cap_inference_fps: settings.cap_inference_fps ?? true
  }
}
