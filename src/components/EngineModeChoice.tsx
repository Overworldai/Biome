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
    <div className="engine-mode-choice w-3/4 bg-[rgba(10,14,18,0.95)] border border-hud/30 rounded-[1.5cqw] p-[3.75cqh_3.75cqw] z-100 animate-[choiceFadeIn_0.3s_ease-out] shadow-[0_0_20px_rgba(0,0,0,0.4),0_0_10px_rgba(120,255,245,0.08),inset_0_1px_0_rgba(120,255,245,0.1)]">
      <div className="text-center mb-[3.75cqh]">
        <h2 className="font-mono text-[3cqw] text-hud/95 tracking-[0.15em] mt-0 mb-[1.2cqh]">WORLD ENGINE SETUP</h2>
        <p className="text-[rgba(200,200,200,0.7)] text-[2.1cqw] m-0">Choose how to run the World Engine</p>
      </div>

      <div className="flex flex-col gap-[2.25cqh] mb-[3.75cqh]">
        <button
          className="flex items-center gap-[2.25cqw] p-[2.25cqh_2.25cqw] bg-hud/5 border border-hud/40 rounded-[0.9cqw] cursor-pointer transition-all duration-200 ease-in-out text-left hover:bg-hud/10 hover:border-hud/40 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleStandaloneChoice}
          disabled={isLoading}
        >
          <div className="shrink-0 w-[5.25cqw] h-[5.25cqw]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="w-full h-full stroke-hud/80"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div className="flex flex-col gap-[0.6cqh]">
            <span className="font-mono text-[2.25cqw] text-white/95">Automatic Setup</span>
            <span className="text-[1.95cqw] text-[rgba(200,200,200,0.7)]">Have Biome set up World Engine for you</span>
            <span className="text-[1.8cqw] text-hud/80 italic">(Recommended)</span>
          </div>
        </button>

        <button
          className="flex items-center gap-[2.25cqw] p-[2.25cqh_2.25cqw] bg-hud/5 border border-hud/20 rounded-[0.9cqw] cursor-pointer transition-all duration-200 ease-in-out text-left hover:bg-hud/10 hover:border-hud/40 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleServerChoice}
          disabled={isLoading}
        >
          <div className="shrink-0 w-[5.25cqw] h-[5.25cqw]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="w-full h-full stroke-hud/80"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div className="flex flex-col gap-[0.6cqh]">
            <span className="font-mono text-[2.25cqw] text-white/95">Run Server Yourself</span>
            <span className="text-[1.95cqw] text-[rgba(200,200,200,0.7)]">For experimentation and hacking</span>
            {engineDirPath && (
              <span
                className="text-[1.8cqw] text-hud/70 bg-transparent border-none p-0 m-0 cursor-pointer underline underline-offset-2 text-left self-start hover:text-hud"
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

      <p className="text-center text-[1.8cqw] text-[rgba(150,150,150,0.6)] m-0">
        You can change this later in Settings
      </p>
    </div>
  )
}

export default EngineModeChoice
