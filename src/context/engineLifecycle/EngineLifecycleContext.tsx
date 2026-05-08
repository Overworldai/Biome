import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { invoke } from '../../bridge'
import { STANDALONE_PORT } from '../../types/settings'
import { useSettings } from '../../hooks/settings/settingsContextValue'
import useEngineApi from '../../hooks/engine/useEngineApi'
import { createLogger } from '../../utils/logger'
import {
  EngineLifecycleContext,
  type EngineLifecycleContextValue,
  type LifecycleState
} from './engineLifecycleContextValue'

const log = createLogger('EngineLifecycle')

/** Cadence of the post-spawn /health probe. Short enough that startup
 *  completes promptly after the server is actually up; long enough that
 *  we don't spam the kernel during a slow first-time torch import. */
const HEALTH_POLL_INTERVAL_MS = 250

/** /health probe timeout. The server's lazy-init path leaves engines
 *  uninstantiated, so the request itself is cheap — only routing latency
 *  and Python's GIL matter. 2.5 s is comfortable headroom. */
const HEALTH_PROBE_TIMEOUT_MS = 2500

/** Range of ports we'll try when scanning for an open one. */
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
const startServer = async (): Promise<LifecycleState> => {
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
      // generic "didn't become ready".
      const tail = await invoke('get-last-server-exit-tail')
      const msg = tail || 'Server exited before becoming ready'
      log.error('Server died during health poll:', msg)
      return { kind: 'failed', error: msg }
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
  }
}

export const EngineLifecycleProvider = ({ children }: { children: ReactNode }) => {
  const { isStandaloneMode } = useSettings()
  const engine = useEngineApi()
  const [state, setState] = useState<LifecycleState>(() => ({ kind: 'preparing' }))

  // Latest-state ref so `ensureReady`'s wait loop reads fresh state across
  // its `await new Promise(...)` boundaries without listing `state` as a
  // useCallback dep (which would churn the callback identity every render).
  const stateRef = useRef(state)
  stateRef.current = state

  // Single-pipeline lock. Every state transition that goes through a
  // pipeline (initial orchestrate, reinstallEngine, ensureReady-triggered
  // install) parks its promise here. Concurrent callers find it set and
  // await the same promise instead of racing.
  const inFlightRef = useRef<Promise<LifecycleState> | null>(null)

  // `ensureReady` returns a promise that resolves only on a terminal
  // state. The waiter list is woken on every state transition; each
  // waiter re-checks its loop condition and either resolves or
  // re-registers.
  const waitersRef = useRef<(() => void)[]>([])

  // The orchestration must run exactly once per mount. React StrictMode in
  // dev double-invokes effects on the first commit, which would otherwise
  // double-spawn the server.
  const ranOnceRef = useRef(false)

  useEffect(() => {
    const waiters = waitersRef.current
    waitersRef.current = []
    waiters.forEach((w) => w())
  }, [state])

  /** Park `work` as the in-flight pipeline. Concurrent callers receive
   *  the same promise; the lock clears once `work` resolves. */
  const runExclusive = useCallback(async (work: () => Promise<LifecycleState>): Promise<LifecycleState> => {
    if (inFlightRef.current) return inFlightRef.current
    const promise = work()
    inFlightRef.current = promise
    try {
      const final = await promise
      setState(final)
      return final
    } finally {
      inFlightRef.current = null
    }
  }, [])

  const reinstallEngine = useCallback(
    (mode: 'fix' | 'nuke' = 'fix'): Promise<LifecycleState> =>
      runExclusive(async () => {
        setState({ kind: 'preparing' })

        // Stop the running server (if any) so the freshly-installed deps
        // run against a fresh process. No-op when the server isn't
        // running; the IPC handler is idempotent.
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
          return { kind: 'failed', error: msg }
        }

        return await startServer()
      }),
    [runExclusive]
  )

  const ensureReady = useCallback(async (): Promise<LifecycleState> => {
    while (true) {
      const current = stateRef.current
      if (current.kind === 'ready' || current.kind === 'failed') return current
      // A pipeline is already running — await it directly.
      if (inFlightRef.current) {
        await inFlightRef.current
        continue
      }
      // not_installed with no pipeline — kick off install. The result lands
      // back through the state-transition useEffect, waking the waiter
      // we registered below on the next loop iteration.
      if (current.kind === 'not_installed') {
        void reinstallEngine('fix').catch(() => {
          /* errors land in state */
        })
        continue
      }
      // 'preparing' but no pipeline (transient between orchestrate's
      // setState and the runExclusive return) — wait for the next state
      // transition and re-check.
      await new Promise<void>((resolve) => waitersRef.current.push(resolve))
    }
  }, [reinstallEngine])

  const abortReinstall = useCallback(async (): Promise<void> => {
    await invoke('abort-engine-install')
  }, [])

  useEffect(() => {
    if (ranOnceRef.current) return
    ranOnceRef.current = true
    void runExclusive(async () => {
      if (!isStandaloneMode) {
        // Server mode: no local boot. The renderer talks to the configured
        // `server_url`; reachability is handled by the existing
        // serverUrlStatus probe on the settings panel.
        log.info('Server mode: skipping local startup orchestration')
        return { kind: 'ready' }
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
        return { kind: 'not_installed' }
      }

      if (status.server_running) {
        // A previous Biome instance left a managed server alive (most
        // likely a hot-reload during development). Adopt it instead of
        // double-booting.
        log.info('Server already running; adopting')
        return { kind: 'ready' }
      }

      return await startServer()
    })
  }, [isStandaloneMode, runExclusive])

  const value = useMemo<EngineLifecycleContextValue>(
    () => ({
      state,
      status: engine.status,
      isReady: engine.isReady,
      isRunning: engine.isServerRunning,
      serverLogPath: engine.serverLogPath,
      check: engine.checkStatus,
      stopServer: engine.stopServer,
      probeServerHealth: engine.probeServerHealth,
      reinstallEngine,
      ensureReady,
      abortReinstall
    }),
    [
      state,
      engine.status,
      engine.isReady,
      engine.isServerRunning,
      engine.serverLogPath,
      engine.checkStatus,
      engine.stopServer,
      engine.probeServerHealth,
      reinstallEngine,
      ensureReady,
      abortReinstall
    ]
  )

  return <EngineLifecycleContext.Provider value={value}>{children}</EngineLifecycleContext.Provider>
}
