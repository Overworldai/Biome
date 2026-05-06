import { useEffect, useRef } from 'react'
import { ENGINE_MODES, type EngineMode } from '../../types/settings'
import type { PortalState } from '../../context/portal/portalStateMachine'
import type { TranslatableError } from '../../i18n'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/Respawn')

/** Watches the two settings that take effect at server-process spawn
 *  time — `engine_mode` (local-vs-remote process) and `offline_mode`
 *  (env vars injected when uv spawns the Python server) — and forces a
 *  full teardown-and-reconnect when either flips mid-stream. The env
 *  is only honoured when the process starts, so a hot toggle would
 *  otherwise leave the server running with stale environment.
 *
 *  Offline-mode changes only matter in standalone mode; in remote-server
 *  mode the env vars don't apply (we connect to a server we didn't
 *  spawn). The first render establishes the baseline without firing. */
export function useEngineRespawn(opts: {
  engineMode: EngineMode
  offlineMode: boolean
  portalState: PortalState
  mainMenuState: PortalState
  loadingState: PortalState
  isServerRunning: boolean
  disconnect: () => void
  stopServer: () => Promise<string>
  setEngineError: (err: TranslatableError | null) => void
  transitionTo: (state: PortalState) => void
}): void {
  const {
    engineMode,
    offlineMode,
    portalState,
    mainMenuState,
    loadingState,
    isServerRunning,
    disconnect,
    stopServer,
    setEngineError,
    transitionTo
  } = opts

  const prevEngineModeRef = useRef(engineMode)
  const prevOfflineModeRef = useRef(offlineMode)

  useEffect(() => {
    const prevMode = prevEngineModeRef.current
    const prevOffline = prevOfflineModeRef.current
    prevEngineModeRef.current = engineMode
    prevOfflineModeRef.current = offlineMode

    const engineModeChanged = !!prevMode && prevMode !== engineMode
    const offlineChanged = prevOffline !== offlineMode && engineMode === ENGINE_MODES.STANDALONE

    if (!engineModeChanged && !offlineChanged) return
    if (portalState === mainMenuState) return

    log.info(`Respawn: engine_mode ${prevMode}->${engineMode}, offline ${prevOffline}->${offlineMode}`)

    disconnect()
    if (isServerRunning) {
      stopServer().catch((err) => log.error('Failed to stop server during respawn:', err))
    }
    setEngineError(null)
    transitionTo(loadingState)
  }, [
    engineMode,
    offlineMode,
    portalState,
    mainMenuState,
    loadingState,
    isServerRunning,
    disconnect,
    stopServer,
    setEngineError,
    transitionTo
  ])
}
