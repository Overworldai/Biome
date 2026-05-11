import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { getEngineDir, getHfHomeDir, getHfHubCacheDir } from '../lib/paths.js'
import { getUvBinaryPath, getUvEnvVars, getBundledPythonIncludeDir } from '../lib/uv.js'
import { getHiddenWindowOptions } from '../lib/platform.js'
import {
  getServerState,
  setServerProcess,
  setServerReady,
  clearServerState,
  stopServerSync
} from '../lib/serverState.js'
import { copyServerComponentFiles } from '../lib/serverFiles.js'
import { parseLogLine } from '../lib/logRecord.js'
import { getLogger } from '../lib/logger.js'
import { emitToAllWindows } from '../lib/ipcUtils.js'
import { getOfflineEnv } from './settings.js'
import type { ServerHealthResult } from '../../src/types/ipc.js'
import { ServerCapabilitiesSchema } from '../../src/types/protocol.generated.js'

const log = getLogger('engine.server')

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

// Last abnormal server-process exit tail (stderr/stdout), for classifying startup
// failures after start-engine-server has already returned success. Renderer fetches
// this via the get-last-server-exit-tail IPC when waitForHealthy sees a dead server.
let lastServerExitTail: string | null = null

const LOG_TAIL_MAX_LINES = 40

