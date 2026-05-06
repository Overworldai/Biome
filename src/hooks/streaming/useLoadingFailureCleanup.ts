import { useEffect, useRef } from 'react'
import type { ConnectionStatus } from '../engine/useWebSocket'
import type { PortalState } from '../../context/portal/portalStateMachine'
import type { TranslatableError } from '../../i18n'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/LoadingFailure')

/** When the loading flow fails (connection errors out or never opens
 *  *and* an engine error has been recorded), stop the standalone Python
 *  server. The server may have started but failed to reach the
 *  ready-to-serve state — leaving it running would leak the process and
 *  the next loading attempt would race the cleanup.
 *
 *  Idempotent within one failure cycle: a `loadingFailureStopHandledRef`
 *  guard prevents the stop from running on every render while
 *  `engineError` is still set. The guard clears once the loading state
 *  recovers. */
export function useLoadingFailureCleanup(opts: {
  portalState: PortalState
  loadingState: PortalState
  connectionStatus: ConnectionStatus
  engineError: TranslatableError | null
  isStandaloneMode: boolean
  isServerRunning: boolean
  stopServer: () => Promise<string>
}): void {
  const { portalState, loadingState, connectionStatus, engineError, isStandaloneMode, isServerRunning, stopServer } =
    opts
  const stopHandledRef = useRef(false)

  useEffect(() => {
    const loadingFailed =
      portalState === loadingState && (connectionStatus.kind === 'error' || connectionStatus.kind === 'idle')

    if (!loadingFailed || !engineError) {
      stopHandledRef.current = false
      return
    }
    if (!isStandaloneMode || !isServerRunning) return
    if (stopHandledRef.current) return

    stopHandledRef.current = true
    ;(async () => {
      log.info('Loading failure detected - stopping standalone server')
      try {
        await stopServer()
      } catch (err) {
        log.error('Failed to stop standalone server after loading failure:', err)
      }
    })()
  }, [portalState, loadingState, connectionStatus, engineError, isStandaloneMode, isServerRunning, stopServer])
}
