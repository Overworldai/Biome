import { DEFAULT_WORLD_ENGINE_MODEL } from '../types/settings'
import type { TranslatableError } from '../i18n'
import type { PortalState } from './portalStateMachine'
import type { StreamingLifecycleSyncPayload } from './streamingLifecycleMachine'

type BuildStreamingLifecycleSyncPayloadArgs = {
  portalState: PortalState
  connectionState: string
  transportError: string | null
  engineModel?: string | null
  lastAppliedModel: string | null
  engineError: TranslatableError | null
  hasReceivedFrame: boolean
  socketReady: boolean
  isPointerLocked: boolean
  settingsOpen: boolean
  isPaused: boolean
  sceneEditActive: boolean
  sceneEditEnabled?: boolean
  engineQuant?: string
  cpuOffload?: boolean
}

export const buildStreamingLifecycleSyncPayload = (
  args: BuildStreamingLifecycleSyncPayloadArgs
): StreamingLifecycleSyncPayload => {
  // Encode scene_edit_enabled, quant, and cpu_offload into the model key so
  // toggling any of them triggers the same intentional-reconnect flow as
  // switching models.
  const baseModel = args.engineModel || DEFAULT_WORLD_ENGINE_MODEL
  const quant = args.engineQuant ?? 'none'
  let selectedModel = args.sceneEditEnabled ? `${baseModel}+scene_edit` : baseModel
  selectedModel = `${selectedModel}+${quant}+cpu${args.cpuOffload ? '1' : '0'}`

  return {
    portalState: args.portalState,
    connectionState: args.connectionState,
    transportError: args.transportError,
    selectedModel,
    lastAppliedModel: args.lastAppliedModel,
    engineError: args.engineError,
    hasReceivedFrame: args.hasReceivedFrame,
    socketReady: args.socketReady,
    isPointerLocked: args.isPointerLocked,
    settingsOpen: args.settingsOpen,
    isPaused: args.isPaused,
    sceneEditActive: args.sceneEditActive
  }
}
