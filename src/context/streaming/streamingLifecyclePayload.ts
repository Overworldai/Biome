import { DEFAULT_WORLD_ENGINE_MODEL } from '../../types/settings'
import type { ConnectionStatus } from '../../hooks/engine/useWebSocket'
import type { TranslatableError } from '../../i18n'
import type { PortalState } from '../portal/portalStateMachine'
import type { StreamingLifecycleSyncPayload } from './streamingLifecycleMachine'

type BuildStreamingLifecycleSyncPayloadArgs = {
  portalState: PortalState
  connectionStatus: ConnectionStatus
  engineModel?: string | null
  lastAppliedModel: string | null
  engineError: TranslatableError | null
  hasReceivedFrame: boolean
  initCompleted: boolean
  isPointerLocked: boolean
  settingsOpen: boolean
  isPaused: boolean
  sceneEditActive: boolean
  sceneAuthoringEnabled?: boolean
  engineQuant?: string
}

export const buildStreamingLifecycleSyncPayload = (
  args: BuildStreamingLifecycleSyncPayloadArgs
): StreamingLifecycleSyncPayload => {
  // Encode scene_authoring_enabled and quant into the model key so toggling
  // either triggers the same intentional-reconnect flow as switching models.
  const baseModel = args.engineModel || DEFAULT_WORLD_ENGINE_MODEL
  const quant = args.engineQuant ?? 'none'
  let selectedModel = args.sceneAuthoringEnabled ? `${baseModel}+scene_authoring` : baseModel
  selectedModel = `${selectedModel}+${quant}`

  return {
    portalState: args.portalState,
    connectionStatus: args.connectionStatus,
    selectedModel,
    lastAppliedModel: args.lastAppliedModel,
    engineError: args.engineError,
    hasReceivedFrame: args.hasReceivedFrame,
    initCompleted: args.initCompleted,
    isPointerLocked: args.isPointerLocked,
    settingsOpen: args.settingsOpen,
    isPaused: args.isPaused,
    sceneEditActive: args.sceneEditActive
  }
}
