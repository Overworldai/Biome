import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getSeedsUploadsDir } from '../lib/paths.js'

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

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

  ipcMain.handle('read-image-files', (_event, paths: string[]) => {
    const results: { name: string; base64: string; mimeType: string }[] = []
    for (const filePath of paths) {
      const ext = path.extname(filePath).toLowerCase()
      const mimeType = IMAGE_EXTENSIONS[ext]
      if (!mimeType) continue
      try {
        const data = fs.readFileSync(filePath)
        results.push({ name: path.basename(filePath), base64: data.toString('base64'), mimeType })
      } catch {
        // Skip unreadable files
      }
    }
    return results
  })
}
