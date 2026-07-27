import { useEffect, useRef } from 'react'
import type { ConnectionStatus } from '../engine/useWebSocket'
import type { PortalState } from '../../context/portal/portalStateMachine'
import type { TranslatableError } from '../../i18n'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/LoadingFailure')

const NON_RECOVERABLE_LOADING_ERRORS = new Set(['app.server.error.serverBusy', 'app.server.error.incompatibleHardware'])

/** After an app-layer load failure (model load rejected by the
 *  backend, init RPC errored), the server has cleanly torn down its
 *  in-memory engine state (`_unload_engine_sync` runs in every
 *  exception branch of `WorldEngineManager.load_engine`) and closed
 *  the WebSocket, but the Python process is still alive and ready to
 *  accept a fresh session. We just need to re-establish the WS so the
 *  fix-in-settings retry path has a socket to bootstrap on.
 *
 *  The engine-error overlay persists across this reconnect — the
 *  lifecycle reducer no longer auto-clears `engineError` on LOADING
 *  entry, and `useSessionInit` bails the bootstrap while `engineError`
 *  is set — so the user sees the original error message while the
 *  system quietly re-attaches behind them. They retry either by
 *  dismissing the overlay (returning to MAIN_MENU) or by fixing the
 *  offending setting in-place (clears the error, bootstrap re-fires
 *  against the still-warm WS).
 *
 *  Idempotent within one failure cycle: a `handledRef` guard prevents
 *  the reconnect from firing on every render while `engineError` is
 *  still set. The guard clears once the loading state recovers
 *  (engineError cleared or LOADING exited). */
export function useLoadingFailureCleanup(opts: {
  portalState: PortalState
  loadingState: PortalState
  connectionStatus: ConnectionStatus
  engineError: TranslatableError | null
  /** Re-run the warm-connect flow against the same server (which is
   *  still alive — we never killed it). The lifecycle reducer only
   *  fires its own `runLoadingConnection` effect on LOADING *entry*;
   *  we're already in LOADING when the failure surfaces, so the WS
   *  won't reconnect on its own without this nudge. */
  runWarmConnection: () => void
}): void {
  const { portalState, loadingState, connectionStatus, engineError, runWarmConnection } = opts
  const handledRef = useRef(false)

  useEffect(() => {
    const loadingFailed =
      portalState === loadingState && (connectionStatus.kind === 'error' || connectionStatus.kind === 'idle')
    // SERVER_BUSY means a previous session is still holding the
    // single-session slot. Reconnecting won't help until that session
    // releases — and re-firing warm-connect each time the WS bounces
    // through 'connecting' → 'error' clears the handledRef guard,
    // producing a tight retry loop. Surface the error to the user
    // instead; the server-side disconnect watcher will free the slot
    // shortly so a manual retry can succeed.
    //
    // INCOMPATIBLE_HARDWARE is terminal for the current settings too.
    // The server keeps the pre-init socket open after reporting it, so
    // we only land here once its 60s seed timeout closes the connection
    // underneath a still-visible overlay. Reconnecting then is pointless:
    // `useSessionInit` suppresses bootstrap while the error is set, so the
    // fresh socket just idles into the same timeout, over and over.
    const skipRecoveryReconnect = !!engineError && NON_RECOVERABLE_LOADING_ERRORS.has(engineError.translationKey)

    if (!loadingFailed || !engineError || skipRecoveryReconnect) {
      handledRef.current = false
      return
    }
    if (handledRef.current) return

    handledRef.current = true
    log.info('Loading failure detected - reconnecting to existing server')
    runWarmConnection()
  }, [portalState, loadingState, connectionStatus, engineError, runWarmConnection])
}
