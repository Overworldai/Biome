import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { registerAllIpc } from './ipc/index.js'
import { stopServerSync } from './lib/serverState.js'
import { setupBundledSeeds } from './lib/seeds.js'
// Handle Squirrel.Windows events (install/update/uninstall)
if (process.platform === 'win32') {
  const squirrelArg = process.argv[1]

  if (squirrelArg === '--squirrel-uninstall') {
    // Clean up runtime data directories, preserving user uploads
    const exeDir = path.dirname(process.execPath)
    const worldEngineDir = path.join(exeDir, 'world_engine')
    const uploadsDir = path.join(worldEngineDir, 'seeds', 'uploads')
    const uvDir = path.join(exeDir, '.uv')

    try {
      // Check if user has uploaded seeds
      let hasUploads = false
      try {
        const entries = fs.readdirSync(uploadsDir)
        hasUploads = entries.length > 0
      } catch {
        // uploads dir doesn't exist, nothing to preserve
      }

      if (hasUploads) {
        // Preserve uploads: move to temp, nuke world_engine, restore
        const tempUploads = path.join(exeDir, '_biome_keep_uploads')
        fs.rmSync(tempUploads, { recursive: true, force: true })
        fs.renameSync(uploadsDir, tempUploads)
        fs.rmSync(worldEngineDir, { recursive: true, force: true })
        fs.mkdirSync(path.join(worldEngineDir, 'seeds'), { recursive: true })
        fs.renameSync(tempUploads, uploadsDir)
      } else {
        fs.rmSync(worldEngineDir, { recursive: true, force: true })
      }

      fs.rmSync(uvDir, { recursive: true, force: true })
    } catch (err) {
      console.error('[UNINSTALL] Cleanup error:', err)
    }

    process.exit(0)
  }

  if (
    squirrelArg === '--squirrel-install' ||
    squirrelArg === '--squirrel-updated' ||
    squirrelArg === '--squirrel-obsolete'
  ) {
    process.exit(0)
  }
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

let mainWindow: BrowserWindow | null = null

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 500,
    minWidth: 800,
    minHeight: 500,
    maximizable: false,
    resizable: true,
    center: true,
    title: 'Biome',
    icon: path.join(__dirname, '../../app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
  }

  // Forward resize events to renderer
  mainWindow.on('resize', () => {
    if (!mainWindow) return
    const [width, height] = mainWindow.getSize()
    mainWindow.webContents.send('window-resized', { width, height })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  registerAllIpc()

  // Setup bundled seeds on first run
  try {
    await setupBundledSeeds()
  } catch (err) {
    console.error('[SEEDS] Warning: Failed to setup bundled seeds:', err)
  }

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', () => {
  console.log('[ENGINE] App quitting, stopping server...')
  stopServerSync()
})

process.on('SIGINT', () => {
  console.log('[ENGINE] Received SIGINT, stopping server...')
  stopServerSync()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('[ENGINE] Received SIGTERM, stopping server...')
  stopServerSync()
  process.exit(0)
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
