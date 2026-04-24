import { ipcMain, nativeImage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getSeedsDefaultDir, getSeedsGeneratedDir, getSeedsThumbnailDir, getSeedsUploadsDir } from '../lib/paths.js'
import { SUPPORTED_IMAGE_EXTENSIONS } from '../lib/constants.js'
import type { SeedFileRecord, SeedSource } from '../../src/types/app.js'

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

const SEED_THUMBNAIL_WIDTH_PX = 600

function isSupportedImage(filename: string): boolean {
  const ext = path.extname(filename).slice(1).toLowerCase()
  return SUPPORTED_IMAGE_EXTENSIONS.includes(ext)
}

/** Find the full path of a seed by filename, searching default then uploads then generated dirs */
function resolveSeedPath(filename: string): string | null {
  const defaultPath = path.join(getSeedsDefaultDir(), filename)
  if (fs.existsSync(defaultPath)) return defaultPath
  const uploadsPath = path.join(getSeedsUploadsDir(), filename)
  if (fs.existsSync(uploadsPath)) return uploadsPath
  const generatedPath = path.join(getSeedsGeneratedDir(), filename)
  if (fs.existsSync(generatedPath)) return generatedPath
  return null
}

function scanDir(dir: string, source: SeedSource): SeedFileRecord[] {
  if (!fs.existsSync(dir)) return []
  const records: SeedFileRecord[] = []
  for (const entry of fs.readdirSync(dir)) {
    if (!isSupportedImage(entry)) continue
    const filePath = path.join(dir, entry)
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) continue
      records.push({ filename: entry, source, modifiedAt: stat.mtimeMs })
    } catch {
      // Skip unreadable files
    }
  }
  return records
}

function dirForSource(source: SeedSource): string | null {
  switch (source) {
    case 'uploaded':
      return getSeedsUploadsDir()
    case 'generated':
      return getSeedsGeneratedDir()
    case 'default':
      // Defaults are bundled with the app and never user-deletable.
      return null
  }
}

export function registerSeedsIpc(): void {
  ipcMain.handle('list-seeds', (): SeedFileRecord[] => {
    const defaults = scanDir(getSeedsDefaultDir(), 'default')
    const uploads = scanDir(getSeedsUploadsDir(), 'uploaded')
    const generated = scanDir(getSeedsGeneratedDir(), 'generated')
    return [...defaults, ...uploads, ...generated]
  })

  ipcMain.handle('get-seed-image-base64', (_event, filename: string): { base64: string } | null => {
    const filePath = resolveSeedPath(filename)
    if (!filePath) return null
    const data = fs.readFileSync(filePath)
    return { base64: data.toString('base64') }
  })

  ipcMain.handle('get-seed-thumbnail-base64', async (_event, filename: string): Promise<string | null> => {
    const filePath = resolveSeedPath(filename)
    if (!filePath) return null

    const thumbDir = getSeedsThumbnailDir()
    // Width-suffixed filename so any change to the thumbnail resolution
    // naturally invalidates the cache for existing installs.
    const thumbName = `${path.parse(filename).name}.w${SEED_THUMBNAIL_WIDTH_PX}.jpg`
    const thumbPath = path.join(thumbDir, thumbName)

    // Check if cached thumbnail exists and is newer than source
    if (fs.existsSync(thumbPath)) {
      try {
        const srcStat = fs.statSync(filePath)
        const thumbStat = fs.statSync(thumbPath)
        if (thumbStat.mtimeMs >= srcStat.mtimeMs) {
          return fs.readFileSync(thumbPath).toString('base64')
        }
      } catch {
        // Regenerate on error
      }
    }

    // Generate thumbnail via Electron nativeImage (aspect ratio preserved automatically)
    fs.mkdirSync(thumbDir, { recursive: true })
    const img = nativeImage.createFromPath(filePath)
    if (img.isEmpty()) {
      console.error(`[SEEDS] Failed to load image for thumbnail: ${filePath}`)
      return null
    }
    const { width } = img.getSize()
    const resized = img.resize({ width: Math.min(SEED_THUMBNAIL_WIDTH_PX, width) })
    const thumbBuffer = resized.toJPEG(85)
    fs.writeFileSync(thumbPath, thumbBuffer)
    return thumbBuffer.toString('base64')
  })

  ipcMain.handle('upload-seed', (_event, filename: string, base64: string): SeedFileRecord => {
    const uploadsDir = getSeedsUploadsDir()
    fs.mkdirSync(uploadsDir, { recursive: true })
    const destPath = path.join(uploadsDir, filename)
    fs.writeFileSync(destPath, Buffer.from(base64, 'base64'))
    const stat = fs.statSync(destPath)
    return { filename, source: 'uploaded', modifiedAt: stat.mtimeMs }
  })

  // Save a scene-authoring generated image. The server already embedded
  // metadata (image model, user/sanitized prompts, biome version, timestamp)
  // as a JPEG COM-marker JSON blob, so the renderer just writes the bytes
  // verbatim. Filename is timestamp-based with a random suffix for uniqueness
  // across same-second generations.
  ipcMain.handle('save-generated-seed', (_event, base64: string): SeedFileRecord => {
    const generatedDir = getSeedsGeneratedDir()
    fs.mkdirSync(generatedDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
    const rand = Math.random().toString(36).slice(2, 8)
    const filename = `generated_${ts}_${rand}.jpg`
    const destPath = path.join(generatedDir, filename)
    fs.writeFileSync(destPath, Buffer.from(base64, 'base64'))
    const stat = fs.statSync(destPath)
    return { filename, source: 'generated', modifiedAt: stat.mtimeMs }
  })

  ipcMain.handle('delete-seed', (_event, filename: string, source: SeedSource): void => {
    // Source is required so we target the exact directory the renderer meant
    // to delete from — filenames can collide across uploads/generated and we
    // would otherwise silently delete the wrong file.
    const dir = dirForSource(source)
    if (!dir) return
    const filePath = path.join(dir, filename)
    if (!filePath.startsWith(dir)) return
    if (!fs.existsSync(filePath)) return
    fs.unlinkSync(filePath)

    // Also delete cached thumbnail
    const thumbDir = getSeedsThumbnailDir()
    // Width-suffixed filename so any change to the thumbnail resolution
    // naturally invalidates the cache for existing installs.
    const thumbName = `${path.parse(filename).name}.w${SEED_THUMBNAIL_WIDTH_PX}.jpg`
    const thumbPath = path.join(thumbDir, thumbName)
    if (fs.existsSync(thumbPath)) {
      try {
        fs.unlinkSync(thumbPath)
      } catch {
        // Best-effort cleanup
      }
    }
  })

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
