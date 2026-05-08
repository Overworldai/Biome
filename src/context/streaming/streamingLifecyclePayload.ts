import type { Settings } from '../../types/settings'
import type { ConnectionStatus } from '../../hooks/engine/useWebSocket'
import type { TranslatableError } from '../../i18n'
import type { PortalState } from '../portal/portalStateMachine'
import type { StreamingLifecycleSyncPayload } from './streamingLifecycleMachine'
import { getRestartSignatures, type RestartSignatures } from '../../utils/settingsClassifier'

type BuildStreamingLifecycleSyncPayloadArgs = {
  portalState: PortalState
  connectionStatus: ConnectionStatus
  settings: Settings
  lastApplied: RestartSignatures | null
  engineError: TranslatableError | null
  hasReceivedFrame: boolean
  initCompleted: boolean
  isPointerLocked: boolean
  settingsOpen: boolean
  isPaused: boolean
  sceneEditActive: boolean
}

export const buildStreamingLifecycleSyncPayload = (
  args: BuildStreamingLifecycleSyncPayloadArgs
): StreamingLifecycleSyncPayload => {
  return {
    portalState: args.portalState,
    connectionStatus: args.connectionStatus,
    currentSignatures: getRestartSignatures(args.settings),
    lastAppliedSignatures: args.lastApplied,
    engineError: args.engineError,
    hasReceivedFrame: args.hasReceivedFrame,
    initCompleted: args.initCompleted,
    isPointerLocked: args.isPointerLocked,
    settingsOpen: args.settingsOpen,
    isPaused: args.isPaused,
    sceneEditActive: args.sceneEditActive
  }
}
