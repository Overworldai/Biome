import { ipcMain, shell, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { getEngineDir, getUvDir, getResourcePath, SERVER_COMPONENT_FILES } from '../lib/paths.js'
import { getUvBinaryPath, getUvEnvVars } from '../lib/uv.js'
import { getHiddenWindowOptions, getUvArchiveName, getVenvPythonPath } from '../lib/platform.js'
import { getServerState } from '../lib/serverState.js'

const UV_VERSION = '0.9.26'

function emitToAllWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}

function logEngineToConsoleAndUi(message: string): void {
  console.log(message)
  emitToAllWindows('server-log', message)
}

async function runUvSyncWithMirroredLogs(uvBinary: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(uvBinary, ['sync', '--verbose', '--index-strategy', 'unsafe-best-match'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...getHiddenWindowOptions()
    })

    const tail: string[] = []
    const handleLine = (line: string, isStderr: boolean) => {
      const prefixed = `[ENGINE] ${line}`
      if (isStderr) {
        console.error(prefixed)
      } else {
        console.log(prefixed)
      }
      emitToAllWindows('server-log', prefixed)
      tail.push(prefixed)
      if (tail.length > 80) tail.shift()
    }

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => handleLine(line, false))
    }
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr })
      rl.on('line', (line) => handleLine(line, true))
    }

    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`uv sync failed (exit ${code ?? 'unknown'})\n${tail.join('\n')}`))
    })
  })
}

