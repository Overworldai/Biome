import { PORTAL_STATES, type PortalState } from './portalStateMachine'

const ACTIVE_CONNECTION_STATES = new Set(['connecting', 'connected'])
const FAILURE_CONNECTION_STATES = new Set(['disconnected', 'error'])

export const STREAMING_LIFECYCLE_EVENT = {
  SYNC: 'sync'
} as const

export type StreamingLifecycleEffects = {
  warmFailureError: string | null
  connectionLost: boolean
  clearConnectionLost: boolean
  engineErrorDismissed: boolean
  startIntentionalReconnect: boolean
  transitionToWarmAfterIntentionalDisconnect: boolean
  clearEngineErrorOnWarmEntry: boolean
  runWarmConnection: boolean
  transitionToHot: boolean
  transitionToStreaming: boolean
  teardownForInactivePortalState: boolean
  requestPointerLockOnStreamStart: boolean
  resumeOnPointerLock: boolean
  pauseOnPointerUnlock: boolean
  suppressedIntentionalWarmError: boolean
  suppressedIntentionalConnectionLost: boolean
}

const emptyEffects = (): StreamingLifecycleEffects => ({
  warmFailureError: null,
  connectionLost: false,
  clearConnectionLost: false,
  engineErrorDismissed: false,
  startIntentionalReconnect: false,
  transitionToWarmAfterIntentionalDisconnect: false,
  clearEngineErrorOnWarmEntry: false,
  runWarmConnection: false,
  transitionToHot: false,
  transitionToStreaming: false,
  teardownForInactivePortalState: false,
  requestPointerLockOnStreamStart: false,
  resumeOnPointerLock: false,
  pauseOnPointerUnlock: false,
  suppressedIntentionalWarmError: false,
  suppressedIntentionalConnectionLost: false
})

export type StreamingLifecycleState = {
  warmAttempted: boolean
  wasConnectedInActiveStreamState: boolean
  hadEngineError: boolean
  intentionalReconnectInProgress: boolean
  warmTransitionRequestedForIntentionalReconnect: boolean
  hotTransitionRequested: boolean
  streamingTransitionRequested: boolean
  streamPointerLockRequested: boolean
  warmConnectionRequestSeq: number
  lastPortalState: PortalState | null
  lastTeardownPortalState: PortalState | null
  effects: StreamingLifecycleEffects
}

export const initialStreamingLifecycleState: StreamingLifecycleState = {
  warmAttempted: false,
  wasConnectedInActiveStreamState: false,
  hadEngineError: false,
  intentionalReconnectInProgress: false,
  warmTransitionRequestedForIntentionalReconnect: false,
  hotTransitionRequested: false,
  streamingTransitionRequested: false,
  streamPointerLockRequested: false,
  warmConnectionRequestSeq: 0,
  lastPortalState: null,
  lastTeardownPortalState: null,
  effects: emptyEffects()
}

export type StreamingLifecycleSyncPayload = {
  portalState: PortalState
  connectionState: string
  transportError: string | null
  selectedModel: string
  lastAppliedModel: string | null
  engineError: string | null
  statusCode: string | null
  hasReceivedFrame: boolean
  canvasReady: boolean
  portalConnected: boolean
  portalExpanded: boolean
  socketReady: boolean
  isPointerLocked: boolean
  settingsOpen: boolean
  isPaused: boolean
}

export type StreamingLifecycleEvent = {
  type: (typeof STREAMING_LIFECYCLE_EVENT)[keyof typeof STREAMING_LIFECYCLE_EVENT]
  payload: StreamingLifecycleSyncPayload
}

