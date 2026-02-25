import { useState, useEffect, type KeyboardEvent, type MouseEvent } from 'react'
import { useConfig, ENGINE_MODES } from '../hooks/useConfig'
import type { EngineMode } from '../types/app'

import { invoke } from '../bridge'

/**
 * Choice dialog shown to first-time users to select how they want to run the World Engine.
 * Options:
 * - Automatic Setup (Standalone): Biome manages the World Engine
 * - Run Server Yourself (Server): User runs their own server
 */
const EngineModeChoice = ({ onChoiceMade }: { onChoiceMade: (mode: EngineMode) => void }) => {
  const { config, saveConfig } = useConfig()
  const [isLoading, setIsLoading] = useState(false)
  const [engineDirPath, setEngineDirPath] = useState<string | null>(null)

  // Get engine directory path on mount
  useEffect(() => {
    invoke('get-engine-dir-path').then(setEngineDirPath).catch(console.warn)
  }, [])

  const handleStandaloneChoice = async () => {
    setIsLoading(true)
    try {
      await saveConfig({
        ...config,
        features: { ...config.features, engine_mode: ENGINE_MODES.STANDALONE }
      })
      onChoiceMade(ENGINE_MODES.STANDALONE)
    } catch (err) {
      console.error('Failed to save config:', err)
      setIsLoading(false)
    }
  }

  const handleServerChoice = async () => {
    try {
      await saveConfig({
        ...config,
        features: { ...config.features, engine_mode: ENGINE_MODES.SERVER }
      })
      onChoiceMade(ENGINE_MODES.SERVER)
    } catch (err) {
      console.error('Failed to save config:', err)
    }
  }

  const handleOpenEngineDir = async () => {
    try {
      await invoke('open-engine-dir')
    } catch (err) {
      console.warn('Failed to open engine directory:', err)
    }
  }

  return (
    <div className="engine-mode-choice">
      <div className="choice-header">
        <h2>WORLD ENGINE SETUP</h2>
        <p className="choice-subtitle">Choose how to run the World Engine</p>
      </div>

      <div className="choice-options">
        <button className="choice-option choice-standalone" onClick={handleStandaloneChoice} disabled={isLoading}>
          <div className="choice-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div className="choice-text">
            <span className="choice-title">Automatic Setup</span>
            <span className="choice-desc">Have Biome set up World Engine for you</span>
            <span className="choice-recommended">(Recommended)</span>
          </div>
        </button>

        <button className="choice-option choice-server" onClick={handleServerChoice} disabled={isLoading}>
          <div className="choice-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div className="choice-text">
            <span className="choice-title">Run Server Yourself</span>
            <span className="choice-desc">For experimentation and hacking</span>
            {engineDirPath && (
              <span
                className="choice-dir-link"
                role="button"
                tabIndex={0}
                onClick={(e: MouseEvent<HTMLSpanElement>) => {
                  e.stopPropagation()
                  handleOpenEngineDir()
                }}
                onKeyDown={(e: KeyboardEvent<HTMLSpanElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    handleOpenEngineDir()
                  }
                }}
              >
                Open engine directory
              </span>
            )}
          </div>
        </button>
      </div>

      <p className="choice-footer">You can change this later in Settings</p>
    </div>
  )
}

export default EngineModeChoice
