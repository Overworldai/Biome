import { ipcMain, BrowserWindow } from 'electron'
import { spawn, execFileSync } from 'node:child_process'
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
import { readConfigSync } from './config.js'

function emitToAllWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}

function processLogLine(line: string, _isStderr: boolean): void {
  // Print to console
  console.log(`[SERVER] ${line}`)

  // Emit event to frontend
  emitToAllWindows('server-log', line)

  // Check if server is ready
  if (line.includes('SERVER READY') || line.includes('Uvicorn running on')) {
    console.log('[ENGINE] Server ready signal detected!')
    setServerReady()
    emitToAllWindows('server-ready', true)
  }
}

export function registerServerIpc(): void {
  ipcMain.handle('start-engine-server', async (_event, port: number) => {
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
    const { getResourcePath } = await import('../lib/paths.js')
    const resourceDir = getResourcePath('src-tauri/server-components')
    const serverFiles = ['server.py', 'pyproject.toml', 'engine_manager.py', 'safety.py']
    for (const filename of serverFiles) {
      const srcPath = path.join(resourceDir, filename)
      const destPath = path.join(engineDir, filename)
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath)
      }
    }

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

    // Run uv sync before starting
    console.log('[ENGINE] Syncing dependencies...')
    try {
      execFileSync(uvBinary, ['sync', '--index-strategy', 'unsafe-best-match'], {
        cwd: engineDir,
        env: { ...process.env, ...uvEnv },
        ...getHiddenWindowOptions(),
        stdio: 'pipe',
        maxBuffer: 50 * 1024 * 1024
      })
      console.log('[ENGINE] Dependencies synced successfully')
    } catch (err) {
      console.log('[ENGINE] Warning: uv sync failed:', err)
      // Don't fail - deps might already be synced
    }

    // Build env for server process
    const serverEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...uvEnv,
      HF_HOME: hfHomeDir,
      HF_HUB_CACHE: hfHubCacheDir,
      HUGGINGFACE_HUB_CACHE: hfHubCacheDir,
      PYTHONUNBUFFERED: '1'
    }

    // Pass through HuggingFace token
    const config = readConfigSync()
    const hfToken = config.api_keys?.huggingface || process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || ''

    if (hfToken) {
      console.log(`[ENGINE] HuggingFace token configured (${Math.min(hfToken.length, 4)}... chars)`)
      serverEnv.HF_TOKEN = hfToken
      serverEnv.HUGGING_FACE_HUB_TOKEN = hfToken
    } else {
      console.log('[ENGINE] Warning: No HuggingFace token configured')
    }

    // Create log file path
    const logFilePath = path.join(engineDir, 'server.log')

    // Spawn the server
    const child = spawn(uvBinary, ['run', 'python', '-u', 'server.py', '--port', String(port)], {
      cwd: engineDir,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...getHiddenWindowOptions()
    })

    const pid = child.pid
    console.log(`[ENGINE] Server process spawned with PID: ${pid}`)

    // Open log file for appending
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' })

    // Process stdout
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        processLogLine(line, false)
        logStream.write(line + '\n')
      })
    }

    // Process stderr
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr })
      rl.on('line', (line) => {
        processLogLine(line, true)
        logStream.write(line + '\n')
      })
    }

    // Handle process exit
    child.on('exit', (code, signal) => {
      console.log(`[ENGINE] Server process exited (code: ${code}, signal: ${signal})`)
      logStream.end()
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
      throw new Error('No server is currently running')
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
    return getServerState().ready
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
}
