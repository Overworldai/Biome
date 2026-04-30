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
import { getOfflineEnv } from './settings.js'

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

  console.log('[ENGINE] Running uv sync for engine dependencies...')
  await runUvSyncWithMirroredLogs(
    uvBinary,
    engineDir,
    { ...process.env, ...uvEnv, ...getOfflineEnv() },
    {
      logPrefix: '[ENGINE]',
      signal,
      onLine: (line, isStderr) => {
        emitToAllWindows('engine-log', { line, is_stderr: isStderr })
      }
    }
  )
  console.log('[ENGINE] uv sync finished for engine dependencies')
}

/** Full engine setup: install UV if needed, copy server components, sync dependencies. */
async function reinstallEngine(signal?: AbortSignal): Promise<void> {
  emitToAllWindows('engine-log', { line: '[ENGINE] Checking uv installation...', is_stderr: false })
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
    emitToAllWindows('engine-log', { line: '[ENGINE] Installing uv...', is_stderr: false })
    await installUv()
  }

  emitToAllWindows('engine-log', { line: '[ENGINE] Setting up server components...', is_stderr: false })
  copyServerComponentFiles(getEngineDir())

  emitToAllWindows('engine-log', {
    line: '[ENGINE] Syncing dependencies (this may take a while)...',
    is_stderr: false
  })
  await syncEngineDependencies(signal)

  emitToAllWindows('engine-log', { line: '[ENGINE] Setup complete.', is_stderr: false })
}

/** Nuke engine and UV directories. */
function nukeEngineDirectories(): void {
  stopServerSync()

  const engineDir = getEngineDir()
  const uvDir = getUvDir()

  if (fs.existsSync(engineDir)) {
    fs.rmSync(engineDir, { recursive: true, force: true })
    emitToAllWindows('engine-log', { line: `[ENGINE] Removed ${engineDir}`, is_stderr: false })
  }
  if (fs.existsSync(uvDir)) {
    fs.rmSync(uvDir, { recursive: true, force: true })
    emitToAllWindows('engine-log', { line: `[ENGINE] Removed ${uvDir}`, is_stderr: false })
  }
}

async function installUv(): Promise<string> {
  const uvDir = getUvDir()
  const binDir = path.join(uvDir, 'bin')
  fs.mkdirSync(binDir, { recursive: true })

  const archiveName = getUvArchiveName()
  const downloadUrl = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${archiveName}`

  console.log(`[ENGINE] Downloading uv from ${downloadUrl}`)
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
    console.log(`[ENGINE] check-engine-status: start (caller=${caller})`)
    const engineDir = getEngineDir()
    const uvBinary = getUvBinaryPath()
    const uvEnv = getUvEnvVars()

    // Check if our local uv binary exists and works
    let uvInstalled = false
    if (fs.existsSync(uvBinary)) {
      try {
        console.log('[ENGINE] check-engine-status: validating uv binary...')
        await execFileAsync(uvBinary, ['--version'], {
          ...getHiddenWindowOptions()
        })
        uvInstalled = true
        console.log('[ENGINE] check-engine-status: uv binary ok')
      } catch {
        uvInstalled = false
        console.log('[ENGINE] check-engine-status: uv binary validation failed')
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
          console.log('[ENGINE] check-engine-status: validating synced dependencies via uv run python --version...')
          await execFileAsync(uvBinary, ['run', 'python', '--version'], {
            cwd: engineDir,
            env: { ...process.env, ...uvEnv, UV_FROZEN: '1' },
            ...getHiddenWindowOptions()
          })
          dependenciesSynced = true
          console.log('[ENGINE] check-engine-status: dependency validation ok')
        } catch {
          dependenciesSynced = false
          console.log('[ENGINE] check-engine-status: dependency validation failed')
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
    console.log(`[ENGINE] check-engine-status: result ${JSON.stringify(result)}`)
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
