import type { ChildProcess } from 'node:child_process'
import treeKill from 'tree-kill'

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

/** Synchronously stop the running server process tree */
export function stopServerSync(): string | null {
  if (!state.process) {
    return null
  }

  const pid = state.process.pid
  console.log(`[ENGINE] Stopping server process tree (PID: ${pid})...`)

  if (pid) {
    try {
      if (process.platform !== 'win32') {
        // Unix: kill the entire process group (negative PID).
        // The server is spawned with detached:true to create a new group,
        // so this kills uv + python together.
        process.kill(-pid, 'SIGKILL')
        console.log('[ENGINE] SIGKILL sent to process group')
      } else {
        // Windows: use tree-kill to walk the process tree via taskkill
        treeKill(pid, 'SIGKILL')
        console.log('[ENGINE] Kill signal sent to process tree')
      }
    } catch (e) {
      console.log('[ENGINE] Process tree kill failed, falling back to direct kill:', e)
      state.process.kill('SIGKILL')
    }
  } else {
    state.process.kill('SIGKILL')
  }

  clearServerState()
  console.log('[ENGINE] Server stopped successfully')
  return pid ? `Server stopped (PID: ${pid})` : 'Server stopped'
}
