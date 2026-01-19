import { useState, useEffect, useCallback } from 'react'

const defaultConfig = {
  gpu_server: {
    host: 'localhost',
    port: 8082,
    use_ssl: false
  },
  api_keys: {
    openai: '',
    fal: ''
  },
  features: {
    prompt_sanitizer: true,
    seed_generation: false,
    use_standalone_engine: true
  }
}

// Tauri invoke helper
const invoke = async (cmd, args = {}) => {
  return window.__TAURI_INTERNALS__.invoke(cmd, args)
}

export const useConfig = () => {
  const [config, setConfig] = useState(defaultConfig)
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [configPath, setConfigPath] = useState(null)

  // Load config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const fileConfig = await invoke('read_config')
        setConfig(fileConfig)

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
      setConfig(fileConfig)
      setError(null)
      return true
    } catch (err) {
      console.error('Failed to reload config:', err)
      setError(err.message || String(err))
      return false
    }
  }, [])

  // Save config to file
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
  const saveGpuServerUrl = useCallback(async (url) => {
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
  }, [config, saveConfig])

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

  return {
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
    hasFalKey: !!config.api_keys.fal
  }
}

export default useConfig
