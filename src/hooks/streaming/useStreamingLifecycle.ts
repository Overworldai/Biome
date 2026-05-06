import { useEffect, useReducer } from 'react'
import { buildStreamingLifecycleSyncPayload } from '../../context/streaming/streamingLifecyclePayload'
import {
  createStreamingLifecycleEffectHandlers,
  runStreamingLifecycleEffects
} from '../../context/streaming/streamingLifecycleEffects'
import {
  initialStreamingLifecycleState,
  STREAMING_LIFECYCLE_EVENT,
  streamingLifecycleReducer
} from '../../context/streaming/streamingLifecycleMachine'
import type { ConnectionStatus } from '../engine/useWebSocket'
import type { PortalState } from '../../context/portal/portalStateMachine'
import type { TranslatableError } from '../../i18n'
import type { Settings } from '../../types/settings'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/Lifecycle')

type PortalStates = { MAIN_MENU: PortalState; LOADING: PortalState; STREAMING: PortalState }

/** Drives the streaming lifecycle reducer + its side-effects. The
 *  reducer takes a snapshot of "everything the lifecycle needs to make
 *  decisions" each render and emits an `effects` bag describing what
 *  to do (transition portals, start an intentional reconnect, surface
 *  a connection-lost error, etc.); the effect handlers turn those
 *  effect flags into the imperative writes against the surrounding
 *  state.
 *
 *  Returns the live `lifecycleState` so consumers (notably
 *  `useWarmConnection`) can read its `loadingConnectionRequestSeq` and
 *  re-run their own work when the reducer bumps it. */
export function useStreamingLifecycle(opts: {
  // Payload inputs
  portalState: PortalState
  connectionStatus: ConnectionStatus
  engineModel: string | null | undefined
  engineQuant: string | undefined
  sceneAuthoringEnabled: boolean | undefined
  lastAppliedModel: string | null
  engineError: TranslatableError | null
  hasReceivedFrame: boolean
  initCompleted: boolean
  isPointerLocked: boolean
  settingsOpen: boolean
  isPaused: boolean
  sceneEditActive: boolean

  // Handler inputs
  states: PortalStates
  settings: Settings
  setEngineError: (err: TranslatableError | null) => void
  resetSession: () => void
  runWarmConnection: () => void
  isWarmFlowCancelled: () => boolean
  setConnectionLost: (value: boolean) => void
  setSettingsOpen: (value: boolean) => void
  pauseSession: () => void
  resumeSession: () => void
  disconnect: () => void
  transitionTo: (state: PortalState) => void | Promise<boolean>
  exitPointerLock: () => void
  sendPause: (paused: boolean) => void
  resume: () => void
}): void {
  const [lifecycleState, dispatchLifecycle] = useReducer(streamingLifecycleReducer, initialStreamingLifecycleState)

  // Sync the reducer with current state on every relevant change.
  useEffect(() => {
    dispatchLifecycle({
      type: STREAMING_LIFECYCLE_EVENT.SYNC,
      payload: buildStreamingLifecycleSyncPayload({
        portalState: opts.portalState,
        connectionStatus: opts.connectionStatus,
        engineModel: opts.engineModel,
        lastAppliedModel: opts.lastAppliedModel,
        engineError: opts.engineError,
        hasReceivedFrame: opts.hasReceivedFrame,
        initCompleted: opts.initCompleted,
        isPointerLocked: opts.isPointerLocked,
        settingsOpen: opts.settingsOpen,
        isPaused: opts.isPaused,
        sceneEditActive: opts.sceneEditActive,
        sceneAuthoringEnabled: opts.sceneAuthoringEnabled,
        engineQuant: opts.engineQuant
      })
    })
  }, [
    opts.portalState,
    opts.connectionStatus,
    opts.engineModel,
    opts.engineQuant,
    opts.sceneAuthoringEnabled,
    opts.engineError,
    opts.hasReceivedFrame,
    opts.initCompleted,
    opts.isPointerLocked,
    opts.settingsOpen,
    opts.isPaused,
    opts.sceneEditActive,
    opts.lastAppliedModel
  ])

  // Run the effects emitted by the latest reducer pass.
  useEffect(() => {
    const handlers = createStreamingLifecycleEffectHandlers({
      log,
      settings: opts.settings,
      setEngineError: opts.setEngineError,
      resetSession: opts.resetSession,
      runWarmConnection: opts.runWarmConnection,
      isWarmFlowCancelled: opts.isWarmFlowCancelled,
      setConnectionLost: opts.setConnectionLost,
      setSettingsOpen: opts.setSettingsOpen,
      pauseSession: opts.pauseSession,
      resumeSession: opts.resumeSession,
      disconnect: opts.disconnect,
      transitionTo: opts.transitionTo,
      states: opts.states,
      exitPointerLock: opts.exitPointerLock,
      sendPause: opts.sendPause,
      resume: opts.resume
    })
    runStreamingLifecycleEffects({ effects: lifecycleState.effects, handlers })
    // Handlers are rebuilt every render, but the `effects` bag is what
    // actually decides whether anything fires — this effect re-runs only
    // when the lifecycle state transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecycleState])
}
