import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getConfigDir, getSeedsDefaultDir, getSeedsUploadsDir } from '../lib/paths.js'
import { settingsSchema, DEFAULT_SCENE_ORDER } from '../../src/types/settings.js'
import type { Settings } from '../../src/types/settings.js'

const SETTINGS_FILENAME = 'settings.json'
const LEGACY_CONFIG_FILENAME = 'config.json'

function getSettingsPath(): string {
  const configDir = getConfigDir()
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  return path.join(configDir, SETTINGS_FILENAME)
}

function getLegacyConfigPath(): string {
  return path.join(getConfigDir(), LEGACY_CONFIG_FILENAME)
}

function migrateFromLegacyConfig(parsed: Record<string, unknown>): Partial<Settings> {
  const migrated: Partial<Settings> = {}

  // gpu_server.{host,port,use_ssl} → server_url
  const gpuServer = parsed.gpu_server as Record<string, unknown> | undefined
  if (gpuServer) {
    const host = (gpuServer.host as string) || 'localhost'
    const port = (gpuServer.port as number) || 7987
    const useSsl = Boolean(gpuServer.use_ssl)
    const protocol = useSsl ? 'https' : 'http'
    migrated.server_url = `${protocol}://${host}:${port}`
  }

  const features = parsed.features as Record<string, unknown> | undefined
  if (features) {
    // Handle legacy use_standalone_engine boolean
    if (typeof features.use_standalone_engine === 'boolean') {
      migrated.engine_mode = features.use_standalone_engine ? 'standalone' : 'server'
    } else {
      const mode = features.engine_mode as string | undefined
      if (mode === 'unchosen' || mode === 'standalone') {
        migrated.engine_mode = 'standalone'
      } else if (mode === 'server') {
        migrated.engine_mode = 'server'
      }
    }

    if (typeof features.world_engine_model === 'string') {
      migrated.engine_model = features.world_engine_model
    }
    if (typeof features.mouse_sensitivity === 'number') {
      migrated.mouse_sensitivity = features.mouse_sensitivity
    }
    if (Array.isArray(features.pinned_scenes)) {
      migrated.scene_order = features.pinned_scenes.filter((v): v is string => typeof v === 'string')
    }
  }

  return migrated
}

/** Previous versions of the app stored scene order under `pinned_scenes` (and
 *  later also `unpinned_scene_order`). Combine them into the new `scene_order`
 *  field when present so upgrades don't reset a user's customised order. */
function migrateLegacySceneFields(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null) return parsed
  const obj = parsed as Record<string, unknown>
  if ('scene_order' in obj) return parsed

  const pinned = Array.isArray(obj.pinned_scenes)
    ? obj.pinned_scenes.filter((v): v is string => typeof v === 'string')
    : []
  const unpinned = Array.isArray(obj.unpinned_scene_order)
    ? obj.unpinned_scene_order.filter((v): v is string => typeof v === 'string')
    : []
  if (pinned.length === 0 && unpinned.length === 0) return parsed

  return { ...obj, scene_order: [...pinned, ...unpinned] }
}

