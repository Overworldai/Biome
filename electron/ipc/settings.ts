import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getConfigDir, getSeedsDefaultDir, getSeedsUploadsDir } from '../lib/paths.js'
import { settingsSchema, DEFAULT_PINNED_SCENES } from '../../src/types/settings.js'
import type { Settings } from '../../src/types/settings.js'

const SETTINGS_FILENAME = 'settings.json'
const LEGACY_CONFIG_FILENAME = 'config.json'
const IS_MACOS = process.platform === 'darwin'

function normalizeSettingsForPlatform(settings: Settings): Settings {
  if (!IS_MACOS) return settings
  return {
    ...settings,
    engine_mode: 'server'
  }
}

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
      migrated.pinned_scenes = features.pinned_scenes.filter((v) => typeof v === 'string')
    }
  }

  return migrated
}

function validateDefaultPinnedScenes(): void {
  const defaultDir = getSeedsDefaultDir()
  const uploadsDir = getSeedsUploadsDir()
  const missing: string[] = []

  for (const filename of DEFAULT_PINNED_SCENES) {
    const inDefault = fs.existsSync(path.join(defaultDir, filename))
    const inUploads = fs.existsSync(path.join(uploadsDir, filename))
    if (!inDefault && !inUploads) {
      missing.push(filename)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Default pinned scene files are missing from seeds directories: ${missing.join(', ')}. ` +
        `Ensure these files exist in "${defaultDir}" or "${uploadsDir}".`
    )
  }
}

function readSettingsSync(): Settings {
  const settingsPath = getSettingsPath()

  if (!fs.existsSync(settingsPath)) {
    // Try one-time migration from config.json
    const legacyPath = getLegacyConfigPath()
    if (fs.existsSync(legacyPath)) {
      try {
        const legacyContent = fs.readFileSync(legacyPath, 'utf-8')
        const legacyParsed = JSON.parse(legacyContent) as Record<string, unknown>
        const migrated = migrateFromLegacyConfig(legacyParsed)
        const result = normalizeSettingsForPlatform(settingsSchema.parse(migrated))

        // Write migrated settings
        fs.writeFileSync(settingsPath, JSON.stringify(result, null, 2))
        console.log('[SETTINGS] Migrated from config.json to settings.json')
        return result
      } catch (err) {
        console.warn('[SETTINGS] Failed to migrate config.json, using defaults:', err)
      }
    }

    // No existing files — use defaults
    const defaults = normalizeSettingsForPlatform(settingsSchema.parse({}))
    fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2))
    return defaults
  }

  const content = fs.readFileSync(settingsPath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    console.warn('[SETTINGS] Failed to parse settings.json, using defaults')
    const defaults = normalizeSettingsForPlatform(settingsSchema.parse({}))
    fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2))
    return defaults
  }

  const result = settingsSchema.safeParse(parsed)
  if (result.success) {
    return normalizeSettingsForPlatform(result.data)
  }

  console.warn('[SETTINGS] Invalid settings.json, using defaults:', result.error.message)
  const defaults = normalizeSettingsForPlatform(settingsSchema.parse({}))
  fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2))
  return defaults
}

export function registerSettingsIpc(): void {
  // Validate default pinned scenes exist at startup
  try {
    validateDefaultPinnedScenes()
  } catch (err) {
    console.error('[SETTINGS]', err instanceof Error ? err.message : err)
    throw err
  }

  ipcMain.handle('read-settings', () => {
    return readSettingsSync()
  })

  ipcMain.handle('read-default-settings', () => {
    return normalizeSettingsForPlatform(settingsSchema.parse({}))
  })

  ipcMain.handle('write-settings', (_event, settings: Settings) => {
    const settingsPath = getSettingsPath()
    const validated = normalizeSettingsForPlatform(settingsSchema.parse(settings))
    fs.writeFileSync(settingsPath, JSON.stringify(validated, null, 2))
  })

  ipcMain.handle('get-settings-path-str', () => {
    return getSettingsPath()
  })

  ipcMain.handle('open-settings', () => {
    const settingsPath = getSettingsPath()
    if (!fs.existsSync(settingsPath)) {
      const defaults = normalizeSettingsForPlatform(settingsSchema.parse({}))
      fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2))
    }
    shell.showItemInFolder(settingsPath)
  })
}
