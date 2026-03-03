import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import { getSeedsUploadsDir } from '../lib/paths.js'

export function registerSeedsIpc(): void {
  ipcMain.handle('get-seeds-dir-path', () => {
    return getSeedsUploadsDir()
  })

  ipcMain.handle('open-seeds-dir', () => {
    const seedsDir = getSeedsUploadsDir()
    if (!fs.existsSync(seedsDir)) {
      fs.mkdirSync(seedsDir, { recursive: true })
    }
    shell.showItemInFolder(seedsDir)
  })
}
