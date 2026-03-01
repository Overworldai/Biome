import { ipcMain, BrowserWindow, app, screen } from 'electron'

const savedBoundsByWindowId = new Map<number, Electron.Rectangle>()

function getMaxAspectFitBounds(win: BrowserWindow, aspectRatio: number): Electron.Rectangle {
  const currentBounds = win.getBounds()
  const display = screen.getDisplayMatching(currentBounds)
  const workArea = display.workArea

  let width = workArea.width
  let height = Math.round(width / aspectRatio)

  if (height > workArea.height) {
    height = workArea.height
    width = Math.round(height * aspectRatio)
  }

  const x = workArea.x + Math.floor((workArea.width - width) / 2)
  const y = workArea.y + Math.floor((workArea.height - height) / 2)

  return { x, y, width, height }
}

export function registerWindowIpc(): void {
  ipcMain.handle('window-set-size', (_event, width: number, height: number) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (win) {
      win.setSize(Math.round(width), Math.round(height))
    }
  })

  ipcMain.handle('window-get-size', (_event) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (win) {
      const [width, height] = win.getSize()
      return { width, height }
    }
    return { width: 1280, height: 720 }
  })

  ipcMain.handle('window-minimize', (_event) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (win) {
      win.minimize()
    }
  })

  ipcMain.handle('window-toggle-maximize', (_event) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) return

    const windowId = win.id
    const savedBounds = savedBoundsByWindowId.get(windowId)

    if (savedBounds) {
      win.setBounds(savedBounds)
      savedBoundsByWindowId.delete(windowId)
      return
    }

    savedBoundsByWindowId.set(windowId, win.getBounds())
    const fitBounds = getMaxAspectFitBounds(win, 16 / 9)
    win.setBounds(fitBounds)
  })

  ipcMain.handle('window-close', (_event) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (win) {
      savedBoundsByWindowId.delete(win.id)
      win.close()
    }
  })

  ipcMain.handle('quit-app', () => {
    app.quit()
  })

  ipcMain.handle('window-set-position', (_event, x: number, y: number) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (win) {
      win.setPosition(Math.round(x), Math.round(y))
    }
  })

  ipcMain.handle('window-get-position', (_event) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (win) {
      const [x, y] = win.getPosition()
      return { x, y }
    }
    return { x: 0, y: 0 }
  })
}
