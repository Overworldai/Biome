import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import open from 'open'

export type RecordingEntry = {
  filename: string
  path: string
  size_bytes: number
  mtime_ms: number
}

/** The currently-configured output directory, cached after the last
 *  resolve-video-dir / list-recordings call. Used by the `biome-recording://`
 *  protocol handler, which is stateless itself but needs a dir to look in. */
let currentRecordingsDir: string | null = null

export function getCurrentRecordingsDir(): string | null {
  return currentRecordingsDir
}

function getDefaultRecordingsDir(): string {
  // app.getPath('videos') resolves to the user's OS-specific video directory:
  //   Windows → %USERPROFILE%\Videos
  //   macOS   → ~/Movies
  //   Linux   → XDG user-dirs VIDEOS (usually ~/Videos)
  return path.join(app.getPath('videos'), 'Biome')
}

function resolveRecordingsDir(configured: string): string {
  const trimmed = (configured ?? '').trim()
  return trimmed ? path.resolve(trimmed) : getDefaultRecordingsDir()
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Launch the OS's default handler for `target` in a fully detached process.
 *  `open` takes care of the OS-native shell invocation, Windows path-quoting
 *  edge cases, and detaching + unref'ing so Biome can exit independently. */
function openDetached(target: string): void {
  open(target).catch((err) => {
    console.error(`[RECORDINGS] Failed to open "${target}":`, err)
  })
}

export function registerRecordingsIpc(): void {
  ipcMain.handle('get-default-video-dir', () => getDefaultRecordingsDir())

  ipcMain.handle('resolve-video-dir', (_event, configured: string) => {
    const resolved = resolveRecordingsDir(configured)
    ensureDir(resolved)
    currentRecordingsDir = resolved
    return resolved
  })

  ipcMain.handle('pick-video-dir', async (_event, currentValue: string) => {
    const parentWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const defaultPath = resolveRecordingsDir(currentValue)
    const result = await dialog.showOpenDialog(parentWindow, {
      title: 'Choose recordings folder',
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('list-recordings', (_event, configured: string): RecordingEntry[] => {
    const dir = resolveRecordingsDir(configured)
    currentRecordingsDir = dir
    if (!fs.existsSync(dir)) return []

    const entries = fs.readdirSync(dir)
    const results: RecordingEntry[] = []
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.mp4')) continue
      const fullPath = path.join(dir, name)
      try {
        const stat = fs.statSync(fullPath)
        if (!stat.isFile()) continue
        results.push({
          filename: name,
          path: fullPath,
          size_bytes: stat.size,
          mtime_ms: stat.mtimeMs
        })
      } catch {
        // skip unreadable entries
      }
    }
    results.sort((a, b) => b.mtime_ms - a.mtime_ms)
    return results
  })

  ipcMain.handle('delete-recording', (_event, filePath: string) => {
    // Only allow deletion within the currently-configured recordings dir —
    // refuses arbitrary paths even if the renderer is compromised.
    if (!currentRecordingsDir) return
    const resolved = path.resolve(filePath)
    if (!isWithin(resolved, currentRecordingsDir)) return
    fs.rmSync(resolved, { force: true })
  })

  ipcMain.handle('open-recording-externally', (_event, filePath: string) => {
    if (!currentRecordingsDir) return
    const resolved = path.resolve(filePath)
    if (!isWithin(resolved, currentRecordingsDir)) return
    openDetached(resolved)
  })

  ipcMain.handle('open-recordings-folder', (_event, configured: string) => {
    const dir = resolveRecordingsDir(configured)
    ensureDir(dir)
    currentRecordingsDir = dir
    openDetached(dir)
  })
}
