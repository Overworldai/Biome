import { useCallback } from 'react'
import type { PortalState } from '../../context/portal/portalStateMachine'
import type { TranslatableError } from '../../i18n'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/Actions')

/** The four user-facing connection-lifecycle actions exposed via
 *  `ConnectionContext`. All four close over the same set of imperative
 *  writes (cancel warm-flow, disconnect, reset session/pause/settings/
 *  error, transition the portal); centralising them here keeps the
 *  provider free of the "ten useCallbacks that all close over the same
 *  things" pattern.
 *
 *  None of these tear down the standalone server. The Python process
 *  is a session-long resource — settings menu, model picker, and
 *  capability probes all rely on a live `/health`. Process-level
 *  cycling is `EngineLifecycle.restartServer`'s job and only fires for
 *  env-var / mode changes that genuinely need a fresh process. */
export function useConnectionActions(opts: {
  cancelWarmFlow: () => void
  disconnect: () => void
  exitPointerLock: () => void
  transitionTo: (state: PortalState) => void | Promise<boolean>
  loadingState: PortalState
  mainMenuState: PortalState
  resetSession: () => void
  resumeSession: () => void
  setEngineError: (err: TranslatableError | null) => void
  setSettingsOpen: (value: boolean) => void
  setConnectionLost: (value: boolean) => void
}): {
  /** Acknowledges the connection-lost overlay without trying to
   *  reconnect. */
  dismissConnectionLost: () => Promise<void>
  /** User chose "reconnect" on the connection-lost overlay. */
  reconnectAfterConnectionLost: () => Promise<void>
  /** User cancelled mid-loading. Tears down WS + returns to main menu. */
  cancelConnection: () => Promise<void>
  /** Pre-flight cleanup before navigating back to main menu. */
  prepareReturnToMainMenu: () => Promise<void>
} {
  const {
    cancelWarmFlow,
    disconnect,
    exitPointerLock,
    transitionTo,
    loadingState,
    mainMenuState,
    resetSession,
    resumeSession,
    setEngineError,
    setSettingsOpen,
    setConnectionLost
  } = opts

  const cleanup = useCallback(() => {
    cancelWarmFlow()
    exitPointerLock()
    disconnect()
    setEngineError(null)
    setSettingsOpen(false)
    resumeSession()
  }, [cancelWarmFlow, exitPointerLock, disconnect, setEngineError, setSettingsOpen, resumeSession])

  const dismissConnectionLost = useCallback(async () => {
    log.info('Acknowledging connection lost overlay')
    setConnectionLost(false)
  }, [setConnectionLost])

  const reconnectAfterConnectionLost = useCallback(async () => {
    log.info('Reconnecting after connection lost')
    setConnectionLost(false)
    cleanup()
    resetSession()
    transitionTo(loadingState)
  }, [setConnectionLost, cleanup, resetSession, transitionTo, loadingState])

  const cancelConnection = useCallback(async () => {
    log.info('Cancelling connection')
    cleanup()
    transitionTo(mainMenuState)
  }, [cleanup, transitionTo, mainMenuState])

  const prepareReturnToMainMenu = useCallback(async () => {
    log.info('Preparing return to main menu')
    cleanup()
  }, [cleanup])

  return { dismissConnectionLost, reconnectAfterConnectionLost, cancelConnection, prepareReturnToMainMenu }
}
