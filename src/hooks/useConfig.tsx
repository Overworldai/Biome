import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react'
import { invoke } from '../bridge'
import type { AppConfig, EngineMode } from '../types/app'

// Port 7987 = 'O' (79) + 'W' (87) in ASCII
export const STANDALONE_PORT = 7987
export const DEFAULT_WORLD_ENGINE_MODEL = 'Overworld/Waypoint-1-Small'

// Engine mode: how the World Engine server should be managed
export const ENGINE_MODES = {
  UNCHOSEN: 'unchosen',
  STANDALONE: 'standalone',
  SERVER: 'server'
} as const

type EngineModes = (typeof ENGINE_MODES)[keyof typeof ENGINE_MODES]

type ConfigContextValue = {
  config: AppConfig
  isLoaded: boolean
  error: string | null
  configPath: string | null
  reloadConfig: () => Promise<boolean>
  saveConfig: (newConfig: AppConfig) => Promise<boolean>
  saveGpuServerUrl: (url: string) => Promise<boolean>
  openConfig: () => Promise<boolean>
  getUrl: () => string
  hasOpenAiKey: boolean
  hasFalKey: boolean
  hasHuggingFaceKey: boolean
  engineMode: EngineMode
  isEngineUnchosen: boolean
  isStandaloneMode: boolean
  isServerMode: boolean
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
    engine_mode: ENGINE_MODES.UNCHOSEN,
    seed_gallery: true,
    world_engine_model: DEFAULT_WORLD_ENGINE_MODEL,
    custom_world_models: []
  },
  ui: {
    bottom_panel_hidden: false
  }
}

// Migrate legacy config fields to new format
const migrateConfig = (loaded: AppConfig & { features?: Record<string, unknown> }): AppConfig => {
  if (loaded.features && typeof loaded.features.use_standalone_engine === 'boolean') {
    loaded.features.engine_mode = loaded.features.use_standalone_engine ? ENGINE_MODES.STANDALONE : ENGINE_MODES.SERVER
    delete loaded.features.use_standalone_engine
    console.log('[Config] Migrated use_standalone_engine to engine_mode:', loaded.features.engine_mode)
  }
  return loaded as AppConfig
}

// Deep merge loaded config with defaults (ensures new fields get default values)
const mergeWithDefaults = <T extends Record<string, unknown>>(loaded: Partial<T>, defaults: T): T => {
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

const ConfigContext = createContext<ConfigContextValue | null>(null)

export const ConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfig] = useState<AppConfig>(defaultConfig)
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configPath, setConfigPath] = useState<string | null>(null)

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const fileConfig = await invoke('read-config')
        const migratedConfig = migrateConfig(fileConfig as AppConfig & { features?: Record<string, unknown> })
        setConfig(mergeWithDefaults(migratedConfig, defaultConfig))

        const path = await invoke('get-config-path-str')
        setConfigPath(path)
      } catch (err) {
        console.warn('Could not load config, using defaults:', err)
        setError(err instanceof Error ? err.message : String(err))
        setConfig(defaultConfig)
      }
      setIsLoaded(true)
    }

    loadConfig()
  }, [])

  const reloadConfig = useCallback(async () => {
    try {
      const fileConfig = await invoke('read-config')
      setConfig(mergeWithDefaults(fileConfig, defaultConfig))
      setError(null)
      return true
    } catch (err) {
      console.error('Failed to reload config:', err)
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  const saveConfig = useCallback(async (newConfig: AppConfig) => {
    try {
      await invoke('write-config', newConfig)
      setConfig(newConfig)
      setError(null)
      return true
    } catch (err) {
      console.error('Failed to save config:', err)
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  const engineMode = (config.features?.engine_mode ?? ENGINE_MODES.UNCHOSEN) as EngineModes

  const getUrl = useCallback(() => {
    if (engineMode === ENGINE_MODES.STANDALONE) {
      return `http://localhost:${STANDALONE_PORT}`
    }

    const { host, port, use_ssl } = config.gpu_server
    const protocol = use_ssl ? 'https' : 'http'
    return `${protocol}://${host}:${port}`
  }, [engineMode, config.gpu_server])

  const saveGpuServerUrl = useCallback(
    async (url: string) => {
      const match = url.match(/^(?:wss?:\/\/)?([^:/]+)(?::(\d+))?/)
      if (!match) return false

      const [, host, port] = match
      return saveConfig({
        ...config,
        gpu_server: {
          ...config.gpu_server,
          host,
          port: port ? parseInt(port, 10) : config.gpu_server.port
        }
      })
    },
    [config, saveConfig]
  )

  const openConfig = useCallback(async () => {
    try {
      await invoke('open-config')
      return true
    } catch (err) {
      console.error('Failed to open config:', err)
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  const value: ConfigContextValue = {
    config,
    isLoaded,
    error,
    configPath,
    reloadConfig,
    saveConfig,
    saveGpuServerUrl,
    openConfig,
    getUrl,
    hasOpenAiKey: !!config.api_keys.openai,
    hasFalKey: !!config.api_keys.fal,
    hasHuggingFaceKey: !!config.api_keys.huggingface,
    engineMode,
    isEngineUnchosen: engineMode === ENGINE_MODES.UNCHOSEN,
    isStandaloneMode: engineMode === ENGINE_MODES.STANDALONE,
    isServerMode: engineMode === ENGINE_MODES.SERVER
  }

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export const useConfig = () => {
  const context = useContext(ConfigContext)
  if (!context) {
    throw new Error('useConfig must be used within a ConfigProvider')
  }
  return context
}

export default useConfig