export const streamingLifecycleReducer = (
  state: StreamingLifecycleState,
  event: StreamingLifecycleEvent
): StreamingLifecycleState => {
  if (event.type !== STREAMING_LIFECYCLE_EVENT.SYNC) return state

  const {
    portalState,
    connectionState,
    transportError,
    selectedModel,
    lastAppliedModel,
    engineError,
    statusCode,
    hasReceivedFrame,
    canvasReady,
    portalConnected,
    portalExpanded,
    socketReady,
    isPointerLocked,
    settingsOpen,
    isPaused
  } = event.payload

  const next: StreamingLifecycleState = {
    ...state,
    effects: emptyEffects()
  }

  const inWarmState = portalState === PORTAL_STATES.WARM
  const inHotState = portalState === PORTAL_STATES.HOT
  const inStreamingState = portalState === PORTAL_STATES.STREAMING
  const inSessionPortalState = inWarmState || inHotState || inStreamingState
  const inActiveStreamingState = inHotState || portalState === PORTAL_STATES.STREAMING
  const inColdState = portalState === PORTAL_STATES.COLD

  const shouldIntentionalReconnect =
    inStreamingState && connectionState === 'connected' && selectedModel !== lastAppliedModel

  const enteredWarm = inWarmState && state.lastPortalState !== PORTAL_STATES.WARM
  if (enteredWarm) {
    next.warmConnectionRequestSeq = state.warmConnectionRequestSeq + 1
    next.effects.clearEngineErrorOnWarmEntry = true
    next.effects.runWarmConnection = true
  }

  if (shouldIntentionalReconnect && !next.intentionalReconnectInProgress) {
    next.intentionalReconnectInProgress = true
    next.warmTransitionRequestedForIntentionalReconnect = false
    next.effects.startIntentionalReconnect = true
  }

  if (!next.intentionalReconnectInProgress) {
    next.warmTransitionRequestedForIntentionalReconnect = false
  }

  if (
    next.intentionalReconnectInProgress &&
    inStreamingState &&
    connectionState === 'disconnected' &&
    !next.warmTransitionRequestedForIntentionalReconnect
  ) {
    next.effects.transitionToWarmAfterIntentionalDisconnect = true
    next.warmTransitionRequestedForIntentionalReconnect = true
  }

  if (!inWarmState) {
    next.hotTransitionRequested = false
  }
  if (!inHotState) {
    next.streamingTransitionRequested = false
  }
  if (!inStreamingState) {
    next.streamPointerLockRequested = false
  }

  if (inSessionPortalState) {
    next.lastTeardownPortalState = null
  } else if (next.lastTeardownPortalState !== portalState) {
    next.effects.teardownForInactivePortalState = true
    next.lastTeardownPortalState = portalState
  }

  const canTransitionToHot =
    inWarmState && connectionState === 'connected' && statusCode === 'ready' && hasReceivedFrame && canvasReady

  if (canTransitionToHot && !next.hotTransitionRequested) {
    next.effects.transitionToHot = true
    next.hotTransitionRequested = true
  }

  const canTransitionToStreaming =
    inHotState &&
    connectionState === 'connected' &&
    statusCode === 'ready' &&
    portalConnected &&
    portalExpanded &&
    socketReady

  if (canTransitionToStreaming && !next.streamingTransitionRequested) {
    next.effects.transitionToStreaming = true
    next.streamingTransitionRequested = true
  }

  const streamingReady = inStreamingState && socketReady
  if (streamingReady && !next.streamPointerLockRequested) {
    next.effects.requestPointerLockOnStreamStart = true
    next.streamPointerLockRequested = true
  }

  if (streamingReady && isPointerLocked && (settingsOpen || isPaused)) {
    next.effects.resumeOnPointerLock = true
  } else if (streamingReady && !isPointerLocked && !settingsOpen && !isPaused) {
    next.effects.pauseOnPointerUnlock = true
  }

  if (inWarmState && connectionState === 'connecting') {
    next.warmAttempted = true
  }

  if (inWarmState && next.warmAttempted && FAILURE_CONNECTION_STATES.has(connectionState)) {
    if (next.intentionalReconnectInProgress) {
      next.effects.suppressedIntentionalWarmError = true
    } else {
      const isError = connectionState === 'error'
      next.effects.warmFailureError =
        transportError ||
        (isError ? 'Connection failed - server may have crashed' : 'Connection lost - server may have crashed')
    }
    next.warmAttempted = false
  }

  if (inActiveStreamingState && ACTIVE_CONNECTION_STATES.has(connectionState)) {
    next.wasConnectedInActiveStreamState = true
  }

  if (
    next.wasConnectedInActiveStreamState &&
    inActiveStreamingState &&
    FAILURE_CONNECTION_STATES.has(connectionState)
  ) {
    if (next.intentionalReconnectInProgress) {
      next.effects.suppressedIntentionalConnectionLost = true
    } else {
      next.effects.connectionLost = true
    }
  }

  if (inColdState) {
    next.warmAttempted = false
    next.wasConnectedInActiveStreamState = false
    next.intentionalReconnectInProgress = false
    next.warmTransitionRequestedForIntentionalReconnect = false
    next.effects.clearConnectionLost = true
  }

  if (inWarmState && connectionState === 'connected' && next.intentionalReconnectInProgress) {
    next.intentionalReconnectInProgress = false
    next.warmTransitionRequestedForIntentionalReconnect = false
  }

  if (engineError) {
    next.hadEngineError = true
  } else if (next.hadEngineError) {
    next.hadEngineError = false
    next.effects.engineErrorDismissed = true
  }

  next.lastPortalState = portalState

  return next
}
