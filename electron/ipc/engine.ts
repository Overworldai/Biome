import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { getEngineDir, getUvDir } from '../lib/paths.js'
import { getUvBinaryPath, getUvEnvVars } from '../lib/uv.js'
import { getHiddenWindowOptions, getUvArchiveName, getVenvPythonPath } from '../lib/platform.js'
import { getServerState, stopServerSync } from '../lib/serverState.js'
import { runUvSyncWithMirroredLogs } from '../lib/uvSync.js'
import { copyServerComponentFiles, ensureEngineFont } from '../lib/serverFiles.js'
import { emitToAllWindows } from '../lib/ipcUtils.js'
import { parseLogLine } from '../lib/logRecord.js'
import { getLogger, recordElectronLog } from '../lib/logger.js'
import { getOfflineEnv } from './settings.js'

// `engine.setup` covers the user-visible phases (install uv, sync deps,
// copy components, nuke); each call surfaces in the renderer's log buffer
// via `defaultBroadcast: true`. `engine.diagnostics` is internal noise
// from `check-engine-status` — kept on the Electron-side console only.
const setupLog = getLogger('engine.setup', { defaultBroadcast: true })
const diagLog = getLogger('engine.diagnostics')

const UV_VERSION = '0.10.9'
let engineInstallAbortController: AbortController | null = null

