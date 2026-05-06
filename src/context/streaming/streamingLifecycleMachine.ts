import { PORTAL_STATES, type PortalState } from '../portal/portalStateMachine'
import type { ConnectionStatus } from '../../hooks/engine/useWebSocket'
import type { TranslatableError, TranslationKey } from '../../i18n'

const isActiveConnection = (s: ConnectionStatus): boolean =>
  s.kind === 'connecting' || s.kind === 'loading' || s.kind === 'ready'
const isFailedConnection = (s: ConnectionStatus): boolean => s.kind === 'idle' || s.kind === 'error'

export const STREAMING_LIFECYCLE_EVENT = {
  SYNC: 'sync'
} as const

export type StreamingLifecycleEffects = {
  loadingFailureError: { transportError: TranslatableError } | { key: TranslationKey } | null
  connectionLost: boolean
  clearConnectionLost: boolean
  engineErrorDismissed: boolean
  startIntentionalReconnect: boolean
  transitionToLoadingAfterIntentionalDisconnect: boolean
  clearEngineErrorOnLoadingEntry: boolean
  runLoadingConnection: boolean
  transitionToStreaming: boolean
  teardownForInactivePortalState: boolean
  resumeOnPointerLock: boolean
  pauseOnPointerUnlock: boolean
  suppressedIntentionalWarmError: boolean
  suppressedIntentionalConnectionLost: boolean
}

const emptyEffects = (): StreamingLifecycleEffects => ({
  loadingFailureError: null,
  connectionLost: false,
  clearConnectionLost: false,
  engineErrorDismissed: false,
  startIntentionalReconnect: false,
  transitionToLoadingAfterIntentionalDisconnect: false,
  clearEngineErrorOnLoadingEntry: false,
  runLoadingConnection: false,
  transitionToStreaming: false,
  teardownForInactivePortalState: false,
  resumeOnPointerLock: false,
  pauseOnPointerUnlock: false,
  suppressedIntentionalWarmError: false,
  suppressedIntentionalConnectionLost: false
})

export type StreamingLifecycleState = {
  loadingAttempted: boolean
  wasConnectedInStreamingState: boolean
  connectionLostSignaled: boolean
  hadEngineError: boolean
  intentionalReconnectInProgress: boolean
  loadingTransitionRequestedForIntentionalReconnect: boolean
  streamingTransitionRequested: boolean
  loadingConnectionRequestSeq: number
  lastPortalState: PortalState | null
  lastTeardownPortalState: PortalState | null
  effects: StreamingLifecycleEffects
}

export const initialStreamingLifecycleState: StreamingLifecycleState = {
  loadingAttempted: false,
  wasConnectedInStreamingState: false,
  connectionLostSignaled: false,
  hadEngineError: false,
  intentionalReconnectInProgress: false,
  loadingTransitionRequestedForIntentionalReconnect: false,
  streamingTransitionRequested: false,
  loadingConnectionRequestSeq: 0,
  lastPortalState: null,
  lastTeardownPortalState: null,
  effects: emptyEffects()
}

