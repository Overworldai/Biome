import { DEFAULT_WORLD_ENGINE_MODEL } from '../hooks/useConfig'
import type { StreamingLifecycleEffects, StreamingLifecycleState } from './streamingLifecycleMachine'

export const LIFECYCLE_EFFECT_ORDER: Array<keyof StreamingLifecycleEffects> = [
  'suppressedIntentionalWarmError',
  'warmFailureError',
  'clearEngineErrorOnWarmEntry',
  'runWarmConnection',
  'startIntentionalReconnect',
  'transitionToWarmAfterIntentionalDisconnect',
  'transitionToHot',
  'transitionToStreaming',
  'teardownForInactivePortalState',
  'requestPointerLockOnStreamStart',
  'resumeOnPointerLock',
  'pauseOnPointerUnlock',
  'engineErrorDismissed',
  'suppressedIntentionalConnectionLost',
  'connectionLost',
  'clearConnectionLost'
]

type PortalStatesLike = {
  COLD: string
  WARM: string
  HOT: string
  STREAMING: string
}

type CreateHandlersArgs = {
  log: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
  lifecycleState: StreamingLifecycleState
  config: { features?: { world_engine_model?: string | null } } | null
  setEngineError: (value: string | null) => void
  setWarmConnectionJobSeq: (value: number) => void
  warmBootstrapSentRef: { current: boolean }
  setConnectionLost: (value: boolean) => void
  setSettingsOpen: (value: boolean) => void
  setIsPaused: (value: boolean) => void
  setPausedAt: (value: number | null) => void
  disconnect: () => void
  transitionTo: (state: string) => void
  states: PortalStatesLike
  lastAppliedModelRef: { current: string | null }
  exitPointerLock: () => void
  requestPointerLock: () => void
  sendPause: (paused: boolean) => void
}

type LifecycleEffectHandlers = {
  [K in keyof StreamingLifecycleEffects]?: (effectValue: StreamingLifecycleEffects[K]) => void
}

export const createStreamingLifecycleEffectHandlers = ({
  log,
  lifecycleState,
  config,
  setEngineError,
  setWarmConnectionJobSeq,
  warmBootstrapSentRef,
  setConnectionLost,
  setSettingsOpen,
  setIsPaused,
  setPausedAt,
  disconnect,
  transitionTo,
  states,
  lastAppliedModelRef,
  exitPointerLock,
  requestPointerLock,
  sendPause
}: CreateHandlersArgs): LifecycleEffectHandlers => {
  return {
    suppressedIntentionalWarmError: () => {
      log.info('Intentional reconnect in WARM state - suppressing engine error')
    },
    warmFailureError: (errorMsg) => {
      log.error('Connection error during WARM state')
      setEngineError(errorMsg)
    },
    clearEngineErrorOnWarmEntry: () => setEngineError(null),
    runWarmConnection: () => setWarmConnectionJobSeq(lifecycleState.warmConnectionRequestSeq),
    startIntentionalReconnect: () => {
      const selectedModel = config?.features?.world_engine_model || DEFAULT_WORLD_ENGINE_MODEL
      log.info('Model changed in settings while streaming - reconnecting to start a fresh session:', selectedModel)
      warmBootstrapSentRef.current = false
      setConnectionLost(false)
      setSettingsOpen(false)
      setIsPaused(false)
      setPausedAt(null)
      disconnect()
    },
    transitionToWarmAfterIntentionalDisconnect: () => {
      log.info('Model switch disconnect complete - transitioning to WARM')
      transitionTo(states.WARM)
    },
    transitionToHot: () => {
      log.info('First frame received - transitioning to HOT')
      transitionTo(states.HOT)
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
    requestPointerLockOnStreamStart: () => {
      log.info('Auto-requesting pointer lock on stream start')
      requestPointerLock()
    },
    resumeOnPointerLock: () => {
      setSettingsOpen(false)
      setIsPaused(false)
      setPausedAt(null)
      sendPause(false)
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
      log.info('Error dismissed - transitioning to COLD')
      transitionTo(states.COLD)
    },
    suppressedIntentionalConnectionLost: () => {
      log.info('Intentional reconnect in progress - suppressing connection lost overlay')
    },
    connectionLost: () => {
      log.info('Connection lost detected')
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
