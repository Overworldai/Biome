import { createContext, useContext } from 'react'
import type { Settings, EngineMode } from '../types/settings'

export type SettingsContextValue = {
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

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export const useSettings = () => {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}

export default useSettings
