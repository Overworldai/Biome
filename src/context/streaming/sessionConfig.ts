import { invoke } from '../../bridge'
import type { SessionConfig } from '../../types/protocol.generated'
import type { ServerCapabilities } from '../../types/ipc'
import type { EngineBackend, QuantOption, Settings } from '../../types/settings'

/** Build the wire-canonical `SessionConfig` from current settings. Sent
 *  in every InitRequest — the server diffs each field against current
 *  state and reconfigures the deltas. The renderer's `'none'` quant
 *  sentinel maps to `undefined` (omitted on the wire); the server reads
 *  that as no-quantization. Recording is gated to standalone mode,
 *  matching what the server expects to receive.
 *
 *  `serverCapabilities` (when present) is the post-probe view of what
 *  the active server can actually run; we clamp every saved value
 *  whose set is reported there (`engine_backend`, `engine_quant`) so a
 *  stale setting can't ask for something the server will silently
 *  override or reject (e.g. `intw8a8` / `world_engine` saved on a CUDA
 *  box that's now connected to an Apple-Silicon remote). The settings
 *  file isn't touched — the EngineTab filters handle UI-side
 *  correction the next time the user visits. */
export const buildSessionConfig = async (
  settings: Settings,
  isStandaloneMode: boolean,
  serverCapabilities: ServerCapabilities | null
): Promise<SessionConfig> => {
  const recordingEnabled = isStandaloneMode && (settings.recording?.enabled ?? false)
  const videoOutputDir = recordingEnabled
    ? ((await invoke('resolve-video-dir', settings.recording?.output_dir ?? '')) ?? null)
    : null
  // Backend clamp first, then quant — the quant set is keyed off the
  // post-clamp backend, since `capabilities.quants` is per-backend.
  const savedBackend = settings.engine_backend ?? 'world_engine'
  const engine_backend: EngineBackend =
    serverCapabilities && !serverCapabilities.backends.includes(savedBackend)
      ? (serverCapabilities.backends[0] ?? 'world_engine')
      : savedBackend
  const savedQuant = settings.engine_quant ?? 'none'
  const backendQuants = serverCapabilities?.quants[engine_backend]
  const quant: QuantOption =
    backendQuants && !backendQuants.includes(savedQuant) ? (backendQuants[0] ?? 'none') : savedQuant
  return {
    quant: quant !== 'none' ? quant : undefined,
    engine_backend,
    scene_authoring: settings.scene_authoring_enabled ?? false,
    action_logging: settings.debug_overlays?.action_logging ?? false,
    video_recording: recordingEnabled,
    video_output_dir: videoOutputDir,
    cap_inference_fps: settings.cap_inference_fps ?? true
  }
}
