import type { ChildProcess } from 'node:child_process'
import treeKill from 'tree-kill'
import { getLogger } from './logger.js'

const log = getLogger('engine.server')

interface ServerState {
  process: ChildProcess | null
  port: number | null
  ready: boolean
}

const state: ServerState = {
  process: null,
  port: null,
  ready: false
}

export function getServerState(): ServerState {
  return state
}

export function setServerProcess(proc: ChildProcess, port: number): void {
  state.process = proc
  state.port = port
  state.ready = false
}

export function setServerReady(): void {
  state.ready = true
}

export function clearServerState(): void {
  state.process = null
  state.port = null
  state.ready = false
}

/** Synchronously stop the running server process tree (force-kill path). */
export function stopServerSync(): string | null {
  if (!state.process) {
    return null
  }

  const pid = state.process.pid
  log.info('Stopping server process tree', { fields: { pid: pid ?? -1 } })

  if (pid) {
    try {
      if (process.platform !== 'win32') {
        // Unix: kill the entire process group (negative PID).
        // The server is spawned with detached:true to create a new group,
        // so this kills uv + python together.
        process.kill(-pid, 'SIGKILL')
        log.info('SIGKILL sent to process group')
      } else {
        // Windows: use tree-kill to walk the process tree via taskkill
        treeKill(pid, 'SIGKILL')
        log.info('Kill signal sent to process tree')
      }
    } catch (e) {
      log.warning('Process tree kill failed, falling back to direct kill', {
        exception: e instanceof Error ? (e.stack ?? e.message) : String(e)
      })
      state.process.kill('SIGKILL')
    }
  } else {
    state.process.kill('SIGKILL')
  }

  clearServerState()
  log.info('Server stopped successfully')
  return pid ? `Server stopped (PID: ${pid})` : 'Server stopped'
}

/**
 * Stop the running server. First asks the server to shut itself down via
 * `POST /shutdown` so the FastAPI lifespan teardown runs (releasing GPU
 * memory, finalising recordings). Falls back to `stopServerSync` if the
 * HTTP request fails or the process hasn't exited within `gracePeriodMs`.
 *
 * Use this for any user-initiated or app-quit shutdown. Reserve
 * `stopServerSync` for emergency paths (uncaughtException, hard crash)
 * where there's no time to be polite.
 */
export async function stopServer({ gracePeriodMs = 10000 }: { gracePeriodMs?: number } = {}): Promise<string | null> {
  const proc = state.process
  const port = state.port
  if (!proc) {
    return null
  }
  const pid = proc.pid

  // If the process is already dead but `clearServerState` hasn't been
  // invoked yet (e.g. exit handler not yet fired), short-circuit.
  if (proc.exitCode !== null) {
    clearServerState()
    return pid ? `Server already exited (PID: ${pid})` : 'Server already exited'
  }

  // Set up the exit-detection promise before issuing the request so we
  // can't miss the event if the server exits before we start awaiting.
  const exitedNaturally = new Promise<boolean>((resolve) => {
    const onExit = () => resolve(true)
    proc.once('exit', onExit)
    setTimeout(() => {
      proc.removeListener('exit', onExit)
      resolve(false)
    }, gracePeriodMs).unref()
  })

  if (port !== null) {
    log.info('Requesting graceful shutdown', { fields: { pid: pid ?? -1, port } })
    try {
      await fetch(`http://127.0.0.1:${port}/shutdown`, {
        method: 'POST',
        signal: AbortSignal.timeout(500)
      })
    } catch (e) {
      // Server may already be dying or unreachable — fall through to the
      // process-exit wait, which will time out quickly and force-kill.
      log.warning('Shutdown request failed, will wait for exit then force-kill', {
        exception: e instanceof Error ? e.message : String(e)
      })
    }
  }

  const exited = await exitedNaturally
  if (exited) {
    log.info('Server exited gracefully', { fields: { pid: pid ?? -1 } })
    clearServerState()
    return pid ? `Server stopped gracefully (PID: ${pid})` : 'Server stopped gracefully'
  }

  log.warning('Graceful shutdown timed out, forcing kill', { fields: { pid: pid ?? -1, gracePeriodMs } })
  return stopServerSync()
}
