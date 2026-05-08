import { app, BrowserWindow, net, protocol, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { registerAllIpc } from './ipc/index.js'
import { stopServerSync } from './lib/serverState.js'
import { getBackgroundsDir } from './ipc/backgrounds.js'
import { getCurrentRecordingsDir } from './ipc/recordings.js'
import { getScenePropDir } from './lib/paths.js'
import { getLogger } from './lib/logger.js'

const log = getLogger('electron.main')

// Register biome-bg / biome-recording as privileged schemes so <video> elements
// can stream from them. Must be called before app.whenReady().
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'biome-bg',
    privileges: { standard: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  },
  {
    scheme: 'biome-recording',
    privileges: { standard: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  },
  {
    scheme: 'biome-prop',
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

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    const key = input.key.toLowerCase()

    // Block Ctrl+W from closing the window — the app has its own close button.
    if (input.control && key === 'w') {
      event.preventDefault()
      return
    }

    // Block bare Alt from activating the system menu — Alt is a game input.
    if (input.alt && !input.control && !input.meta && key === 'alt') {
      event.preventDefault()
      return
    }

    // Enable DevTools shortcuts only in development builds.
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const isF12 = key === 'f12'
      const isCtrlShiftI = input.control && input.shift && key === 'i'

      if (isF12 || isCtrlShiftI) {
        event.preventDefault()
        mainWindow?.webContents.toggleDevTools()
      }
    }
  })

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

  // Window stays hidden until the renderer signals it's ready (renderer-ready IPC).
  // Fallback: show after 5 s in case the renderer never signals (e.g. crash).
  const showFallbackTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  }, 5000)

  mainWindow.on('closed', () => {
    clearTimeout(showFallbackTimer)
    mainWindow = null
  })
}

app
  .whenReady()
  .then(async () => {
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

    // biome-recording://serve/<basename>.mp4 streams a single file from the
    // currently-configured recordings dir (set by list-recordings /
    // resolve-video-dir). basename-only: refuses anything with path separators.
    protocol.handle('biome-recording', (request) => {
      const url = new URL(request.url)
      const filename = path.basename(url.pathname)
      if (!filename || filename !== decodeURIComponent(url.pathname.replace(/^\/+/, ''))) {
        return new Response('Not found', { status: 404 })
      }

      const dir = getCurrentRecordingsDir()
      if (!dir) return new Response('Not found', { status: 404 })

      const filePath = path.join(dir, filename)
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return new Response('Not found', { status: 404 })
      }

      return net.fetch(`file://${filePath}`)
    })

    // biome-prop://serve/<...> serves the Scene Edit prop gallery
    // (manifest.json + <category>/<slug>(_held).jpg). The prop dir
    // lives at <repo>/assets/scene_edit/ in dev and <resources>/scene_edit/
    // in packaged builds. Nested paths (category/slug.jpg) are allowed;
    // any path traversal attempt (../, absolute) is rejected.
    protocol.handle('biome-prop', (request) => {
      const url = new URL(request.url)
      const relative = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (!relative || relative.includes('..') || path.isAbsolute(relative)) {
        return new Response('Forbidden', { status: 403 })
      }
      const baseDir = getScenePropDir()
      const filePath = path.join(baseDir, relative)
      const resolved = path.resolve(filePath)
      const baseResolved = path.resolve(baseDir)
      if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(`file://${filePath}`)
    })

    registerAllIpc()
    createWindow()
  })
  .catch((err) => {
    log.error('Startup failed', { exception: err instanceof Error ? (err.stack ?? err.message) : String(err) })
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
  log.info('App quitting, stopping server')
  stopServerSync()
})

process.on('SIGINT', () => {
  log.info('Received SIGINT, stopping server')
  stopServerSync()
  process.exit(0)
})

process.on('SIGTERM', () => {
  log.info('Received SIGTERM, stopping server')
  stopServerSync()
  process.exit(0)
})

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception, stopping server', {
    exception: err instanceof Error ? (err.stack ?? err.message) : String(err)
  })
  stopServerSync()
  process.exit(1)
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
