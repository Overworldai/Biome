import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke } from '../../bridge'
import { STANDALONE_PORT } from '../../types/settings'
import { useSettings } from '../../hooks/settings/settingsContextValue'
import { createLogger } from '../../utils/logger'
import { StartupContext, type StartupContextValue, type StartupState } from './startupContextValue'

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
 *  STANDALONE_PORT_SCAN_LIMIT in `streamingWarmConnection.ts`. */
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

/** Run the spawn + health-poll pipeline and return the resulting state.
 *  Pure — doesn't touch React state — so it can be reused across the
 *  initial-startup and reinstall paths. */
const startServer = async (): Promise<StartupState> => {
  log.info('Scanning for open port')
  const port = await findOpenPort()
  if (port === null) {
    const msg = `No open port in range ${STANDALONE_PORT}-${STANDALONE_PORT + PORT_SCAN_LIMIT - 1}`
    log.error(msg)
    return { kind: 'failed', error: msg }
  }

  log.info('Starting server on port', port)
  try {
    await invoke('start-engine-server', port)
  } catch (e) {
    const msg = errorMessage(e)
    log.error('start-engine-server failed:', msg)
    return { kind: 'failed', error: msg }
  }

  const healthUrl = `http://localhost:${port}/health`
  log.info('Polling /health at', healthUrl)
  while (true) {
    const probe = await invoke('probe-server-health', healthUrl, HEALTH_PROBE_TIMEOUT_MS)
    if (probe.reachable) {
      log.info('Server ready on port', port)
      return { kind: 'ready' }
    }
    const running = await invoke('is-server-running')
    if (!running) {
      // Capture the exit tail so the user sees a real error instead of a
      // generic "didn't become ready" — same path the warm-connect flow
      // uses for crash diagnostics.
      const tail = await invoke('get-last-server-exit-tail')
      const msg = tail || 'Server exited before becoming ready'
      log.error('Server died during health poll:', msg)
      return { kind: 'failed', error: msg }
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
  }
}

export const StartupProvider = ({ children }: { children: ReactNode }) => {
  const { isStandaloneMode } = useSettings()
  const [state, setState] = useState<StartupState>(() => ({ kind: 'preparing' }))
  // The orchestration must run exactly once per mount. React StrictMode in
  // dev double-invokes effects on the first commit, which would otherwise
  // double-spawn the server.
  const ranOnceRef = useRef(false)

  const orchestrate = useCallback(async (): Promise<void> => {
    if (!isStandaloneMode) {
      // Server mode: no local boot, no splash. The renderer talks to the
      // configured `server_url`; reachability is handled by the existing
      // serverUrlStatus probe on the settings panel.
      log.info('Server mode: skipping local startup orchestration')
      setState({ kind: 'ready' })
      return
    }

    setState({ kind: 'preparing' })
    log.info('Unpacking server files')
    try {
      await invoke('unpack-server-files', false)
    } catch (e) {
      // Unpack is best-effort — a failed copy doesn't gate the rest of
      // the pipeline, since the next check-engine-status will catch a
      // missing pyproject.toml / main.py and route us to `not_installed`.
      log.warn('Server file unpack failed:', errorMessage(e))
    }

    log.info('Checking engine status')
    const status = await invoke('check-engine-status', 'startup')
    if (!status.uv_installed || !status.repo_cloned || !status.dependencies_synced) {
      log.info('Engine not installed; awaiting user install')
      setState({ kind: 'not_installed' })
      return
    }

    if (status.server_running) {
      // A previous Biome instance left a managed server alive (most likely
      // a hot-reload during development). Adopt it instead of double-booting.
      log.info('Server already running; adopting')
      setState({ kind: 'ready' })
      return
    }

    setState(await startServer())
  }, [isStandaloneMode])

  const reinstallEngine = useCallback(async (mode: 'fix' | 'nuke' = 'fix'): Promise<void> => {
    setState({ kind: 'preparing' })

    // Stop the running server (if any) so the freshly-installed deps run
    // against a fresh process. No-op when the server isn't running; the
    // IPC handler is idempotent.
    log.info('Stopping server before reinstall')
    try {
      await invoke('stop-engine-server')
    } catch (e) {
      log.warn('stop-engine-server failed (likely already stopped):', errorMessage(e))
    }

    const command = mode === 'nuke' ? 'nuke-and-reinstall-engine' : 'reinstall-engine'
    log.info('Running', command)
    try {
      await invoke(command)
    } catch (e) {
      const msg = errorMessage(e)
      log.error(`${command} failed:`, msg)
      setState({ kind: 'failed', error: msg })
      return
    }

    setState(await startServer())
  }, [])

  useEffect(() => {
    if (ranOnceRef.current) return
    ranOnceRef.current = true
    void orchestrate()
  }, [orchestrate])

  const value: StartupContextValue = { state, reinstallEngine }

  return <StartupContext.Provider value={value}>{children}</StartupContext.Provider>
}
