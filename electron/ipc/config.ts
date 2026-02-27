import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getConfigDir } from '../lib/paths.js'
import type { AppConfig } from '../../src/types/app.js'

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
    port: 7987,
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
    engine_mode: 'standalone',
    seed_gallery: true,
    world_engine_model: 'Overworld/Waypoint-1-Small',
    custom_world_models: []
  }
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

  // Handle legacy migration: use_standalone_engine -> engine_mode
  const features = parsed.features as Record<string, unknown> | undefined
  if (features && typeof features.use_standalone_engine === 'boolean') {
    features.engine_mode = features.use_standalone_engine ? 'standalone' : 'server'
    delete features.use_standalone_engine

    // Save migrated config
    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2))
    console.log('[CONFIG] Migrated use_standalone_engine to engine_mode:', features.engine_mode)
  }

  if (features && features.engine_mode === 'unchosen') {
    features.engine_mode = 'standalone'
    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2))
    console.log('[CONFIG] Migrated engine_mode from unchosen to standalone')
  }

  return parsed as AppConfig
}

export function registerConfigIpc(): void {
  ipcMain.handle('read-config', () => {
    return readConfigSync()
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
