import { useEffect, useRef } from 'react'
import { ENGINE_MODES, type Settings } from '../../types/settings'
import { pathsThatDiffer } from '../../utils/settingsClassifier'
import type { PortalState } from '../../context/portal/portalStateMachine'
import type { TranslatableError } from '../../i18n'
import type { LifecycleState } from '../../context/engineLifecycle/engineLifecycleContextValue'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/Respawn')

/** Watches for `process`-class settings changes — fields whose effects
 *  only take hold when the server process is (re)spawned: `engine_mode`
 *  (local-vs-remote process), `offline_mode` (env vars injected at uv
 *  spawn time), and `server_url` (target host). `SETTING_CLASSES` in
 *  `types/settings.ts` is the single source of truth for which fields
 *  belong here.
 *
 *  When any of them flips mid-stream we tear down: close the WS, kick
 *  off an atomic `restartServer` (no-op in remote-server mode — there's
 *  no process we own), clear the engine error, and bounce back through
 *  LOADING. The first render establishes the baseline without firing. */
export function useEngineRespawn(opts: {
  settings: Settings
  portalState: PortalState
  mainMenuState: PortalState
  loadingState: PortalState
  isStandaloneMode: boolean
  disconnect: () => void
  restartServer: () => Promise<LifecycleState>
  setEngineError: (err: TranslatableError | null) => void
  transitionTo: (state: PortalState) => void
}): void {
  const {
    settings,
    portalState,
    mainMenuState,
    loadingState,
    isStandaloneMode,
    disconnect,
    restartServer,
    setEngineError,
    transitionTo
  } = opts

  const prevSettingsRef = useRef<Settings | null>(null)

  useEffect(() => {
    const prev = prevSettingsRef.current
    prevSettingsRef.current = settings
    if (!prev) return // baseline on first render

    const changed = pathsThatDiffer(prev, settings, 'process')
    if (changed.length === 0) return
    if (portalState === mainMenuState) return

    // `offline_mode` only takes effect when we own the server process; in
    // remote-server mode the env vars don't apply, so a hot toggle there is
    // a no-op. Derive the "only offline_mode flipped" check from the
    // changed-paths set so a future process-class field falls into the
    // respawn branch by default instead of being silently swallowed here.
    if (changed.length === 1 && changed[0] === 'offline_mode' && settings.engine_mode !== ENGINE_MODES.STANDALONE) {
      return
    }

    // `engine_mode` flips are already handled by the lifecycle's own
    // `isStandaloneMode`-keyed orchestration effect, which stops or
    // spawns the local server as appropriate. Firing `restartServer`
    // here too would race that pipeline (both go through `runExclusive`
    // so it's serialised, not corrupting, but the second one is
    // redundant and confusing in logs). Tear down the WS and trust
    // the orchestration effect to settle the lifecycle.
    const engineModeChanged = changed.includes('engine_mode')

    log.info('Process-class settings changed - respawning', { changed })

    // Tear down WS, fire `restartServer` without awaiting it, and
    // transition to LOADING immediately so the UI doesn't stall on
    // the previous portal state while the new server boots. The
    // loading screen's warm-connect calls `ensureReady`, which awaits
    // the in-flight pipeline (and `ensureReady` checks in-flight
    // before stale state, so it can't beat the just-fired restart).
    disconnect()
    setEngineError(null)
    if (isStandaloneMode && !engineModeChanged) {
      void restartServer().then((final) => {
        if (final.kind !== 'ready') {
          log.error('restartServer failed during respawn:', final.kind)
        }
      })
    }
    transitionTo(loadingState)
  }, [
    settings,
    portalState,
    mainMenuState,
    loadingState,
    isStandaloneMode,
    disconnect,
    restartServer,
    setEngineError,
    transitionTo
  ])
}
