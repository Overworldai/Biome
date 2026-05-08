import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke } from '../../bridge'
import { STANDALONE_PORT } from '../../types/settings'
import { useSettings } from '../../hooks/settings/settingsContextValue'
import { createLogger } from '../../utils/logger'
import { StartupContext, type StartupContextValue, type StartupPhase } from './startupContextValue'

const log = createLogger('Startup')

/** Cadence of the post-spawn /health probe. Short enough that the splash
 *  doesn't linger after the server is actually up; long enough that we
 *  don't spam the kernel during a slow first-time torch import. */
const HEALTH_POLL_INTERVAL_MS = 250

/** /health probe timeout. The server's lazy-init path leaves engines
 *  uninstantiated, so the request itself is cheap — only routing latency
 *  and Python's GIL matter. 2.5 s is comfortable headroom. */
const HEALTH_PROBE_TIMEOUT_MS = 2500

/** Range of ports we'll try when scanning for an open one. Mirrors
 *  STANDALONE_PORT_SCAN_LIMIT in `streamingWarmConnection.ts`; if every
 *  port from STANDALONE_PORT through STANDALONE_PORT + 1336 is taken,
 *  something's badly wrong on the box. */
const PORT_SCAN_LIMIT = 1337

const findOpenPort = async (): Promise<number | null> => {
  for (let i = 0; i < PORT_SCAN_LIMIT; i++) {
    const candidate = STANDALONE_PORT + i
    const inUse = await invoke('is-port-in-use', candidate)
    if (!inUse) return candidate
  }
  return null
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const StartupProvider = ({ children }: { children: ReactNode }) => {
  const { isStandaloneMode } = useSettings()
  const [phase, setPhase] = useState<StartupPhase>('unpacking')
  const [error, setError] = useState<string | null>(null)
  // The orchestration must run exactly once per mount. React StrictMode in
  // dev double-invokes effects on the first commit, which would otherwise
  // double-spawn the server.
  const ranOnceRef = useRef(false)

  const runStartServerWithHealthPoll = useCallback(async (): Promise<void> => {
    const port = await findOpenPort()
    if (port === null) {
      const msg = `No open port in range ${STANDALONE_PORT}–${STANDALONE_PORT + PORT_SCAN_LIMIT - 1}`
      log.error(msg)
      setError(msg)
      setPhase('failed')
      return
    }

    log.info('Starting server on port', port)
    try {
      await invoke('start-engine-server', port)
    } catch (e) {
      const msg = errorMessage(e)
      log.error('start-engine-server failed:', msg)
      setError(msg)
      setPhase('failed')
      return
    }

    const healthUrl = `http://localhost:${port}/health`
    log.info('Polling /health at', healthUrl)
    while (true) {
      const probe = await invoke('probe-server-health', healthUrl, HEALTH_PROBE_TIMEOUT_MS)
      if (probe.reachable) {
        log.info('Server ready on port', port)
        setPhase('ready')
        return
      }
      const running = await invoke('is-server-running')
      if (!running) {
        // Capture the exit tail so the user sees a real error instead of
        // a generic "didn't become ready" — same path the warm-connect
        // flow uses for crash diagnostics.
        const tail = await invoke('get-last-server-exit-tail')
        const msg = tail || 'Server exited before becoming ready'
        log.error('Server died during health poll:', msg)
        setError(msg)
        setPhase('failed')
        return
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
    }
  }, [])

  const orchestrate = useCallback(async (): Promise<void> => {
    if (!isStandaloneMode) {
      // Remote-server mode: no local boot, no splash. The renderer talks
      // to the configured `server_url`; reachability is handled by the
      // existing serverUrlStatus probe on the settings panel.
      log.info('Server mode: skipping local startup orchestration')
      setPhase('ready')
      return
    }

    setPhase('unpacking')
    try {
      await invoke('unpack-server-files', false)
    } catch (e) {
      // Unpack is best-effort — a failed copy doesn't gate the rest of
      // the pipeline, since `check-engine-status` downstream will catch
      // a missing pyproject.toml / main.py and route us to `not_installed`.
      log.warn('Server file unpack failed:', errorMessage(e))
    }

    setPhase('checking')
    const status = await invoke('check-engine-status', 'startup')
    if (!status.uv_installed || !status.repo_cloned || !status.dependencies_synced) {
      log.info('Engine not installed; menu will open with install affordance')
      setPhase('not_installed')
      return
    }

    if (status.server_running) {
      // A previous Biome instance left a managed server alive (most likely
      // a hot-reload during development). Adopt it instead of double-booting.
      log.info('Server already running; skipping start')
      setPhase('ready')
      return
    }

    setPhase('starting')
    await runStartServerWithHealthPoll()
  }, [isStandaloneMode, runStartServerWithHealthPoll])

  const installAndStart = useCallback(async (): Promise<void> => {
    setError(null)
    setPhase('unpacking')
    try {
      await invoke('reinstall-engine')
    } catch (e) {
      const msg = errorMessage(e)
      log.error('reinstall-engine failed:', msg)
      setError(msg)
      setPhase('failed')
      return
    }
    setPhase('starting')
    await runStartServerWithHealthPoll()
  }, [runStartServerWithHealthPoll])

  useEffect(() => {
    if (ranOnceRef.current) return
    ranOnceRef.current = true
    void orchestrate()
  }, [orchestrate])

  const value: StartupContextValue = { phase, error, installAndStart }

  return <StartupContext.Provider value={value}>{children}</StartupContext.Provider>
}
