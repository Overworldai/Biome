import { useCallback } from 'react'
import type { PortalState } from '../../context/portal/portalStateMachine'
import type { TranslatableError } from '../../i18n'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/Actions')

/** The four user-facing connection-lifecycle actions exposed via
 *  `ConnectionContext`, plus the two cleanup helpers they share.
 *
 *  All four close over the same set of imperative writes (cancel
 *  warm-flow, disconnect, reset session/pause/settings/error,
 *  transition the portal). Centralising them here keeps the provider
 *  free of the "ten useCallbacks that all close over the same things"
 *  pattern — and makes it obvious that `cleanupState` is the shared
 *  helper, with `stopServerIfRunning` layered on top for the actions
 *  that should also tear down the standalone process. */
export function useConnectionActions(opts: {
  isStandaloneMode: boolean
  isServerRunning: boolean
  cancelWarmFlow: () => void
  disconnect: () => void
  exitPointerLock: () => void
  stopServer: () => Promise<string>
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
  /** User cancelled mid-loading. Tears down + returns to main menu. */
  cancelConnection: () => Promise<void>
  /** Pre-flight cleanup before navigating back to main menu. */
  prepareReturnToMainMenu: () => Promise<void>
} {
  const {
    isStandaloneMode,
    isServerRunning,
    cancelWarmFlow,
    disconnect,
    exitPointerLock,
    stopServer,
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

  const stopServerIfRunning = useCallback(async () => {
    if (!isStandaloneMode || !isServerRunning) return
    log.info('Stopping standalone server...')
    try {
      await stopServer()
      log.info('Server stopped')
    } catch (err) {
      log.error('Failed to stop server:', err)
    }
  }, [isStandaloneMode, isServerRunning, stopServer])

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
    await stopServerIfRunning()
    transitionTo(mainMenuState)
  }, [cleanup, stopServerIfRunning, transitionTo, mainMenuState])

  const prepareReturnToMainMenu = useCallback(async () => {
    log.info('Preparing return to main menu')
    cleanup()
    await stopServerIfRunning()
  }, [cleanup, stopServerIfRunning])

  return { dismissConnectionLost, reconnectAfterConnectionLost, cancelConnection, prepareReturnToMainMenu }
}