export type StreamingLifecycleSyncPayload = {
  portalState: PortalState
  connectionStatus: ConnectionStatus
  selectedModel: string
  lastAppliedModel: string | null
  engineError: TranslatableError | null
  hasReceivedFrame: boolean
  initCompleted: boolean
  isPointerLocked: boolean
  settingsOpen: boolean
  isPaused: boolean
  sceneEditActive: boolean
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
    connectionStatus,
    selectedModel,
    lastAppliedModel,
    engineError,
    hasReceivedFrame,
    initCompleted,
    isPointerLocked,
    settingsOpen,
    isPaused,
    sceneEditActive
  } = event.payload

  const next: StreamingLifecycleState = {
    ...state,
    effects: emptyEffects()
  }

  const inMainMenuState = portalState === PORTAL_STATES.MAIN_MENU
  const inLoadingState = portalState === PORTAL_STATES.LOADING
  const inStreamingState = portalState === PORTAL_STATES.STREAMING
  const inSessionPortalState = inLoadingState || inStreamingState
  const socketOpen = connectionStatus.kind === 'loading' || connectionStatus.kind === 'ready'
  const socketReady = connectionStatus.kind === 'ready'

  const shouldIntentionalReconnect = inStreamingState && socketOpen && selectedModel !== lastAppliedModel

  const enteredLoading = inLoadingState && state.lastPortalState !== PORTAL_STATES.LOADING
  if (enteredLoading) {
    next.loadingConnectionRequestSeq = state.loadingConnectionRequestSeq + 1
    next.loadingAttempted = false
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
    connectionStatus.kind === 'idle' &&
    !next.loadingTransitionRequestedForIntentionalReconnect
  ) {
    next.effects.transitionToLoadingAfterIntentionalDisconnect = true
    next.loadingTransitionRequestedForIntentionalReconnect = true
  }
  if (!inLoadingState) {
    next.streamingTransitionRequested = false
  }
  if (inSessionPortalState) {
    next.lastTeardownPortalState = null
  } else if (next.lastTeardownPortalState !== portalState) {
    next.effects.teardownForInactivePortalState = true
    next.lastTeardownPortalState = portalState
  }

  // Wait for the init RPC response (`initCompleted`) as well as `session.ready`
  // + first frame.  The server sends the seed frame and session.ready stage
  // *before* the init response lands, so without this guard a crash between
  // session.ready and init response would transition us into STREAMING with
  // stale state (Overworldai/Biome#79 follow-up).
  const canTransitionToStreaming = inLoadingState && socketReady && hasReceivedFrame && initCompleted

  if (canTransitionToStreaming && !next.streamingTransitionRequested) {
    next.effects.transitionToStreaming = true
    next.streamingTransitionRequested = true
  }

  const streamingReady = inStreamingState && socketReady

  if (streamingReady && isPointerLocked && (settingsOpen || isPaused)) {
    next.effects.resumeOnPointerLock = true
  } else if (streamingReady && !isPointerLocked && !settingsOpen && !isPaused && !sceneEditActive) {
    next.effects.pauseOnPointerUnlock = true
  }

  if (inLoadingState && connectionStatus.kind === 'connecting') {
    next.loadingAttempted = true
  }

  if (inLoadingState && next.loadingAttempted && isFailedConnection(connectionStatus)) {
    if (next.intentionalReconnectInProgress) {
      next.effects.suppressedIntentionalWarmError = true
    } else {
      const transportError = connectionStatus.kind === 'error' ? connectionStatus.error : null
      next.effects.loadingFailureError = transportError
        ? { transportError }
        : { key: connectionStatus.kind === 'error' ? 'app.server.connectionFailed' : 'app.server.connectionLost' }
    }
    next.loadingAttempted = false
  }

  if (inStreamingState && isActiveConnection(connectionStatus)) {
    next.wasConnectedInStreamingState = true
    next.connectionLostSignaled = false
  }

  if (next.wasConnectedInStreamingState && inStreamingState && isFailedConnection(connectionStatus)) {
    if (!next.connectionLostSignaled) {
      if (next.intentionalReconnectInProgress) {
        next.effects.suppressedIntentionalConnectionLost = true
      } else {
        next.effects.connectionLost = true
      }
      next.connectionLostSignaled = true
    }
  }

  if (!inStreamingState) {
    next.connectionLostSignaled = false
  }

  if (inMainMenuState) {
    next.loadingAttempted = false
    next.wasConnectedInStreamingState = false
    next.connectionLostSignaled = false
    next.intentionalReconnectInProgress = false
    next.loadingTransitionRequestedForIntentionalReconnect = false
    next.effects.clearConnectionLost = true
  }

  if (inLoadingState && socketOpen && next.intentionalReconnectInProgress) {
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
