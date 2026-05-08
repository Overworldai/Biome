import { useEffect, useRef } from 'react'
import { ENGINE_MODES, type Settings } from '../../types/settings'
import { classifySettingsDiff } from '../../utils/settingsClassifier'
import type { PortalState } from '../../context/portal/portalStateMachine'
import type { TranslatableError } from '../../i18n'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/Respawn')

/** Watches for `process`-class settings changes — fields whose effects
 *  only take hold when the server process is (re)spawned: `engine_mode`
 *  (local-vs-remote process), `offline_mode` (env vars injected at uv
 *  spawn time), and `server_url` (target host). `SETTING_CLASSES` in
 *  `types/settings.ts` is the single source of truth for which fields
 *  belong here.
 *
 *  When any of them flips mid-stream we tear down: close the WS, stop
 *  the local server (no-op in remote-server mode — there's no process
 *  we own), clear the engine error, and bounce back through LOADING.
 *  The first render establishes the baseline without firing. */
export function useEngineRespawn(opts: {
  settings: Settings
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
    settings,
    portalState,
    mainMenuState,
    loadingState,
    isServerRunning,
    disconnect,
    stopServer,
    setEngineError,
    transitionTo
  } = opts

  const prevSettingsRef = useRef<Settings | null>(null)

  useEffect(() => {
    const prev = prevSettingsRef.current
    prevSettingsRef.current = settings
    if (!prev) return // baseline on first render

    if (classifySettingsDiff(prev, settings) !== 'process') return
    if (portalState === mainMenuState) return

    // `offline_mode` only takes effect when we own the server process; in
    // remote-server mode the env vars don't apply, so a hot toggle there is
    // a no-op aside from any unrelated process-class field that flipped.
    if (
      prev.engine_mode === settings.engine_mode &&
      prev.server_url === settings.server_url &&
      prev.offline_mode !== settings.offline_mode &&
      settings.engine_mode !== ENGINE_MODES.STANDALONE
    ) {
      return
    }

    log.info('Process-class settings changed - respawning server')

    // Tear down in order, awaiting `stopServer` so the IPC "server
    // exited" event has propagated to `isServerRunning=false` before
    // LOADING fires. Without the await, the warm-connect flow reads
    // stale React state, picks the attach-to-running branch, and
    // throws "Server exited before becoming ready" while the doomed
    // server finishes dying.
    void (async () => {
      disconnect()
      if (isServerRunning) {
        try {
          await stopServer()
        } catch (err) {
          log.error('Failed to stop server during respawn:', err)
        }
      }
      setEngineError(null)
      transitionTo(loadingState)
    })()
  }, [
    settings,
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
