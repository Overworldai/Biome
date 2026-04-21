import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react'
import { invoke } from '../bridge'
import type { Settings, EngineMode } from '../types/settings'
import { ENGINE_MODES, DEFAULT_STANDALONE_URL } from '../types/settings'

type SettingsContextValue = {
  settings: Settings
  isLoaded: boolean
  error: string | null
  settingsPath: string | null
  reloadSettings: () => Promise<boolean>
  saveSettings: (s: Settings) => Promise<boolean>
  openSettings: () => Promise<boolean>
  getUrl: () => string
  engineMode: EngineMode
  isStandaloneMode: boolean
  isServerMode: boolean
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsPath, setSettingsPath] = useState<string | null>(null)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const fileSettings = await invoke('read-settings')
        setSettings(fileSettings)

        const path = await invoke('get-settings-path-str')
        setSettingsPath(path)
      } catch (err) {
        console.warn('Could not load settings:', err)
        try {
          const fallbackSettings = await invoke('read-default-settings')
          setSettings(fallbackSettings)
        } catch (fallbackErr) {
          console.error('Could not load default settings from main process:', fallbackErr)
          setError(fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr))
        }
      }
      setIsLoaded(true)
    }

    loadSettings()
  }, [])

  const reloadSettings = useCallback(async () => {
    try {
      const fileSettings = await invoke('read-settings')
      setSettings(fileSettings)
      setError(null)
      return true
    } catch (err) {
      console.error('Failed to reload settings:', err)
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  const saveSettings = useCallback(async (newSettings: Settings) => {
    try {
      await invoke('write-settings', newSettings)
      setSettings(newSettings)
      setError(null)
      return true
    } catch (err) {
      console.error('Failed to save settings:', err)
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  const engineMode = settings?.engine_mode ?? ENGINE_MODES.STANDALONE

  const getUrl = useCallback(() => {
    if (!settings || engineMode === ENGINE_MODES.STANDALONE) {
      return DEFAULT_STANDALONE_URL
    }

    return settings.server_url
  }, [engineMode, settings])

  const openSettingsFile = useCallback(async () => {
    try {
      await invoke('open-settings')
      return true
    } catch (err) {
      console.error('Failed to open settings:', err)
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }, [])

  if (!settings) {
    return null
  }

  const value: SettingsContextValue = {
    settings,
    isLoaded,
    error,
    settingsPath,
    reloadSettings,
    saveSettings,
    openSettings: openSettingsFile,
    getUrl,
    engineMode,
    isStandaloneMode: engineMode === ENGINE_MODES.STANDALONE,
    isServerMode: engineMode === ENGINE_MODES.SERVER
  }

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export const useSettings = () => {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}

export default useSettings
