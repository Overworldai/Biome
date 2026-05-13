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

export const EngineLifecycleProvider = ({ children }: { children: ReactNode }) => {
  const { isStandaloneMode: savedStandalone } = useSettings()
  const engine = useEngineApi()
  const [state, setState] = useState<LifecycleState>(() => ({ kind: 'preparing' }))

  // Optional override from the settings menu so it can speculatively bring
  // up / tear down the local server while the user is toggling engine_mode
  // in the draft, without forcing them to Save first. `null` means "no
  // override — use the saved setting"; the provider re-orchestrates on every
  // effective-mode change just as it does on a saved-settings change.
  const [draftStandalone, setDraftStandaloneState] = useState<boolean | null>(null)
  const isStandaloneMode = draftStandalone ?? savedStandalone

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

  /** Atomic kill+spawn of the standalone server. Stops the running
   *  process (no-op if not running), spawns a fresh one, polls
   *  `/health`, and refreshes the engine status snapshot so consumers
   *  see the new port and `isServerRunning` immediately. Skips the
   *  reinstall steps that `reinstallEngine` does — the deps are still
   *  valid, only the process needs cycling.
   *
   *  The kill and the spawn are deliberately fused into a single verb:
   *  exposing a separate "stop" would invite callers to leave the
   *  server dead, breaking the "standalone server is always running"
   *  invariant the rest of the app relies on (settings menu, model
   *  picker, capability probe all need a live `/health`).
   *
   *  Idempotent across the pipeline lock; concurrent callers receive
   *  the same promise. */
  const { checkStatus } = engine
  const restartServer = useCallback(
    (): Promise<LifecycleState> =>
      runExclusive(async () => {
        setState({ kind: 'preparing' })
        return await restartPipeline(checkStatus)
      }),
    [runExclusive, checkStatus]
  )

  const reinstallEngine = useCallback(
    (mode: 'fix' | 'nuke' = 'fix'): Promise<LifecycleState> =>
      runExclusive(async () => {
        setState({ kind: 'preparing' })
        return await reinstallPipeline(mode, checkStatus)
      }),
    [runExclusive, checkStatus]
  )

  const ensureReady = useCallback(async (): Promise<LifecycleState> => {
    while (true) {
      // In-flight check goes before the state check so a freshly-fired
      // pipeline (e.g. `useEngineRespawn`'s `restartServer()`) wins over
      // a stale `'ready'` snapshot — `setState({preparing})` inside the
      // pipeline is async, so `stateRef.current` can still read the old
      // `'ready'` for a tick after the pipeline kicks off. Without this
      // order, warm-connect would return ready and attach to the doomed
      // old process before the new one comes up.
      if (inFlightRef.current) {
        await inFlightRef.current
        continue
      }
      const current = stateRef.current
      if (current.kind === 'ready' || current.kind === 'failed') return current
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

  // Reconcile `state.kind === 'ready'` with whether the server is
  // *actually* running. The state machine can drift from reality if
  // the server crashes on its own — there are no longer any callers
  // that intentionally kill it without going through `restartServer`
  // (which keeps the state honest), but a Python crash, OOM kill,
  // user-side `pkill`, etc. would all leave `state.kind === 'ready'`
  // pointing at a dead process. Auto-recover by firing a fresh
  // `restartServer`. Gated on `engine.status !== null` so the very
  // first probe (which races mount) doesn't trip the recovery before
  // status is known. The `runExclusive` lock means concurrent
  // restarts coalesce — once `state.kind` moves to `'preparing'`,
  // this effect re-runs and bails on the kind check.
  useEffect(() => {
    if (!isStandaloneMode) return
    if (state.kind !== 'ready') return
    if (engine.status === null) return
    if (engine.isServerRunning) return
    log.warn('Standalone server not running while lifecycle state is ready - auto-recovering')
    void restartServer().catch((err) => log.error('Auto-recover restart failed:', errorMessage(err)))
  }, [isStandaloneMode, state.kind, engine.status, engine.isServerRunning, restartServer])

  // Fires on mount and whenever `isStandaloneMode` flips (e.g. user
  // toggling engine_mode in settings). The `runExclusive` lock handles
  // StrictMode's dev double-mount and any in-flight reinstall — concurrent
  // calls coalesce on the same pipeline promise.
  useEffect(() => {
    void runExclusive(async () => {
      if (isStandaloneMode) setState({ kind: 'preparing' })
      return await orchestratePipeline(isStandaloneMode, checkStatus)
    })
  }, [isStandaloneMode, runExclusive, checkStatus])

  const setDraftStandalone = useCallback((value: boolean | null) => {
    setDraftStandaloneState(value)
  }, [])

  const value = useMemo<EngineLifecycleContextValue>(
    () => ({
      state,
      status: engine.status,
      isReady: engine.isReady,
      isRunning: engine.isServerRunning,
      serverLogPath: engine.serverLogPath,
      check: engine.checkStatus,
      probeServerHealth: engine.probeServerHealth,
      reinstallEngine,
      restartServer,
      ensureReady,
      abortReinstall,
      setDraftStandalone
    }),
    [
      state,
      engine.status,
      engine.isReady,
      engine.isServerRunning,
      engine.serverLogPath,
      engine.checkStatus,
      engine.probeServerHealth,
      reinstallEngine,
      restartServer,
      ensureReady,
      abortReinstall,
      setDraftStandalone
    ]
  )

  return <EngineLifecycleContext.Provider value={value}>{children}</EngineLifecycleContext.Provider>
}

// --- pipeline internals -----------------------------------------------------
//
// Free functions used by the provider above. They take the deps they need
// (notably `checkStatus`) as explicit arguments so the data flow is visible
// at the call site; the provider keeps ownership of the lock, refs, and
// `setState` bookkeeping.

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

/** Best-effort stop of the standalone server. Failures are logged and
 *  swallowed — the IPC handler is idempotent and there's nothing
 *  actionable to do if it wasn't running. */
const stopServer = async (context: string): Promise<void> => {
  try {
    await invoke('stop-engine-server')
  } catch (e) {
    log.warn(`stop-engine-server during ${context} failed:`, errorMessage(e))
  }
}

/** Spawn the server, poll `/health` until it's ready (or the process
 *  dies), and refresh engine status before returning. The status
 *  refresh is part of the contract: it keeps `isServerRunning` /
 *  `serverPort` honest for the auto-recover effect and any consumer
 *  that reads them right after a state transition. */
const startServer = async (checkStatus: () => Promise<unknown>): Promise<LifecycleState> => {
  try {
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
      if (probe.ok) {
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
  } finally {
    await checkStatus()
  }
}

/** Pipeline body for `restartServer`: kill the running process, spawn
 *  a fresh one. */
const restartPipeline = async (checkStatus: () => Promise<unknown>): Promise<LifecycleState> => {
  log.info('Restarting server')
  await stopServer('restart')
  return await startServer(checkStatus)
}

/** Pipeline body for `reinstallEngine`: stop the server, run the
 *  install command, spawn a fresh server against the new deps. */
const reinstallPipeline = async (
  mode: 'fix' | 'nuke',
  checkStatus: () => Promise<unknown>
): Promise<LifecycleState> => {
  // Stop the running server (if any) so the freshly-installed deps
  // run against a fresh process. No-op when the server isn't running;
  // the IPC handler is idempotent.
  log.info('Stopping server before reinstall')
  await stopServer('reinstall')

  const command = mode === 'nuke' ? 'nuke-and-reinstall-engine' : 'reinstall-engine'
  log.info('Running', command)
  try {
    await invoke(command)
  } catch (e) {
    const msg = errorMessage(e)
    log.error(`${command} failed:`, msg)
    return { kind: 'failed', error: msg }
  }

  return await startServer(checkStatus)
}

/** Pipeline body for the on-mount / mode-switch orchestrate. In server
 *  mode we only need to stop any leftover local server; in standalone
 *  mode we unpack files, validate deps, and adopt-or-spawn. */
const orchestratePipeline = async (
  isStandaloneMode: boolean,
  checkStatus: () => Promise<unknown>
): Promise<LifecycleState> => {
  if (!isStandaloneMode) {
    // Server mode: no local boot. Stop any local server left over
    // from a previous standalone session so it doesn't keep running
    // unused — useEngineRespawn skips this teardown when the user
    // toggles modes from the main menu (its guard is mid-stream-only),
    // so the lifecycle has to handle it.
    log.info('Server mode: skipping local startup orchestration')
    await stopServer('mode switch')
    return { kind: 'ready' }
  }

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

  return await startServer(checkStatus)
}
