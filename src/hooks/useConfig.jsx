import { useState, useEffect, useCallback, createContext, useContext } from 'react'

// Port 7987 = 'O' (79) + 'W' (87) in ASCII
export const STANDALONE_PORT = 7987

// Engine mode: how the World Engine server should be managed
export const ENGINE_MODES = {
  UNCHOSEN: 'unchosen',
  STANDALONE: 'standalone',
  SERVER: 'server'
}

const defaultConfig = {
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
    engine_mode: ENGINE_MODES.UNCHOSEN
  },
  ui: {
    bottom_panel_hidden: false
  }
}

// Tauri invoke helper
const invoke = async (cmd, args = {}) => {
  return window.__TAURI_INTERNALS__.invoke(cmd, args)
}

// Migrate legacy config fields to new format
const migrateConfig = (loaded) => {
  // Migrate legacy use_standalone_engine boolean to engine_mode enum
  if (loaded.features && typeof loaded.features.use_standalone_engine === 'boolean') {
    loaded.features.engine_mode = loaded.features.use_standalone_engine ? ENGINE_MODES.STANDALONE : ENGINE_MODES.SERVER
    delete loaded.features.use_standalone_engine
    console.log('[Config] Migrated use_standalone_engine to engine_mode:', loaded.features.engine_mode)
  }
  return loaded
}

// Deep merge loaded config with defaults (ensures new fields get default values)
const mergeWithDefaults = (loaded, defaults) => {
  const result = { ...defaults }
  for (const key of Object.keys(loaded)) {
    if (loaded[key] && typeof loaded[key] === 'object' && !Array.isArray(loaded[key]) && defaults[key]) {
      result[key] = mergeWithDefaults(loaded[key], defaults[key])
    } else {
      result[key] = loaded[key]
    }
  }
  return result
}

// Create the config context
const ConfigContext = createContext(null)

// Config Provider component - must wrap the app
export const ConfigProvider = ({ children }) => {
  const [config, setConfig] = useState(defaultConfig)
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [configPath, setConfigPath] = useState(null)

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const fileConfig = await invoke('read_config')
        // Migrate legacy fields and merge with defaults
        const migratedConfig = migrateConfig(fileConfig)
        setConfig(mergeWithDefaults(migratedConfig, defaultConfig))

        // Get config path for display
        const path = await invoke('get_config_path_str')
        setConfigPath(path)
      } catch (err) {
        console.warn('Could not load config, using defaults:', err)
        setError(err.message || String(err))
        setConfig(defaultConfig)
      }
      setIsLoaded(true)
    }

    loadConfig()
  }, [])

  // Reload config from file
  const reloadConfig = useCallback(async () => {
    try {
      const fileConfig = await invoke('read_config')
      // Merge with defaults to ensure new fields get default values
      setConfig(mergeWithDefaults(fileConfig, defaultConfig))
      setError(null)
      return true
    } catch (err) {
      console.error('Failed to reload config:', err)
      setError(err.message || String(err))
      return false
    }
  }, [])

  // Save config to file and update state
  const saveConfig = useCallback(async (newConfig) => {
    try {
      await invoke('write_config', { config: newConfig })
      setConfig(newConfig)
      setError(null)
      return true
    } catch (err) {
      console.error('Failed to save config:', err)
      setError(err.message || String(err))
      return false
    }
  }, [])

  const getWsUrl = useCallback(() => {
    const { host, port, use_ssl } = config.gpu_server
    const protocol = use_ssl ? 'wss' : 'ws'
    return `${protocol}://${host}:${port}/ws`
  }, [config.gpu_server])

  // Save GPU server URL from user input (parses "host:port" format)
  const saveGpuServerUrl = useCallback(
    async (url) => {
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

  // Open config file in default application
  const openConfig = useCallback(async () => {
    try {
      await invoke('open_config')
      return true
    } catch (err) {
      console.error('Failed to open config:', err)
      setError(err.message || String(err))
      return false
    }
  }, [])

  // Engine mode helpers
  const engineMode = config.features?.engine_mode ?? ENGINE_MODES.UNCHOSEN

  const value = {
    config,
    isLoaded,
    error,
    configPath,
    reloadConfig,
    saveConfig,
    saveGpuServerUrl,
    openConfig,
    getWsUrl,
    hasOpenAiKey: !!config.api_keys.openai,
    hasFalKey: !!config.api_keys.fal,
    hasHuggingFaceKey: !!config.api_keys.huggingface,
    // Engine mode helpers
    engineMode,
    isEngineUnchosen: engineMode === ENGINE_MODES.UNCHOSEN,
    isStandaloneMode: engineMode === ENGINE_MODES.STANDALONE,
    isServerMode: engineMode === ENGINE_MODES.SERVER
  }

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

// Hook to use config - must be used within ConfigProvider
export const useConfig = () => {
  const context = useContext(ConfigContext)
  if (!context) {
    throw new Error('useConfig must be used within a ConfigProvider')
  }
  return context
}

export default useConfig
