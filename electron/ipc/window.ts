import { ipcMain, BrowserWindow } from 'electron'

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
    return { width: 800, height: 450 }
  })

  ipcMain.handle('window-minimize', (_event) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (win) {
      win.minimize()
    }
  })

  ipcMain.handle('window-close', (_event) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (win) {
      win.close()
    }
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
