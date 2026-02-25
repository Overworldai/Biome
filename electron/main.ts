import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { registerAllIpc } from './ipc/index.js'
import { stopServerSync } from './lib/serverState.js'
import { setupBundledSeeds } from './lib/seeds.js'

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
