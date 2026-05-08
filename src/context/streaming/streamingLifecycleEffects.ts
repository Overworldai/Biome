import { TranslatableError } from '../../i18n'
import type { StreamingLifecycleEffects } from './streamingLifecycleMachine'
import type { PortalState } from '../portal/portalStateMachine'

export const LIFECYCLE_EFFECT_ORDER: Array<keyof StreamingLifecycleEffects> = [
  'suppressedIntentionalWarmError',
  'loadingFailureError',
  'clearEngineErrorOnLoadingEntry',
  'runLoadingConnection',
  'startIntentionalReconnect',
  'transitionToLoadingAfterIntentionalDisconnect',
  'transitionToStreaming',
  'teardownForInactivePortalState',
  'resumeOnPointerLock',
  'pauseOnPointerUnlock',
  'engineErrorDismissed',
  'suppressedIntentionalConnectionLost',
  'connectionLost',
  'clearConnectionLost'
]

type PortalStatesLike = {
  MAIN_MENU: PortalState
  LOADING: PortalState
  STREAMING: PortalState
}

type CreateHandlersArgs = {
  log: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
  setEngineError: (value: TranslatableError | null) => void
  /** Clears `warmBootstrapSent` + `lastAppliedSession`; used when the
   *  reducer needs the next LOADING entry to start from a clean
   *  bootstrap. */
  resetSession: () => void
  /** Triggers a fresh warm-connection attempt. */
  runWarmConnection: () => void
  /** Reads the warm-connection flow's cancellation state. The
   *  loadingFailureError handler suppresses error reporting while
   *  cancelled so a torn-down flow's late errors don't pollute the UI. */
  isWarmFlowCancelled: () => boolean
  setConnectionLost: (value: boolean) => void
  setSettingsOpen: (value: boolean) => void
  pauseSession: () => void
  resumeSession: () => void
  disconnect: () => void
  transitionTo: (state: PortalState) => void | Promise<boolean>
  states: PortalStatesLike
  exitPointerLock: () => void
  sendPause: (paused: boolean) => void
  resume: () => void
}

type LifecycleEffectHandlers = {
  [K in keyof StreamingLifecycleEffects]?: (effectValue: StreamingLifecycleEffects[K]) => void
}

export const createStreamingLifecycleEffectHandlers = ({
  log,
  setEngineError,
  resetSession,
  runWarmConnection,
  isWarmFlowCancelled,
  setConnectionLost,
  setSettingsOpen,
  pauseSession,
  resumeSession,
  disconnect,
  transitionTo,
  states,
  exitPointerLock,
  sendPause,
  resume
}: CreateHandlersArgs): LifecycleEffectHandlers => {
  return {
    suppressedIntentionalWarmError: () => {
      log.info('Intentional reconnect in loading state - suppressing engine error')
    },
    loadingFailureError: (info) => {
      if (isWarmFlowCancelled()) return
      log.error('Connection error during loading state:', info)
      if (info) {
        if ('key' in info) {
          setEngineError(new TranslatableError(info.key))
        } else {
          // transportError is already a TranslatableError — pass it through
          // without re-wrapping (would add a duplicate "Server error:" prefix).
          setEngineError(info.transportError)
        }
      }
    },
    clearEngineErrorOnLoadingEntry: () => setEngineError(null),
    runLoadingConnection: () => runWarmConnection(),
    startIntentionalReconnect: () => {
      log.info('Engine settings changed while streaming - reconnecting to start a fresh session')
      resetSession()
      setConnectionLost(false)
      setSettingsOpen(false)
      resumeSession()
      disconnect()
    },
    transitionToLoadingAfterIntentionalDisconnect: () => {
      log.info('Model switch disconnect complete - transitioning to loading')
      transitionTo(states.LOADING)
    },
    transitionToStreaming: () => {
      log.info('Fully ready - transitioning to STREAMING')
      transitionTo(states.STREAMING)
    },
    teardownForInactivePortalState: () => {
      disconnect()
      resetSession()
      exitPointerLock()
      setSettingsOpen(false)
      resumeSession()
    },
    resumeOnPointerLock: () => {
      resume()
      log.info('Pointer locked - settings closed, resumed')
    },
    pauseOnPointerUnlock: () => {
      setSettingsOpen(true)
      pauseSession()
      sendPause(true)
      log.info('Pointer unlocked - settings opened, paused')
    },
    engineErrorDismissed: () => {
      log.info('Engine error cleared')
    },
    suppressedIntentionalConnectionLost: () => {
      log.info('Intentional reconnect in progress - suppressing connection lost overlay')
    },
    connectionLost: () => {
      log.info('Connection lost detected')
      exitPointerLock()
      setConnectionLost(true)
    },
    clearConnectionLost: () => setConnectionLost(false)
  }
}

export const runStreamingLifecycleEffects = ({
  effects,
  handlers
}: {
  effects: StreamingLifecycleEffects
  handlers: LifecycleEffectHandlers
}) => {
  for (const effectName of LIFECYCLE_EFFECT_ORDER) {
    const effectValue = effects[effectName]
    if (!effectValue) continue
    handlers[effectName]?.(effectValue as never)
  }
}
