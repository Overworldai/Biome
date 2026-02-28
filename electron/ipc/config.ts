import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getConfigDir } from '../lib/paths.js'
import type { AppConfig } from '../../src/types/app.js'
import { STANDALONE_PORT, DEFAULT_WORLD_ENGINE_MODEL, ENGINE_MODES } from '../../src/constants/configShared.js'

const CONFIG_FILENAME = 'config.json'

function getConfigPath(): string {
  const configDir = getConfigDir()
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  return path.join(configDir, CONFIG_FILENAME)
}

const defaultConfig: AppConfig = {
  gpu_server: {
    host: 'localhost',
    port: STANDALONE_PORT,
    use_ssl: false
  },
  api_keys: {
    openai: '',
    fal: '',
    huggingface: ''
  },
  features: {
    prompt_sanitizer: true,
    seed_generation: true,
    engine_mode: ENGINE_MODES.STANDALONE,
    seed_gallery: true,
    world_engine_model: DEFAULT_WORLD_ENGINE_MODEL,
    custom_world_models: [],
    mouse_sensitivity: 1.0
  }
}

function mergeWithDefaults<T extends Record<string, unknown>>(loaded: Partial<T>, defaults: T): T {
  const result: Record<string, unknown> = { ...defaults }
  for (const key of Object.keys(loaded)) {
    const loadedValue = loaded[key as keyof T]
    const defaultValue = defaults[key as keyof T]
    if (
      loadedValue &&
      typeof loadedValue === 'object' &&
      !Array.isArray(loadedValue) &&
      defaultValue &&
      typeof defaultValue === 'object' &&
      !Array.isArray(defaultValue)
    ) {
      result[key] = mergeWithDefaults(loadedValue as Record<string, unknown>, defaultValue as Record<string, unknown>)
    } else if (loadedValue !== undefined) {
      result[key] = loadedValue
    }
  }
  return result as T
}

function readConfigSync(): AppConfig {
  const configPath = getConfigPath()

  if (!fs.existsSync(configPath)) {
    // Create default config
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2))
    return { ...defaultConfig }
  }

  const content = fs.readFileSync(configPath, 'utf-8')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content)
  } catch {
    return { ...defaultConfig }
  }
  const rawJson = JSON.stringify(parsed)

  // Handle legacy migration: use_standalone_engine -> engine_mode
  const features = parsed.features as Record<string, unknown> | undefined
  if (features && typeof features.use_standalone_engine === 'boolean') {
    features.engine_mode = features.use_standalone_engine ? ENGINE_MODES.STANDALONE : ENGINE_MODES.SERVER
    delete features.use_standalone_engine

    // Save migrated config
    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2))
    console.log('[CONFIG] Migrated use_standalone_engine to engine_mode:', features.engine_mode)
  }

  if (features && features.engine_mode === ENGINE_MODES.UNCHOSEN) {
    features.engine_mode = ENGINE_MODES.STANDALONE
    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2))
    console.log('[CONFIG] Migrated engine_mode from unchosen to standalone')
  }

  const normalized = mergeWithDefaults(parsed as Partial<AppConfig>, defaultConfig)

  // Persist normalized shape so future loads are stable and renderer can trust config shape.
  if (JSON.stringify(normalized) !== rawJson) {
    fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2))
  }

  return normalized
}

export function registerConfigIpc(): void {
  ipcMain.handle('read-config', () => {
    return readConfigSync()
  })

  ipcMain.handle('read-default-config', () => {
    return JSON.parse(JSON.stringify(defaultConfig)) as AppConfig
  })

  ipcMain.handle('write-config', (_event, config: AppConfig) => {
    const configPath = getConfigPath()
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  })

  ipcMain.handle('get-config-path-str', () => {
    return getConfigPath()
  })

  ipcMain.handle('open-config', () => {
    const configPath = getConfigPath()
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2))
    }
    shell.showItemInFolder(configPath)
  })
}

/** Read config from main process (for use by other IPC handlers) */
export { readConfigSync }