export function registerServerIpc(): void {
  ipcMain.handle('start-engine-server', async (_event, port: number) => {
    const engineDir = getEngineDir()
    const uvBinary = getUvBinaryPath()
    const uvEnv = getUvEnvVars()
    const hfHomeDir = getHfHomeDir()
    const hfHubCacheDir = getHfHubCacheDir()

    // Check if server is already running
    const state = getServerState()
    if (state.process) {
      throw new Error(`Server is already running on port ${state.port || 0}`)
    }

    // Force-overwrite bundled server components
    copyServerComponentFiles(engineDir)

    // Verify dependencies
    if (!fs.existsSync(path.join(engineDir, '.venv'))) {
      throw new Error('Engine dependencies not synced. Please run setup first.')
    }
    if (!fs.existsSync(uvBinary)) {
      throw new Error('uv is not installed. Please install it first.')
    }

    // Ensure HF cache dir exists
    fs.mkdirSync(hfHubCacheDir, { recursive: true })

    log.info('Starting server', { fields: { port, engine_dir: engineDir, uv_binary: uvBinary } })

    // Build env for server process
    const serverEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...uvEnv,
      HF_HOME: hfHomeDir,
      HF_HUB_CACHE: hfHubCacheDir,
      HUGGINGFACE_HUB_CACHE: hfHubCacheDir,
      HF_HUB_DOWNLOAD_TIMEOUT: '600',
      PYTHONUNBUFFERED: '1',
      PYTHONFAULTHANDLER: '1',
      BIOME_SERVER_LOG_PATH: path.join(engineDir, 'server.log'),
      // Pin the standalone-spawned server to JSON output regardless of what
      // the parent shell has set.  In standalone mode the child's stdout is
      // consumed by `parseLogLine` for the renderer's engine-log buffer; if
      // the dev sets `BIOME_LOG_FORMAT=text` in their shell, the inherited
      // value would degrade engineLogs to text-only fallback records.  The
      // dev's terminal still gets the JSON via our raw pass-through write,
      // so dropping into `jq` recovers the human-readable form when needed.
      BIOME_LOG_FORMAT: 'json',
      ...getOfflineEnv()
    }

    // Point the in-venv C compiler at the uv-managed Python headers so Triton's
    // runtime JIT can #include <Python.h>. python-build-standalone's sysconfig
    // reports an incorrect include path on NixOS; this override also helps
    // users on distros where the system Python headers are absent.
    const pythonIncludeDir = getBundledPythonIncludeDir()
    if (pythonIncludeDir) {
      const existingCPath = serverEnv.C_INCLUDE_PATH
      serverEnv.C_INCLUDE_PATH = existingCPath ? `${pythonIncludeDir}:${existingCPath}` : pythonIncludeDir
    }

    // Base args for the server. Note that we use localhost for the host to prevent
    // the Windows firewall for asking for permissions to expose the server to
    // the world. `--launched-from-standalone` flags this process as belonging
    // to a Biome standalone install — the renderer reads the bit back from
    // /health and uses it to refuse an own-managed URL in server mode.
    const baseServerArgs = [
      'run',
      'python',
      '-u',
      'main.py',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--launched-from-standalone'
    ]

    // python on win32 seems to have issues with --parent-pid correctly detecting parent pid and kills itself
    const serverArgs =
      process.platform === 'win32' ? baseServerArgs : [...baseServerArgs, '--parent-pid', String(process.pid)]

    // Spawn the server
    const child = spawn(uvBinary, serverArgs, {
      cwd: engineDir,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(process.platform !== 'win32' ? { detached: true } : {}), // Unix: new process group for clean kill
      ...getHiddenWindowOptions()
    })

    const pid = child.pid
    log.info('Server process spawned', { fields: { pid: pid ?? -1 } })

    // Rolling tail of recent stdout+stderr, drained from the line readers below.
    // Kept in memory so the exit handler and immediate-crash path don't need to
    // re-read the log file.
    const recentLines: string[] = []
    const handleLine = (line: string, isStderr: boolean) => {
      // Subprocess pass-through.  We write the raw line to our own
      // stdout/stderr (so the dev's terminal sees Python's output) and
      // forward a parsed `LogRecord` onto the `engine-log` IPC channel
      // for the renderer's on-screen log panel.  We do NOT record it
      // into the Electron rolling buffer or write it to `server.log` —
      // both would duplicate Python's own work: structlog already owns
      // the WS broadcast (→ `wsAllLogs` → diagnostic `server_logs`)
      // and `TeeStream` already mirrors stdout/stderr into `server.log`.
      const sink = isStderr ? process.stderr : process.stdout
      sink.write(line + '\n')
      emitToAllWindows('engine-log', parseLogLine(line, isStderr, 'engine.server'))
      recentLines.push(line)
      if (recentLines.length > LOG_TAIL_MAX_LINES) recentLines.shift()
    }

    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => handleLine(line, false))
    }
    if (child.stderr) {
      createInterface({ input: child.stderr }).on('line', (line) => handleLine(line, true))
    }

    lastServerExitTail = null

    child.on('exit', (code, signal) => {
      log.info('Server process exited', { fields: { code: code ?? -1, signal: signal ?? '' } })
      if (code !== 0 && code !== null) {
        lastServerExitTail = recentLines.join('\n')
      }
      clearServerState()
    })

    setServerProcess(child, port)

    // Wait a moment and check if the process crashed immediately
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (!child.exitCode && child.exitCode !== 0) {
      // Still running
      log.info('Server process is running')
    } else if (child.exitCode !== null) {
      // Process exited immediately
      clearServerState()
      throw new Error(
        `Server process exited immediately with status: ${child.exitCode}\n\nLast log output:\n${recentLines.join('\n')}`
      )
    }

    return `Server started on port ${port} (PID: ${pid})`
  })

  ipcMain.handle('stop-engine-server', () => {
    const result = stopServerSync()
    if (!result) {
      return 'Server already stopped'
    }
    return result
  })

  ipcMain.handle('is-server-running', () => {
    const state = getServerState()
    if (!state.process) return false

    // Check if process is still running
    if (state.process.exitCode !== null) {
      clearServerState()
      return false
    }

    return true
  })

  ipcMain.handle('is-server-ready', () => {
    const state = getServerState()
    // "Ready" is meaningful only for a managed local process.
    return Boolean(state.process) && state.ready
  })

  ipcMain.handle('get-last-server-exit-tail', () => lastServerExitTail)

  ipcMain.handle('is-port-in-use', (_event, port: number) => {
    return new Promise<boolean>((resolve) => {
      const server = net.createServer()
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true)
        } else {
          resolve(false)
        }
      })
      server.once('listening', () => {
        server.close(() => resolve(false))
      })
      server.listen(port, '127.0.0.1')
    })
  })

  // Probe a Biome server's /health endpoint.
  //
  //   - `ok` mirrors reachability — true on 2xx, false on any error or
  //     non-OK response.
  //   - `capabilities` is parsed through the codegen'd
  //     `ServerCapabilitiesSchema` so the option lists the server can
  //     report stay in lockstep with the Pydantic source. Missing /
  //     malformed / empty-axis capabilities degrade to `ok: true`
  //     without `capabilities`, and the renderer falls back to its
  //     client-side platform prediction.
  //   - `launched_from_standalone` is the server's own
  //     `launched_from_standalone` flag (set when Electron spawns the
  //     server in standalone mode). The settings panel uses it to refuse
  //     a server-mode URL that resolves to any standalone-managed
  //     server, since saving that pairing invites the next mode switch
  //     to tear the server down underneath the user.
  ipcMain.handle(
    'probe-server-health',
    async (_event, healthUrl: string, timeoutMs?: number): Promise<ServerHealthResult> => {
      const timeout = Math.max(500, Math.min(10000, Number(timeoutMs ?? 2500)))
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)

      try {
        const response = await fetch(healthUrl, {
          method: 'GET',
          signal: controller.signal
        })
        if (!response.ok) return { ok: false, launched_from_standalone: false }

        // Mark local managed server ready only when probe matches the running local server.
        try {
          const parsed = new URL(healthUrl)
          const parsedPort = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
          const state = getServerState()
          if (state.process && state.port === parsedPort && isLocalhost(parsed.hostname)) {
            setServerReady()
          }
        } catch {
          // Ignore URL parse issues for readiness marking; fetch result is still returned.
        }

        try {
          const body = (await response.json()) as {
            capabilities?: unknown
            launched_from_standalone?: boolean
          }
          const launchedFromStandalone = body.launched_from_standalone === true
          const parsed = ServerCapabilitiesSchema.safeParse(body.capabilities)
          // Each backend the server advertises must carry at least one
          // honourable quant; a half-populated matrix is worse than none
          // since the renderer can't tell which backend got dropped.
          const hasUsableMatrix =
            parsed.success &&
            parsed.data.backends.length > 0 &&
            parsed.data.backends.every((b) => (parsed.data.quants[b] ?? []).length > 0)
          if (hasUsableMatrix) {
            return {
              ok: true,
              capabilities: parsed.data,
              launched_from_standalone: launchedFromStandalone
            }
          }
          return { ok: true, launched_from_standalone: launchedFromStandalone }
        } catch {
          // Non-fatal — server reachable, body unparseable.
        }
        return { ok: true, launched_from_standalone: false }
      } catch {
        return { ok: false, launched_from_standalone: false }
      } finally {
        clearTimeout(timer)
      }
    }
  )
}
