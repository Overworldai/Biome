import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getExeDir, getResourcePath } from '../lib/paths.js'
import { SUPPORTED_VIDEO_EXTENSIONS } from '../lib/constants.js'

/**
 * Resolve the backgrounds directory used by the UI slideshow.
 * Search order:
 * 1) Repository-local `backgrounds` (dev workflow)
 * 2) Portable executable-local `backgrounds`
 * 3) Bundled resources `backgrounds`
 */
export function getBackgroundsDir(): string {
  const candidates: string[] = []

  const cwd = process.cwd()
  candidates.push(path.join(cwd, 'backgrounds'))
  candidates.push(path.join(cwd, '..', 'backgrounds'))
  candidates.push(path.join(cwd, '..', '..', 'backgrounds'))

  const exeDir = getExeDir()
  candidates.push(path.join(exeDir, 'backgrounds'))
  candidates.push(path.join(exeDir, '..', 'backgrounds'))

  // Bundled resource path
  candidates.push(getResourcePath('backgrounds'))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate
    }
  }

  throw new Error('Backgrounds directory not found. Expected backgrounds/.')
}

export function registerBackgroundsIpc(): void {
  ipcMain.handle('list-background-videos', () => {
    const dir = getBackgroundsDir()
    const entries = fs.readdirSync(dir)

    const videos: string[] = []
    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      if (!fs.statSync(fullPath).isFile()) continue

      const ext = path.extname(entry).slice(1).toLowerCase()
      if (SUPPORTED_VIDEO_EXTENSIONS.includes(ext)) {
        videos.push(entry)
      }
    }

    videos.sort()
    return videos
  })
}
