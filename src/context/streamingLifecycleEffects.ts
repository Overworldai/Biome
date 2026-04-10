import { DEFAULT_WORLD_ENGINE_MODEL } from '../types/settings'
import { TranslatableError } from '../i18n'
import type { StreamingLifecycleEffects, StreamingLifecycleState } from './streamingLifecycleMachine'
import type { PortalState } from './portalStateMachine'

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
  lifecycleState: StreamingLifecycleState
  settings: { engine_model?: string | null } | null
  setEngineError: (value: TranslatableError | null) => void
  setWarmConnectionJobSeq: (value: number) => void
  warmBootstrapSentRef: { current: boolean }
  warmFlowCancelledRef: { current: boolean }
  setConnectionLost: (value: boolean) => void
  setSettingsOpen: (value: boolean) => void
  setIsPaused: (value: boolean) => void
  setPausedAt: (value: number | null) => void
  disconnect: () => void
  transitionTo: (state: PortalState) => void | Promise<boolean>
  states: PortalStatesLike
  lastAppliedModelRef: { current: string | null }
  exitPointerLock: () => void
  sendPause: (paused: boolean) => void
  resume: () => void
}

type LifecycleEffectHandlers = {
  [K in keyof StreamingLifecycleEffects]?: (effectValue: StreamingLifecycleEffects[K]) => void
}

export const createStreamingLifecycleEffectHandlers = ({
  log,
  lifecycleState,
  settings,
  setEngineError,
  setWarmConnectionJobSeq,
  warmBootstrapSentRef,
  warmFlowCancelledRef,
  setConnectionLost,
  setSettingsOpen,
  setIsPaused,
  setPausedAt,
  disconnect,
  transitionTo,
  states,
  lastAppliedModelRef,
  exitPointerLock,
  sendPause,
  resume
}: CreateHandlersArgs): LifecycleEffectHandlers => {
  return {
    suppressedIntentionalWarmError: () => {
      log.info('Intentional reconnect in loading state - suppressing engine error')
    },
    loadingFailureError: (info) => {
      if (warmFlowCancelledRef.current) return
      log.error('Connection error during loading state:', info)
      if (info) {
        if ('key' in info) {
          setEngineError(new TranslatableError(info.key))
        } else {
          setEngineError(new TranslatableError('app.server.fallbackError', { message: info.transportError }))
        }
      }
    },
    clearEngineErrorOnLoadingEntry: () => setEngineError(null),
    runLoadingConnection: () => setWarmConnectionJobSeq(lifecycleState.loadingConnectionRequestSeq),
    startIntentionalReconnect: () => {
      const selectedModel = settings?.engine_model || DEFAULT_WORLD_ENGINE_MODEL
      log.info('Model changed in settings while streaming - reconnecting to start a fresh session:', selectedModel)
      warmBootstrapSentRef.current = false
      setConnectionLost(false)
      setSettingsOpen(false)
      setIsPaused(false)
      setPausedAt(null)
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
      warmBootstrapSentRef.current = false
      lastAppliedModelRef.current = null
      exitPointerLock()
      setSettingsOpen(false)
      setIsPaused(false)
      setPausedAt(null)
    },
    resumeOnPointerLock: () => {
      resume()
      log.info('Pointer locked - settings closed, resumed')
    },
    pauseOnPointerUnlock: () => {
      setSettingsOpen(true)
      setIsPaused(true)
      setPausedAt(Date.now())
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
