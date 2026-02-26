import { ipcMain, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getExeDir, getResourcePath } from '../lib/paths.js'

const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

/**
 * Resolve the backgrounds directory used by the UI slideshow.
 * Search order:
 * 1) Repository-local `seeds/backgrounds` (dev workflow)
 * 2) Portable executable-local `seeds/backgrounds`
 * 3) Bundled resources `seeds/backgrounds`
 */
function getBackgroundsDir(): string {
  const candidates: string[] = []

  const cwd = process.cwd()
  candidates.push(path.join(cwd, 'seeds', 'backgrounds'))
  candidates.push(path.join(cwd, '..', 'seeds', 'backgrounds'))
  candidates.push(path.join(cwd, '..', '..', 'seeds', 'backgrounds'))

  const exeDir = getExeDir()
  candidates.push(path.join(exeDir, 'seeds', 'backgrounds'))
  candidates.push(path.join(exeDir, '..', 'seeds', 'backgrounds'))

  // Bundled resource path
  candidates.push(path.join(getResourcePath('seeds'), 'backgrounds'))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate
    }
  }

  throw new Error('Backgrounds directory not found. Expected seeds/backgrounds.')
}

export function registerBackgroundsIpc(): void {
  ipcMain.handle('list-background-images', () => {
    const dir = getBackgroundsDir()
    const entries = fs.readdirSync(dir)

    const images: string[] = []
    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      if (!fs.statSync(fullPath).isFile()) continue

      const ext = path.extname(entry).slice(1).toLowerCase()
      if (SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
        images.push(entry)
      }
    }

    images.sort()
    return images
  })

  ipcMain.handle('read-background-image-as-base64', (_event, filename: string) => {
    if (!filename || filename.trim() === '') {
      throw new Error('Filename cannot be empty')
    }

    // Path traversal guard: only allow plain filenames
    const baseName = path.basename(filename)
    if (baseName !== filename) {
      throw new Error('Invalid filename')
    }

    const dir = getBackgroundsDir()
    const filePath = path.join(dir, baseName)

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error('Background image not found')
    }

    const ext = path.extname(baseName).slice(1).toLowerCase()
    if (!SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
      throw new Error('Unsupported image format')
    }

    const bytes = fs.readFileSync(filePath)
    return bytes.toString('base64')
  })

  ipcMain.handle('read-loading-tunnel-as-base64', () => {
    const tunnelPath = path.join(getResourcePath('seeds'), 'tunnel', 'tunnel.png')

    if (!fs.existsSync(tunnelPath)) {
      throw new Error('Loading tunnel image not found')
    }

    const bytes = fs.readFileSync(tunnelPath)
    return bytes.toString('base64')
  })
}
