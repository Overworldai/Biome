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
  sceneEditEnabled?: boolean
}

export const buildStreamingLifecycleSyncPayload = (
  args: BuildStreamingLifecycleSyncPayloadArgs
): StreamingLifecycleSyncPayload => {
  // Encode scene_edit_enabled into the model key so toggling it triggers
  // the same intentional-reconnect flow as switching models.
  const baseModel = args.engineModel || DEFAULT_WORLD_ENGINE_MODEL
  const selectedModel = args.sceneEditEnabled ? `${baseModel}+scene_edit` : baseModel

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
    isPaused: args.isPaused
  }
}
