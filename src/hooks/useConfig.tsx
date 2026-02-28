import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react'
import { invoke } from '../bridge'
import type { AppConfig, EngineMode } from '../types/app'
import { STANDALONE_PORT, DEFAULT_WORLD_ENGINE_MODEL, ENGINE_MODES } from '../constants/configShared'

export { STANDALONE_PORT, DEFAULT_WORLD_ENGINE_MODEL, ENGINE_MODES }

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
  isStandaloneMode: boolean
  isServerMode: boolean
}

const ConfigContext = createContext<ConfigContextValue | null>(null)

export const ConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configPath, setConfigPath] = useState<string | null>(null)

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const fileConfig = await invoke('read-config')
        setConfig(fileConfig)

        const path = await invoke('get-config-path-str')
        setConfigPath(path)
      } catch (err) {
        console.warn('Could not load config:', err)
        try {
          const fallbackConfig = await invoke('read-default-config')
          setConfig(fallbackConfig)
        } catch (fallbackErr) {
          console.error('Could not load default config from main process:', fallbackErr)
          setError(fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr))
        }
      }
      setIsLoaded(true)
    }

    loadConfig()
  }, [])

  const reloadConfig = useCallback(async () => {
    try {
      const fileConfig = await invoke('read-config')
      setConfig(fileConfig)
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

  const engineMode = (config?.features?.engine_mode ?? ENGINE_MODES.STANDALONE) as EngineModes

  const getUrl = useCallback(() => {
    if (!config) {
      return `http://localhost:${STANDALONE_PORT}`
    }

    if (engineMode === ENGINE_MODES.STANDALONE) {
      const configuredPort = config.gpu_server?.port ?? STANDALONE_PORT
      return `http://localhost:${configuredPort}`
    }

    const { host, port, use_ssl } = config.gpu_server
    const protocol = use_ssl ? 'https' : 'http'
    return `${protocol}://${host}:${port}`
  }, [engineMode, config?.gpu_server])

  const saveGpuServerUrl = useCallback(
    async (url: string) => {
      if (!config) return false

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

  if (!config) {
    return null
  }

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