function validateDefaultScenes(): void {
  const defaultDir = getSeedsDefaultDir()
  const uploadsDir = getSeedsUploadsDir()
  const missing: string[] = []

  for (const filename of DEFAULT_SCENE_ORDER) {
    const inDefault = fs.existsSync(path.join(defaultDir, filename))
    const inUploads = fs.existsSync(path.join(uploadsDir, filename))
    if (!inDefault && !inUploads) {
      missing.push(filename)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Default scene files are missing from seeds directories: ${missing.join(', ')}. ` +
        `Ensure these files exist in "${defaultDir}" or "${uploadsDir}".`
    )
  }
}

function seedFileExists(filename: string): boolean {
  const defaultDir = getSeedsDefaultDir()
  const uploadsDir = getSeedsUploadsDir()
  return fs.existsSync(path.join(defaultDir, filename)) || fs.existsSync(path.join(uploadsDir, filename))
}

/** Replace any scenes in the order list whose seed files no longer exist
 *  with defaults. Returns the same object if no changes. */
function repairMissingScenes(settings: Settings): Settings {
  const order = settings.scene_order
  const missing = order.filter((f) => !seedFileExists(f))
  if (missing.length === 0) return settings

  const kept = order.filter((f) => seedFileExists(f))
  const keptSet = new Set(kept)
  const replacements = DEFAULT_SCENE_ORDER.filter((f) => !keptSet.has(f))

  const repaired = [...kept, ...replacements].slice(0, Math.max(order.length, DEFAULT_SCENE_ORDER.length))

  console.log(`[SETTINGS] Replaced ${missing.length} missing scene(s): ${missing.join(', ')}`)

  return { ...settings, scene_order: repaired }
}

function loadSettings(settingsPath: string): { settings: Settings; dirty: boolean } {
  if (!fs.existsSync(settingsPath)) {
    const legacyPath = getLegacyConfigPath()
    if (fs.existsSync(legacyPath)) {
      try {
        const legacyContent = fs.readFileSync(legacyPath, 'utf-8')
        const legacyParsed = JSON.parse(legacyContent) as Record<string, unknown>
        const migrated = migrateFromLegacyConfig(legacyParsed)
        const result = settingsSchema.parse(migrated)
        console.log('[SETTINGS] Migrated from config.json to settings.json')
        return { settings: result, dirty: true }
      } catch (err) {
        console.warn('[SETTINGS] Failed to migrate config.json, using defaults:', err)
      }
    }
    return { settings: settingsSchema.parse({}), dirty: true }
  }

  const content = fs.readFileSync(settingsPath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    console.warn('[SETTINGS] Failed to parse settings.json, using defaults')
    return { settings: settingsSchema.parse({}), dirty: true }
  }

  const migrated = migrateLegacySceneFields(parsed)
  const result = settingsSchema.safeParse(migrated)
  if (result.success) {
    return { settings: result.data, dirty: migrated !== parsed }
  }

  console.warn('[SETTINGS] Invalid settings.json, using defaults:', result.error.message)
  return { settings: settingsSchema.parse({}), dirty: true }
}

export function readSettingsSync(): Settings {
  const settingsPath = getSettingsPath()
  const { settings, dirty } = loadSettings(settingsPath)
  const repaired = repairMissingScenes(settings)
  if (dirty || repaired !== settings) {
    fs.writeFileSync(settingsPath, JSON.stringify(repaired, null, 2))
  }
  return repaired
}

/** Env vars injected into any uv / python subprocess when offline mode is on.
 *  Single source of truth — both engine setup and the server spawn consume this. */
export function getOfflineEnv(): Record<string, string> {
  return readSettingsSync().offline_mode ? { UV_OFFLINE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } : {}
}

export function registerSettingsIpc(): void {
  // Validate default scene files exist at startup
  try {
    validateDefaultScenes()
  } catch (err) {
    console.error('[SETTINGS]', err instanceof Error ? err.message : err)
    throw err
  }

  ipcMain.handle('read-settings', () => {
    return readSettingsSync()
  })

  ipcMain.handle('read-default-settings', () => {
    return settingsSchema.parse({})
  })

  ipcMain.handle('write-settings', (_event, settings: Settings) => {
    const settingsPath = getSettingsPath()
    const validated = settingsSchema.parse(settings)
    fs.writeFileSync(settingsPath, JSON.stringify(validated, null, 2))
  })

  ipcMain.handle('get-settings-path-str', () => {
    return getSettingsPath()
  })

  ipcMain.handle('open-settings', () => {
    const settingsPath = getSettingsPath()
    if (!fs.existsSync(settingsPath)) {
      const defaults = settingsSchema.parse({})
      fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2))
    }
    shell.showItemInFolder(settingsPath)
  })
}
