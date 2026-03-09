import { app, BrowserWindow, net, protocol, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { registerAllIpc } from './ipc/index.js'
import { stopServerSync } from './lib/serverState.js'
import { setupBundledSeeds } from './lib/seeds.js'
import { getBackgroundsDir } from './ipc/backgrounds.js'

// Register biome-bg as a privileged scheme so <video> elements can stream from it.
// Must be called before app.whenReady().
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'biome-bg',
    privileges: { standard: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

// Register biome-bg as a privileged scheme so <video> elements can stream from it.
// Must be called before app.whenReady().
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'biome-bg',
    privileges: { standard: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

let mainWindow: BrowserWindow | null = null

const resolveWindowIcon = (): string | Electron.NativeImage | undefined => {
  const icoPath = path.join(__dirname, '../../app-icon.ico')
  const pngPath = path.join(__dirname, '../../app-icon.png')
  const candidates = process.platform === 'linux' ? [pngPath, icoPath] : [icoPath, pngPath]
  return candidates.find((iconPath) => fs.existsSync(iconPath))
}

const createWindow = () => {
  const icon = resolveWindowIcon()
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 450,
    maximizable: false,
    resizable: true,
    center: true,
    frame: false,
    show: false,
    backgroundColor: '#000000',
    title: 'Biome',
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Enforce a fixed 16:9 window aspect ratio natively.
  // Replaces old useFitWindowToContent()
  mainWindow.setAspectRatio(16 / 9)

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
  }

  // Enable DevTools shortcuts only in development builds.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return

      const key = input.key.toLowerCase()
      const isF12 = key === 'f12'
      const isCtrlShiftI = input.control && input.shift && key === 'i'

      if (isF12 || isCtrlShiftI) {
        event.preventDefault()
        mainWindow?.webContents.toggleDevTools()
      }
    })
  }

  // Make links to external websites opened in default OS browser (instead of electron app)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Forward resize events to renderer
  mainWindow.on('resize', () => {
    if (!mainWindow) return
    const [width, height] = mainWindow.getSize()
    mainWindow.webContents.send('window-resized', { width, height })
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app
  .whenReady()
  .then(async () => {
    // Setup bundled seeds before IPC registration.
    // registerSettingsIpc validates default pinned scenes during registration.
    try {
      await setupBundledSeeds()
    } catch (err) {
      console.error('[SEEDS] Warning: Failed to setup bundled seeds:', err)
    }

    protocol.handle('biome-bg', (request) => {
      const url = new URL(request.url)
      // With standard scheme, biome-bg://serve/autumn.mp4 → hostname=serve, pathname=/autumn.mp4
      const filename = path.basename(url.pathname)
      if (!filename) {
        return new Response('Not found', { status: 404 })
      }

      const backgroundsDir = getBackgroundsDir()
      const filePath = path.join(backgroundsDir, filename)

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return new Response('Not found', { status: 404 })
      }

      return net.fetch(`file://${filePath}`)
    })

    registerAllIpc()
    createWindow()
  })
  .catch((err) => {
    console.error('[APP] Failed during startup:', err)
    app.quit()
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

process.on('uncaughtException', (err) => {
  console.error('[ENGINE] Uncaught exception, stopping server...', err)
  stopServerSync()
  process.exit(1)
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
