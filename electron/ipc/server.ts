import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { getEngineDir, getUvDir, getHfHomeDir, getHfHubCacheDir } from '../lib/paths.js'
import { getUvBinaryPath, getUvEnvVars } from '../lib/uv.js'
import { getHiddenWindowOptions } from '../lib/platform.js'
import {
  getServerState,
  setServerProcess,
  setServerReady,
  clearServerState,
  stopServerSync
} from '../lib/serverState.js'
import { copyServerComponentFiles } from '../lib/serverFiles.js'
import { emitToAllWindows } from '../lib/ipcUtils.js'

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

const IS_MACOS = process.platform === 'darwin'

export function registerServerIpc(): void {
  ipcMain.handle('start-engine-server', async (_event, port: number) => {
    if (IS_MACOS) {
      throw new Error('Standalone mode is unavailable on macOS. Use server mode with a remote World Engine.')
    }

    const engineDir = getEngineDir()
    const uvDir = getUvDir()
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

    console.log(`[ENGINE] Starting server on port ${port}...`)
    console.log(`[ENGINE] Engine dir: ${engineDir}`)
    console.log(`[ENGINE] UV binary: ${uvBinary}`)

    // Build env for server process
    const serverEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...uvEnv,
      HF_HOME: hfHomeDir,
      HF_HUB_CACHE: hfHubCacheDir,
      HUGGINGFACE_HUB_CACHE: hfHubCacheDir,
      PYTHONUNBUFFERED: '1',
      PYTHONFAULTHANDLER: '1',
      BIOME_SERVER_LOG_PATH: path.join(engineDir, 'server.log')
    }

    // Create log file path
    const logFilePath = path.join(engineDir, 'server.log')

    // Base args for the server. Note that we use localhost for the host to prevent
    // the Windows firewall for asking for permissions to expose the server to
    // the world
    const baseServerArgs = ['run', 'python', '-u', 'server.py', '--host', '127.0.0.1', '--port', String(port)]

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
    console.log(`[ENGINE] Server process spawned with PID: ${pid}`)
    fs.writeFileSync(logFilePath, '', 'utf-8')

    // Process stdout — write to console, log file, and forward to renderer
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        console.log(`[SERVER] ${line}`)
        fs.appendFileSync(logFilePath, line + '\n', 'utf-8')
        emitToAllWindows('engine-log', { line, is_stderr: false })
      })
    }

    // Process stderr — write to console, log file, and forward to renderer
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr })
      rl.on('line', (line) => {
        console.log(`[SERVER] ${line}`)
        fs.appendFileSync(logFilePath, line + '\n', 'utf-8')
        emitToAllWindows('engine-log', { line, is_stderr: true })
      })
    }

    // Handle process exit
    child.on('exit', (code, signal) => {
      console.log(`[ENGINE] Server process exited (code: ${code}, signal: ${signal})`)
      clearServerState()
    })

    // Store process handle
    setServerProcess(child, port)

    // Wait a moment and check if the process crashed immediately
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (!child.exitCode && child.exitCode !== 0) {
      // Still running
      console.log('[ENGINE] Server process is running')
    } else if (child.exitCode !== null) {
      // Process exited immediately
      clearServerState()

      let errorExcerpt = ''
      if (fs.existsSync(logFilePath)) {
        const logContents = fs.readFileSync(logFilePath, 'utf-8')
        errorExcerpt = logContents.split('\n').slice(-30).join('\n')
      }

      throw new Error(
        `Server process exited immediately with status: ${child.exitCode}\n\nLast log output:\n${errorExcerpt}`
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

  ipcMain.handle('probe-server-health', async (_event, healthUrl: string, timeoutMs?: number) => {
    const timeout = Math.max(500, Math.min(10000, Number(timeoutMs ?? 2500)))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal
      })
      if (response.ok) {
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
      }
      return response.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  })
}