/** Unpack bundled server files to the engine directory */
function unpackServerFilesInner(force: boolean): string {
  const engineDir = getEngineDir()
  fs.mkdirSync(engineDir, { recursive: true })

  const resourceDir = getResourcePath('server-components')
  const unpacked: string[] = []

  for (const filename of SERVER_COMPONENT_FILES) {
    const destPath = path.join(engineDir, filename)

    if (force || !fs.existsSync(destPath)) {
      const srcPath = path.join(resourceDir, filename)
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath)
        unpacked.push(filename)
      }
    }
  }

  if (unpacked.length === 0) {
    return 'Files already exist, skipped unpacking'
  }
  return `Unpacked: ${unpacked.join(', ')}`
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
  ipcMain.handle('check-engine-status', (_event, source?: string) => {
    const caller = source ?? 'unknown'
    logEngineToConsoleAndUi(`[ENGINE] check-engine-status: start (caller=${caller})`)
    const engineDir = getEngineDir()
    const uvBinary = getUvBinaryPath()
    const uvDir = getUvDir()
    const uvEnv = getUvEnvVars()

    // Check if our local uv binary exists and works
    let uvInstalled = false
    if (fs.existsSync(uvBinary)) {
      try {
        logEngineToConsoleAndUi('[ENGINE] check-engine-status: validating uv binary...')
        execFileSync(uvBinary, ['--version'], {
          ...getHiddenWindowOptions(),
          stdio: 'pipe'
        })
        uvInstalled = true
        logEngineToConsoleAndUi('[ENGINE] check-engine-status: uv binary ok')
      } catch {
        uvInstalled = false
        logEngineToConsoleAndUi('[ENGINE] check-engine-status: uv binary validation failed')
      }
    }

    // Check if server components are installed
    const repoCloned =
      fs.existsSync(engineDir) &&
      fs.existsSync(path.join(engineDir, 'pyproject.toml')) &&
      fs.existsSync(path.join(engineDir, 'server.py'))

    // Check if dependencies are synced
    let dependenciesSynced = false
    if (repoCloned && fs.existsSync(path.join(engineDir, '.venv'))) {
      const pythonPath = getVenvPythonPath(engineDir)
      if (fs.existsSync(pythonPath)) {
        try {
          logEngineToConsoleAndUi(
            '[ENGINE] check-engine-status: validating synced dependencies via uv run python --version...'
          )
          execFileSync(uvBinary, ['run', 'python', '--version'], {
            cwd: engineDir,
            env: { ...process.env, ...uvEnv, UV_FROZEN: '1' },
            ...getHiddenWindowOptions(),
            stdio: 'pipe'
          })
          dependenciesSynced = true
          logEngineToConsoleAndUi('[ENGINE] check-engine-status: dependency validation ok')
        } catch {
          dependenciesSynced = false
          logEngineToConsoleAndUi('[ENGINE] check-engine-status: dependency validation failed')
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
    logEngineToConsoleAndUi(`[ENGINE] check-engine-status: result ${JSON.stringify(result)}`)
    return result
  })

  ipcMain.handle('install-uv', async () => {
    return installUv()
  })

  ipcMain.handle('setup-server-components', () => {
    const engineDir = getEngineDir()
    fs.mkdirSync(engineDir, { recursive: true })

    const resourceDir = getResourcePath('server-components')
    for (const filename of SERVER_COMPONENT_FILES) {
      const srcPath = path.join(resourceDir, filename)
      const destPath = path.join(engineDir, filename)
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath)
      }
    }

    return 'Server components installed'
  })

  ipcMain.handle('sync-engine-dependencies', async () => {
    const engineDir = getEngineDir()
    const uvDir = getUvDir()
    const uvBinary = getUvBinaryPath()
    const uvEnv = getUvEnvVars()

    if (!fs.existsSync(engineDir)) {
      throw new Error('Engine repository not found. Please clone it first.')
    }

    // Create .uv directories
    for (const subdir of ['cache', 'python_install', 'python_bin', 'tool', 'tool_bin']) {
      fs.mkdirSync(path.join(uvDir, subdir), { recursive: true })
    }

    if (!fs.existsSync(uvBinary)) {
      throw new Error('uv is not installed. Please install it first.')
    }

    logEngineToConsoleAndUi('[ENGINE] Running uv sync for engine dependencies...')
    await runUvSyncWithMirroredLogs(uvBinary, engineDir, {
      ...process.env,
      ...uvEnv,
      UV_LINK_MODE: 'copy',
      UV_NO_EDITABLE: '1',
      UV_MANAGED_PYTHON: '1'
    })
    logEngineToConsoleAndUi('[ENGINE] uv sync finished for engine dependencies')

    return 'Dependencies synced successfully'
  })

  ipcMain.handle('setup-engine', async () => {
    const uvBinary = getUvBinaryPath()

    // Step 1: Check/install uv
    if (!fs.existsSync(uvBinary)) {
      await installUv()
    }

    // Step 2: Setup server components (force overwrite)
    unpackServerFilesInner(true)

    // Step 3: Sync dependencies
    const engineDir = getEngineDir()
    const uvDir = getUvDir()
    const uvEnv = getUvEnvVars()

    for (const subdir of ['cache', 'python_install', 'python_bin', 'tool', 'tool_bin']) {
      fs.mkdirSync(path.join(uvDir, subdir), { recursive: true })
    }

    logEngineToConsoleAndUi('[ENGINE] Running uv sync during setup-engine...')
    await runUvSyncWithMirroredLogs(getUvBinaryPath(), engineDir, {
      ...process.env,
      ...uvEnv,
      UV_LINK_MODE: 'copy',
      UV_NO_EDITABLE: '1',
      UV_MANAGED_PYTHON: '1'
    })
    logEngineToConsoleAndUi('[ENGINE] uv sync finished during setup-engine')

    return 'Engine setup complete'
  })

  ipcMain.handle('unpack-server-files', (_event, force: boolean) => {
    return unpackServerFilesInner(force)
  })

  ipcMain.handle('get-engine-dir-path', () => {
    return getEngineDir()
  })

  ipcMain.handle('open-engine-dir', () => {
    const engineDir = getEngineDir()
    if (!fs.existsSync(engineDir)) {
      fs.mkdirSync(engineDir, { recursive: true })
    }
    shell.showItemInFolder(engineDir)
  })
}
