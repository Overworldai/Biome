import { PORTAL_STATES, type PortalState } from '../portal/portalStateMachine'
import type { ConnectionStatus } from '../../hooks/engine/useWebSocket'
import type { TranslatableError, TranslationKey } from '../../i18n'
import type { RestartSignatures } from '../../utils/settingsClassifier'

const isActiveConnection = (s: ConnectionStatus): boolean =>
  s.kind === 'connecting' || s.kind === 'loading' || s.kind === 'ready'
const isFailedConnection = (s: ConnectionStatus): boolean => s.kind === 'idle' || s.kind === 'error'

export const STREAMING_LIFECYCLE_EVENT = {
  SYNC: 'sync'
} as const

/** Kinds of intentional restart the reducer tracks. `'reconnect'` is
 *  the in-place version (session-class diff): the reducer emits
 *  `startIntentionalReconnect` and orchestrates the disconnect →
 *  LOADING transition. `'respawn'` is the heavier version
 *  (process-class diff): `useEngineRespawn` lives outside the reducer
 *  and owns the side effects (it has to, because `stopServer` is
 *  async); the reducer only mirrors the intent so the
 *  connection-lost overlay is suppressed during the disconnect. */
export type IntentionalRestart = 'reconnect' | 'respawn'

export type StreamingLifecycleEffects = {
  loadingFailureError: { transportError: TranslatableError } | { key: TranslationKey } | null
  connectionLost: boolean
  clearConnectionLost: boolean
  engineErrorDismissed: boolean
  startIntentionalReconnect: boolean
  transitionToLoadingAfterIntentionalDisconnect: boolean
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
  /** Which kind of intentional restart is in flight, if any.
   *  Drives the connection-lost / warm-error suppression and (for
   *  `'reconnect'`) the disconnect → LOADING orchestration. Cleared
   *  on LOADING entry and on MAIN_MENU. */
  intentionalRestart: IntentionalRestart | null
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
  intentionalRestart: null,
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
  /** Current signatures of all restart-class settings. The reducer
   *  doesn't care what's in them — only whether they differ from
   *  `lastAppliedSignatures`. Built by `getRestartSignatures` in
   *  `utils/settingsClassifier`. */
  currentSignatures: RestartSignatures
  /** Snapshot taken in `useSessionInit` at the last successful
   *  bootstrap. `null` until the first session has been initialised
   *  (or after a `resetSession`). */
  lastAppliedSignatures: RestartSignatures | null
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

/** Compute the strongest intentional-restart class implied by a
 *  signature diff. `'respawn'` outranks `'reconnect'` because a
 *  process-class change always implies a full session reset, and the
 *  respawn path (stopServer + new env vars) subsumes the in-place
 *  reconnect. Returns `null` when no diff is detected or when we're
 *  not in a streaming-with-open-socket state where a restart makes
 *  sense. */
const computeIntentionalRestart = (
  current: RestartSignatures,
  lastApplied: RestartSignatures | null,
  inStreamingState: boolean,
  socketOpen: boolean
): IntentionalRestart | null => {
  if (!inStreamingState || !socketOpen || !lastApplied) return null
  if (current.process !== lastApplied.process) return 'respawn'
  if (current.session !== lastApplied.session) return 'reconnect'
  return null
}

export const streamingLifecycleReducer = (
  state: StreamingLifecycleState,
  event: StreamingLifecycleEvent
): StreamingLifecycleState => {
  if (event.type !== STREAMING_LIFECYCLE_EVENT.SYNC) return state

  const {
    portalState,
    connectionStatus,
    currentSignatures,
    lastAppliedSignatures,
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

  const intentNeeded = computeIntentionalRestart(currentSignatures, lastAppliedSignatures, inStreamingState, socketOpen)

  const enteredLoading = inLoadingState && state.lastPortalState !== PORTAL_STATES.LOADING
  if (enteredLoading) {
    next.loadingConnectionRequestSeq = state.loadingConnectionRequestSeq + 1
    next.loadingAttempted = false
    // Clear any prior connection-lost overlay: by entering LOADING we're
    // either healing from a real disconnect (user clicked reconnect) or
    // intentionally tearing down (process respawn from useEngineRespawn,
    // which lives outside this reducer and so can't go through the
    // intentional-restart suppression path).
    //
    // `engineError` is *not* cleared here — every path that should clear
    // it (cancelConnection, reconnectAfterConnectionLost, useEngineRespawn)
    // does so explicitly before transitioning, and the recovery path
    // (useLoadingFailureCleanup) deliberately preserves the overlay
    // across the background respawn's LOADING re-entry.
    next.connectionLostSignaled = false
    next.effects.clearConnectionLost = true
    next.effects.runLoadingConnection = true
  }

  if (intentNeeded && state.intentionalRestart !== intentNeeded) {
    next.intentionalRestart = intentNeeded
    if (intentNeeded === 'reconnect') {
      next.loadingTransitionRequestedForIntentionalReconnect = false
      next.effects.startIntentionalReconnect = true
    }
    // 'respawn' has no effect — useEngineRespawn owns the side effects.
  }

  if (next.intentionalRestart !== 'reconnect') {
    next.loadingTransitionRequestedForIntentionalReconnect = false
  }

  if (
    next.intentionalRestart === 'reconnect' &&
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
    if (next.intentionalRestart !== null) {
      next.effects.suppressedIntentionalWarmError = true
    } else if (engineError) {
      // The engine-error overlay is already up — fired by an
      // application-layer error the server pushed before tearing down
      // the WS. The transport-error overlay this branch would normally
      // raise is redundant noise in that case; let the engine-error
      // overlay carry the user-facing message and let the recovery
      // path (useLoadingFailureCleanup) cycle the server underneath.
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
      if (next.intentionalRestart !== null) {
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
    next.intentionalRestart = null
    next.loadingTransitionRequestedForIntentionalReconnect = false
    next.effects.clearConnectionLost = true
  }

  if (inLoadingState && socketOpen && next.intentionalRestart !== null) {
    next.intentionalRestart = null
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
