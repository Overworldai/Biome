import { invoke } from '../../bridge'
import type { SessionConfig } from '../../types/protocol.generated'
import type { Settings } from '../../types/settings'

/** Build the wire-canonical `SessionConfig` from current settings. Sent
 *  in every InitRequest — the server diffs each field against current
 *  state and reconfigures the deltas. The renderer's `'none'` quant
 *  sentinel maps to `undefined` (omitted on the wire); the server reads
 *  that as no-quantization. Recording is gated to standalone mode,
 *  matching what the server expects to receive. */
export const buildSessionConfig = async (settings: Settings, isStandaloneMode: boolean): Promise<SessionConfig> => {
  const recordingEnabled = isStandaloneMode && (settings.recording?.enabled ?? false)
  const videoOutputDir = recordingEnabled
    ? ((await invoke('resolve-video-dir', settings.recording?.output_dir ?? '')) ?? null)
    : null
  const quant = settings.engine_quant ?? 'none'
  return {
    quant: quant !== 'none' ? quant : undefined,
    engine_backend: settings.engine_backend ?? 'world_engine',
    scene_authoring: settings.scene_authoring_enabled ?? false,
    action_logging: settings.debug_overlays?.action_logging ?? false,
    video_recording: recordingEnabled,
    video_output_dir: videoOutputDir,
    cap_inference_fps: settings.cap_inference_fps ?? true
  }
}
