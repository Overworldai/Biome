import { PORTAL_STATES, type PortalState } from './portalStateMachine'

const ACTIVE_CONNECTION_STATES = new Set(['connecting', 'connected'])
const FAILURE_CONNECTION_STATES = new Set(['disconnected', 'error'])

export const STREAMING_LIFECYCLE_EVENT = {
  SYNC: 'sync'
} as const

export type StreamingLifecycleEffects = {
  loadingFailureError: string | null
  transitionToMainMenuOnLoadingFailure: boolean
  connectionLost: boolean
  clearConnectionLost: boolean
  engineErrorDismissed: boolean
  startIntentionalReconnect: boolean
  transitionToLoadingAfterIntentionalDisconnect: boolean
  clearEngineErrorOnLoadingEntry: boolean
  runLoadingConnection: boolean
  transitionToStreaming: boolean
  teardownForInactivePortalState: boolean
  requestPointerLockOnStreamStart: boolean
  resumeOnPointerLock: boolean
  pauseOnPointerUnlock: boolean
  suppressedIntentionalWarmError: boolean
  suppressedIntentionalConnectionLost: boolean
}

const emptyEffects = (): StreamingLifecycleEffects => ({
  loadingFailureError: null,
  transitionToMainMenuOnLoadingFailure: false,
  connectionLost: false,
  clearConnectionLost: false,
  engineErrorDismissed: false,
  startIntentionalReconnect: false,
  transitionToLoadingAfterIntentionalDisconnect: false,
  clearEngineErrorOnLoadingEntry: false,
  runLoadingConnection: false,
  transitionToStreaming: false,
  teardownForInactivePortalState: false,
  requestPointerLockOnStreamStart: false,
  resumeOnPointerLock: false,
  pauseOnPointerUnlock: false,
  suppressedIntentionalWarmError: false,
  suppressedIntentionalConnectionLost: false
})

export type StreamingLifecycleState = {
  loadingAttempted: boolean
  wasConnectedInStreamingState: boolean
  hadEngineError: boolean
  intentionalReconnectInProgress: boolean
  loadingTransitionRequestedForIntentionalReconnect: boolean
  streamingTransitionRequested: boolean
  streamPointerLockRequested: boolean
  loadingConnectionRequestSeq: number
  lastPortalState: PortalState | null
  lastTeardownPortalState: PortalState | null
  effects: StreamingLifecycleEffects
}

export const initialStreamingLifecycleState: StreamingLifecycleState = {
  loadingAttempted: false,
  wasConnectedInStreamingState: false,
  hadEngineError: false,
  intentionalReconnectInProgress: false,
  loadingTransitionRequestedForIntentionalReconnect: false,
  streamingTransitionRequested: false,
  streamPointerLockRequested: false,
  loadingConnectionRequestSeq: 0,
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
    socketReady,
    isPointerLocked,
    settingsOpen,
    isPaused
  } = event.payload

  const next: StreamingLifecycleState = {
    ...state,
    effects: emptyEffects()
  }

  const inMainMenuState = portalState === PORTAL_STATES.MAIN_MENU
  const inLoadingState = portalState === PORTAL_STATES.LOADING
  const inStreamingState = portalState === PORTAL_STATES.STREAMING
  const inSessionPortalState = inLoadingState || inStreamingState

  const shouldIntentionalReconnect =
    inStreamingState && connectionState === 'connected' && selectedModel !== lastAppliedModel

  const enteredLoading = inLoadingState && state.lastPortalState !== PORTAL_STATES.LOADING
  if (enteredLoading) {
    next.loadingConnectionRequestSeq = state.loadingConnectionRequestSeq + 1
    next.effects.clearEngineErrorOnLoadingEntry = true
    next.effects.runLoadingConnection = true
  }

  if (shouldIntentionalReconnect && !next.intentionalReconnectInProgress) {
    next.intentionalReconnectInProgress = true
    next.loadingTransitionRequestedForIntentionalReconnect = false
    next.effects.startIntentionalReconnect = true
  }

  if (!next.intentionalReconnectInProgress) {
    next.loadingTransitionRequestedForIntentionalReconnect = false
  }

  if (
    next.intentionalReconnectInProgress &&
    inStreamingState &&
    connectionState === 'disconnected' &&
    !next.loadingTransitionRequestedForIntentionalReconnect
  ) {
    next.effects.transitionToLoadingAfterIntentionalDisconnect = true
    next.loadingTransitionRequestedForIntentionalReconnect = true
  }
  if (!inLoadingState) {
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

  const canTransitionToStreaming =
    inLoadingState && connectionState === 'connected' && statusCode === 'ready' && socketReady

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

  if (inLoadingState && connectionState === 'connecting') {
    next.loadingAttempted = true
  }

  if (inLoadingState && next.loadingAttempted && FAILURE_CONNECTION_STATES.has(connectionState)) {
    if (next.intentionalReconnectInProgress) {
      next.effects.suppressedIntentionalWarmError = true
    } else {
      const isError = connectionState === 'error'
      next.effects.loadingFailureError =
        transportError ||
        (isError ? 'Connection failed - server may have crashed' : 'Connection lost - server may have crashed')
    }
    next.loadingAttempted = false
  }

  if (inStreamingState && ACTIVE_CONNECTION_STATES.has(connectionState)) {
    next.wasConnectedInStreamingState = true
  }

  if (next.wasConnectedInStreamingState && inStreamingState && FAILURE_CONNECTION_STATES.has(connectionState)) {
    if (next.intentionalReconnectInProgress) {
      next.effects.suppressedIntentionalConnectionLost = true
    } else {
      next.effects.connectionLost = true
    }
  }

  if (inMainMenuState) {
    next.loadingAttempted = false
    next.wasConnectedInStreamingState = false
    next.intentionalReconnectInProgress = false
    next.loadingTransitionRequestedForIntentionalReconnect = false
    next.effects.clearConnectionLost = true
  }

  if (inLoadingState && connectionState === 'connected' && next.intentionalReconnectInProgress) {
    next.intentionalReconnectInProgress = false
    next.loadingTransitionRequestedForIntentionalReconnect = false
  }

  if (engineError) {
    next.hadEngineError = true
  } else if (next.hadEngineError) {
    next.hadEngineError = false
    // Engine error being cleared (including on loading re-entry) should not force
    // navigation away from the current screen.
    next.effects.engineErrorDismissed = false
  }

  next.lastPortalState = portalState

  return next
}
