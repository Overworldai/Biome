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
      treeKill(pid, 'SIGKILL')
      console.log('[ENGINE] Kill signal sent to process tree')
    } catch (e) {
      console.log('[ENGINE] tree-kill failed, falling back to direct kill:', e)
      state.process.kill('SIGKILL')
    }
  } else {
    state.process.kill('SIGKILL')
  }

  clearServerState()
  console.log('[ENGINE] Server stopped successfully')
  return pid ? `Server stopped (PID: ${pid})` : 'Server stopped'
}
