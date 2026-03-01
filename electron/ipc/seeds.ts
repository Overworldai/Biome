import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import { getSeedsUploadsDir } from '../lib/paths.js'
import type { SeedRecord, SeedRecordWithThumbnail } from '../../src/types/app.js'

const SERVER_BASE_URL = 'http://localhost:7987'

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function registerSeedsIpc(): void {
  ipcMain.handle('list-seeds', async () => {
    const response = await fetch(`${SERVER_BASE_URL}/seeds/list`)
    if (!response.ok) {
      throw new Error(`Server returned error: ${response.status}`)
    }

    const raw = (await response.json()) as unknown
    const result = asObject(raw)
    const seedsObj = asObject(result?.seeds) ?? {}

    const seeds: SeedRecord[] = Object.entries(seedsObj)
      .map(([filename, data]) => ({
        filename,
        is_safe: Boolean((data as { is_safe?: unknown }).is_safe ?? false),
        is_default: Boolean((data as { is_default?: unknown }).is_default ?? true)
      }))
      .sort((a, b) => a.filename.localeCompare(b.filename))

    return seeds
  })

  ipcMain.handle('list-seeds-with-thumbnails', async () => {
    const listResponse = await fetch(`${SERVER_BASE_URL}/seeds/list`)
    if (!listResponse.ok) {
      throw new Error(`Server returned error: ${listResponse.status}`)
    }
    const listRaw = (await listResponse.json()) as unknown
    const listResult = asObject(listRaw)
    const countValue = listResult?.count
    const seedCount = Math.max(1, typeof countValue === 'number' ? countValue : 1)

    const response = await fetch(`${SERVER_BASE_URL}/seeds/list-with-thumbnails?thumbnail_limit=${seedCount}`)
    if (!response.ok) {
      throw new Error(`Server returned error: ${response.status}`)
    }

    const raw = (await response.json()) as unknown
    const result = asObject(raw)
    const seedsObj = asObject(result?.seeds) ?? {}

    const seeds: SeedRecordWithThumbnail[] = Object.entries(seedsObj)
      .map(([filename, data]) => ({
        filename,
        is_safe: Boolean((data as { is_safe?: unknown }).is_safe ?? false),
        is_default: Boolean((data as { is_default?: unknown }).is_default ?? true),
        thumbnail_base64:
          typeof (data as { thumbnail_base64?: unknown }).thumbnail_base64 === 'string'
            ? ((data as { thumbnail_base64: string }).thumbnail_base64 ?? null)
            : null
      }))
      .sort((a, b) => a.filename.localeCompare(b.filename))

    console.log(
      `[SEEDS] IPC list-seeds-with-thumbnails: received ${seeds.length} seeds, ${seeds.filter((s) => !!s.thumbnail_base64).length} thumbnails`
    )

    return seeds
  })

  ipcMain.handle('delete-seed', async (_event, filename: string) => {
    const response = await fetch(`${SERVER_BASE_URL}/seeds/${filename}`, {
      method: 'DELETE'
    })

    if (!response.ok) {
      const error = (await response.json().catch(() => ({ error: 'Delete failed' }))) as { error?: string }
      throw new Error(error.error || 'Delete failed')
    }
  })

  ipcMain.handle('read-seed-as-base64', async (_event, filename: string) => {
    const response = await fetch(`${SERVER_BASE_URL}/seeds/image/${filename}`)
    if (!response.ok) {
      throw new Error(`Server returned error: ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.toString('base64')
  })

  ipcMain.handle('read-seed-thumbnail', async (_event, filename: string, _maxSize: number) => {
    const response = await fetch(`${SERVER_BASE_URL}/seeds/thumbnail/${filename}`)
    if (!response.ok) {
      throw new Error(`Server returned error: ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.toString('base64')
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
}