function execFileAsync(file: string, args: string[], options?: Parameters<typeof execFile>[2]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options ?? {}, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

/** Unpack bundled server files to the engine directory */
function unpackServerFilesInner(force: boolean): string {
  if (force) {
    copyServerComponentFiles(getEngineDir())
    return 'Unpacked all server component files (forced)'
  }

  const engineDir = getEngineDir()
  const hasKey = fs.existsSync(path.join(engineDir, 'pyproject.toml')) && fs.existsSync(path.join(engineDir, 'main.py'))
  if (hasKey) {
    // Re-run the font copy so upgrades from older installs (which didn't
    // unpack fonts) pick it up without a full reinstall.
    ensureEngineFont(engineDir)
    return 'Files already exist, skipped unpacking'
  }

  copyServerComponentFiles(engineDir)
  return 'Unpacked all server component files'
}

/** Create .uv subdirectories, then run uv sync with mirrored logs. */
async function syncEngineDependencies(signal?: AbortSignal): Promise<void> {
  const engineDir = getEngineDir()
  const uvDir = getUvDir()
  const uvBinary = getUvBinaryPath()
  const uvEnv = getUvEnvVars()

  if (!fs.existsSync(engineDir)) {
    throw new Error('Engine repository not found. Please clone it first.')
  }
  if (!fs.existsSync(uvBinary)) {
    throw new Error('uv is not installed. Please install it first.')
  }

  // Create .uv directories
  for (const subdir of ['cache', 'python_install', 'python_bin', 'tool', 'tool_bin']) {
    fs.mkdirSync(path.join(uvDir, subdir), { recursive: true })
  }

  setupLog.info('Running uv sync for engine dependencies')
  await runUvSyncWithMirroredLogs(
    uvBinary,
    engineDir,
    { ...process.env, ...uvEnv, ...getOfflineEnv() },
    {
      signal,
      onLine: (line, isStderr) => {
        // uv sync output exists nowhere else (Python's `server.log`
        // covers the Python server's own stdout, not uv's), so we
        // record it into the rolling buffer here so the diagnostic
        // export captures install-time errors.
        const record = parseLogLine(line, isStderr, 'engine.uv-sync')
        recordElectronLog(record)
        emitToAllWindows('engine-log', record)
      }
    }
  )
  setupLog.info('uv sync finished for engine dependencies')
}

/** Full engine setup: install UV if needed, copy server components, sync dependencies. */
async function reinstallEngine(signal?: AbortSignal): Promise<void> {
  setupLog.info('Checking uv installation')
  const uvBinary = getUvBinaryPath()

  let uvInstalled = false
  if (fs.existsSync(uvBinary)) {
    try {
      await execFileAsync(uvBinary, ['--version'], { ...getHiddenWindowOptions() })
      uvInstalled = true
    } catch {
      uvInstalled = false
    }
  }

  if (!uvInstalled) {
    setupLog.info('Installing uv')
    await installUv()
  }

  setupLog.info('Setting up server components')
  copyServerComponentFiles(getEngineDir())

  setupLog.info('Syncing dependencies (this may take a while)')
  await syncEngineDependencies(signal)

  setupLog.info('Setup complete')
}

/** Nuke engine and UV directories. */
function nukeEngineDirectories(): void {
  stopServerSync()

  const engineDir = getEngineDir()
  const uvDir = getUvDir()

  if (fs.existsSync(engineDir)) {
    fs.rmSync(engineDir, { recursive: true, force: true })
    setupLog.info('Removed engine directory', { fields: { path: engineDir } })
  }
  if (fs.existsSync(uvDir)) {
    fs.rmSync(uvDir, { recursive: true, force: true })
    setupLog.info('Removed UV directory', { fields: { path: uvDir } })
  }
}

async function installUv(): Promise<string> {
  const uvDir = getUvDir()
  const binDir = path.join(uvDir, 'bin')
  fs.mkdirSync(binDir, { recursive: true })

  const archiveName = getUvArchiveName()
  const downloadUrl = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${archiveName}`

  setupLog.info('Downloading uv', { fields: { url: downloadUrl } })
  const response = await fetch(downloadUrl)
  if (!response.ok) {
    throw new Error(`Failed to download uv: HTTP ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  if (archiveName.endsWith('.zip')) {
    // Windows: extract zip
    const AdmZip = (await import('adm-zip')).default
    const zip = new AdmZip(buffer)
    const entries = zip.getEntries()

    for (const entry of entries) {
      if (entry.entryName.endsWith('uv.exe')) {
        const destPath = path.join(binDir, 'uv.exe')
        fs.writeFileSync(destPath, entry.getData())
        break
      }
    }
  } else {
    // Linux/macOS: extract tar.gz
    const { extract } = await import('tar')
    const tmpPath = path.join(uvDir, 'uv-download.tar.gz')
    fs.writeFileSync(tmpPath, buffer)

    await extract({
      file: tmpPath,
      cwd: uvDir,
      filter: (entryPath) => {
        return entryPath.endsWith('/uv') && !entryPath.endsWith('/uvx')
      }
    })

    // Find the extracted uv binary and move it to bin/
    // tar extracts into a subdirectory like uv-x86_64-unknown-linux-gnu/uv
    const extractedDirs = fs
      .readdirSync(uvDir)
      .filter((d) => d.startsWith('uv-') && fs.statSync(path.join(uvDir, d)).isDirectory())

    for (const dir of extractedDirs) {
      const extractedUv = path.join(uvDir, dir, 'uv')
      if (fs.existsSync(extractedUv)) {
        const destPath = path.join(binDir, 'uv')
        fs.copyFileSync(extractedUv, destPath)
        fs.chmodSync(destPath, 0o755)

        // Clean up extracted directory
        fs.rmSync(path.join(uvDir, dir), { recursive: true, force: true })
        break
      }
    }

    // Clean up temp file
    fs.rmSync(tmpPath, { force: true })
  }

  return `uv ${UV_VERSION} installed successfully`
}

export function registerEngineIpc(): void {
  ipcMain.handle('check-engine-status', async (_event, source?: string) => {
    const caller = source ?? 'unknown'
    diagLog.info('check-engine-status: start', { fields: { caller } })
    const engineDir = getEngineDir()
    const uvBinary = getUvBinaryPath()
    const uvEnv = getUvEnvVars()

    // Check if our local uv binary exists and works
    let uvInstalled = false
    if (fs.existsSync(uvBinary)) {
      try {
        diagLog.info('check-engine-status: validating uv binary')
        await execFileAsync(uvBinary, ['--version'], {
          ...getHiddenWindowOptions()
        })
        uvInstalled = true
        diagLog.info('check-engine-status: uv binary ok')
      } catch {
        uvInstalled = false
        diagLog.info('check-engine-status: uv binary validation failed')
      }
    }

    // Check if server components are installed
    const repoCloned =
      fs.existsSync(engineDir) &&
      fs.existsSync(path.join(engineDir, 'pyproject.toml')) &&
      fs.existsSync(path.join(engineDir, 'main.py'))

    // Check if dependencies are synced
    let dependenciesSynced = false
    if (repoCloned && fs.existsSync(path.join(engineDir, '.venv'))) {
      const pythonPath = getVenvPythonPath(engineDir)
      if (fs.existsSync(pythonPath)) {
        try {
          diagLog.info('check-engine-status: validating synced dependencies via uv run python --version')
          await execFileAsync(uvBinary, ['run', 'python', '--version'], {
            cwd: engineDir,
            env: { ...process.env, ...uvEnv, UV_FROZEN: '1' },
            ...getHiddenWindowOptions()
          })
          dependenciesSynced = true
          diagLog.info('check-engine-status: dependency validation ok')
        } catch (err) {
          dependenciesSynced = false
          const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string; code?: number }
          const stderr = e.stderr?.toString() ?? ''
          const stdout = e.stdout?.toString() ?? ''
          diagLog.info('check-engine-status: dependency validation failed', {
            fields: {
              exit_code: e.code ?? -1,
              stderr: stderr.trim() || undefined,
              stdout: stdout.trim() || undefined,
              message: !stderr && !stdout ? (e.message ?? '') : undefined
            }
          })
        }
      }
    }

    // Check if server is running
    const serverState = getServerState()
    const serverRunning = serverState.process !== null
    const serverPort = serverState.port

    const serverLogPath = path.join(engineDir, 'server.log')

    const result = {
      uv_installed: uvInstalled,
      repo_cloned: repoCloned,
      dependencies_synced: dependenciesSynced,
      server_running: serverRunning,
      server_port: serverPort,
      server_log_path: serverLogPath
    }
    diagLog.info('check-engine-status: result', {
      fields: {
        uv_installed: result.uv_installed,
        repo_cloned: result.repo_cloned,
        dependencies_synced: result.dependencies_synced,
        server_running: result.server_running
      }
    })
    return result
  })

  ipcMain.handle('unpack-server-files', (_event, force: boolean) => {
    return unpackServerFilesInner(force)
  })

  ipcMain.handle('reinstall-engine', async () => {
    if (engineInstallAbortController) {
      throw new Error('Engine install is already running')
    }

    engineInstallAbortController = new AbortController()
    try {
      await reinstallEngine(engineInstallAbortController.signal)
    } finally {
      engineInstallAbortController = null
    }

    return 'Engine reinstalled successfully'
  })

  ipcMain.handle('nuke-and-reinstall-engine', async () => {
    if (engineInstallAbortController) {
      throw new Error('Engine install is already running')
    }

    nukeEngineDirectories()

    engineInstallAbortController = new AbortController()
    try {
      await reinstallEngine(engineInstallAbortController.signal)
    } finally {
      engineInstallAbortController = null
    }

    return 'Engine nuked and reinstalled successfully'
  })

  ipcMain.handle('abort-engine-install', () => {
    if (!engineInstallAbortController) {
      return 'No engine install is currently running'
    }
    engineInstallAbortController.abort()
    return 'Engine install abort requested'
  })
}
