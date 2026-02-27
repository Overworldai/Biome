import { useState, useEffect, useCallback } from 'react'
import { invoke } from '../bridge'
import { useConfig, ENGINE_MODES } from '../hooks/useConfig'
import { useStreaming } from '../context/StreamingContext'
import type { AppConfig } from '../types/app'

type MenuModelOption = {
  id: string
  isLocal: boolean
}

type MenuSettingsViewProps = {
  onBack: () => void
  onFixEngine?: () => void
}

const MenuSettingsView = ({ onBack, onFixEngine }: MenuSettingsViewProps) => {
  const { config, saveConfig } = useConfig()
  const { engineStatus, checkEngineStatus, setupEngine, isStreaming, mouseSensitivity, setMouseSensitivity } =
    useStreaming()

  // Convert streaming scale (0.1-3.0) to menu scale (10-100)
  const streamingToMenu = (v: number) => Math.round(10 + ((v - 0.1) * 90) / 2.9)

  const configEngineMode = config.features?.engine_mode
  const configWorldModel = config.features?.world_engine_model || 'Overworld/Waypoint-1-Small'

  const [menuEngineMode, setMenuEngineMode] = useState<'server' | 'standalone'>(() =>
    configEngineMode === ENGINE_MODES.SERVER ? 'server' : 'standalone'
  )
  const [menuWorldModel, setMenuWorldModel] = useState(configWorldModel)
  const [menuMouseSensitivity, setMenuMouseSensitivity] = useState(() => streamingToMenu(mouseSensitivity))
  const [menuModelOptions, setMenuModelOptions] = useState<MenuModelOption[]>([
    { id: configWorldModel, isLocal: false }
  ])
  const [menuModelsLoading, setMenuModelsLoading] = useState(false)
  const [menuModelsError, setMenuModelsError] = useState<string | null>(null)
  const [engineDirPath, setEngineDirPath] = useState<string | null>(null)
  const [showFixModal, setShowFixModal] = useState(false)

  const serverUrl = `${config.gpu_server.use_ssl ? 'https' : 'http'}://${config.gpu_server.host}:${config.gpu_server.port}`

  const standaloneStatusText = (() => {
    if (!engineStatus) return 'Status unavailable'
    const isReady = engineStatus.uv_installed && engineStatus.repo_cloned && engineStatus.dependencies_synced
    if (isReady) return 'World Engine: Ready'
    if (engineStatus.uv_installed || engineStatus.repo_cloned || engineStatus.dependencies_synced) {
      return 'World Engine: Needs repair'
    }
    return 'World Engine: Not installed'
  })()

  // Fetch engine dir path
  useEffect(() => {
    invoke('get-engine-dir-path')
      .then(setEngineDirPath)
      .catch(() => setEngineDirPath(null))
  }, [])

  // Check engine status in standalone mode
  useEffect(() => {
    if (menuEngineMode === 'standalone') {
      checkEngineStatus().catch(() => null)
    }
  }, [menuEngineMode, checkEngineStatus])

  // Load model list
  useEffect(() => {
    let cancelled = false

    const loadMenuModels = async () => {
      setMenuModelsLoading(true)
      setMenuModelsError(null)
      try {
        const remoteModels = await invoke('list-waypoint-models')
        if (cancelled) return

        const ids = [...new Set([menuWorldModel, ...(Array.isArray(remoteModels) ? remoteModels : [])])]
          .map((id) => id.trim())
          .filter((id) => id.length > 0)

        const availability = await invoke('list-model-availability', ids)
        if (cancelled) return

        const availabilityMap = new Map((availability || []).map((entry) => [entry.id, !!entry.is_local]))
        setMenuModelOptions(ids.map((id) => ({ id, isLocal: availabilityMap.get(id) ?? false })))
      } catch {
        if (cancelled) return
        setMenuModelsError('Could not load model list')
      } finally {
        if (!cancelled) {
          setMenuModelsLoading(false)
        }
      }
    }

    loadMenuModels()

    return () => {
      cancelled = true
    }
  }, [menuWorldModel])

  // Auto-save engine mode to config
  const autoSaveEngineMode = useCallback(
    (mode: 'server' | 'standalone') => {
      const engineModeValue = mode === 'server' ? ENGINE_MODES.SERVER : ENGINE_MODES.STANDALONE
      const newConfig: AppConfig = {
        ...config,
        features: {
          ...config.features,
          engine_mode: engineModeValue
        }
      }
      saveConfig(newConfig)
    },
    [config, saveConfig]
  )

  // Auto-save world model to config
  const autoSaveWorldModel = useCallback(
    (model: string) => {
      const newConfig: AppConfig = {
        ...config,
        features: {
          ...config.features,
          world_engine_model: model
        }
      }
      saveConfig(newConfig)
    },
    [config, saveConfig]
  )

  const handleEngineModeChange = (mode: 'server' | 'standalone') => {
    setMenuEngineMode(mode)
    autoSaveEngineMode(mode)
  }

  const handleWorldModelChange = (model: string) => {
    setMenuWorldModel(model)
    autoSaveWorldModel(model)
  }

  const handleMouseSensitivityChange = (value: number) => {
    setMenuMouseSensitivity(value)
    if (isStreaming) {
      // Convert 10-100 integer scale to 0.1-3.0 float scale
      const streamingValue = 0.1 + ((value - 10) * 2.9) / 90
      setMouseSensitivity(streamingValue)
    }
  }

  const handleConfirmFixEngine = async () => {
    setShowFixModal(false)
    if (onFixEngine) {
      onFixEngine()
    }
    try {
      await setupEngine()
      await checkEngineStatus()
    } catch {
      // Error is surfaced by engineSetupError and server logs.
    }
  }

  return (
    <div className="menu-settings-view absolute inset-0 z-[9] pointer-events-auto">
      <div className="menu-settings-panel absolute flex flex-col z-[1] top-[8%] left-[39%] right-[4%] w-auto max-w-[760px] max-h-[78%] gap-[2.3cqh] pr-[0.4cqw] overflow-y-auto overflow-x-hidden [scrollbar-width:none]">
        <div className="">
          <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[clamp(34px,4.2cqw,52px)] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
            Engine Mode
          </h2>
          <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
            how will you run the model? as part of Biome, or elsewhere?
          </p>
          <div className="flex border border-[rgba(245,251,255,0.75)]">
            <button
              type="button"
              className={`flex-1 cursor-pointer font-serif p-[0.55cqh_0.8cqw] text-[clamp(18px,1.7cqw,28px)] border-r border-r-[rgba(245,251,255,0.5)] ${menuEngineMode === 'server' ? 'bg-[rgba(245,251,255,0.9)] text-[rgba(15,20,32,0.95)]' : 'bg-[rgba(8,12,20,0.28)] text-[rgba(245,249,255,0.92)]'}`}
              onClick={() => handleEngineModeChange('server')}
            >
              Server
            </button>
            <button
              type="button"
              className={`flex-1 cursor-pointer font-serif p-[0.55cqh_0.8cqw] text-[clamp(18px,1.7cqw,28px)] border-r-0 ${menuEngineMode === 'standalone' ? 'bg-[rgba(245,251,255,0.9)] text-[rgba(15,20,32,0.95)]' : 'bg-[rgba(8,12,20,0.28)] text-[rgba(245,249,255,0.92)]'}`}
              onClick={() => handleEngineModeChange('standalone')}
            >
              Standalone
            </button>
          </div>
        </div>

        {menuEngineMode === 'server' && (
          <div className="">
            <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[clamp(34px,4.2cqw,52px)] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
              Server Options
            </h2>
            <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
              Install Dir: {engineDirPath || 'Loading...'}
            </p>
            <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
              Server URL: {serverUrl}
            </p>
          </div>
        )}

        {menuEngineMode === 'standalone' && (
          <div className="">
            <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[clamp(34px,4.2cqw,52px)] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
              Standalone Options
            </h2>
            <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
              {standaloneStatusText}
            </p>
            <button
              type="button"
              className="block ml-auto w-fit cursor-pointer border-none bg-transparent font-serif text-right text-[rgba(246,249,255,0.95)] mt-[0.6cqh] p-0 text-[clamp(20px,1.8cqw,28px)] hover:bg-[rgba(245,251,255,0.95)] hover:text-[rgba(10,14,24,0.96)]"
              onClick={() => setShowFixModal(true)}
            >
              Fix World Engine
            </button>
          </div>
        )}

        <div className="">
          <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[clamp(34px,4.2cqw,52px)] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
            World Model
          </h2>
          <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
            which Overworld model will simulate your world?
          </p>
          <div className="menu-select-wrap border border-[rgba(245,251,255,0.75)] bg-[rgba(8,12,20,0.28)]">
            <select
              className="w-full cursor-pointer border-none bg-transparent font-serif text-[rgba(245,249,255,0.92)] outline-none appearance-none p-[0.55cqh_0.8cqw] text-[clamp(18px,1.5cqw,24px)]"
              value={menuWorldModel}
              onChange={(event) => handleWorldModelChange(event.target.value)}
              disabled={menuModelsLoading}
            >
              {menuModelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id} {model.isLocal ? '- Local' : '- Download'}
                </option>
              ))}
            </select>
          </div>
          {menuModelsError && (
            <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
              {menuModelsError}
            </p>
          )}
        </div>

        <div className="">
          <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[clamp(34px,4.2cqw,52px)] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
            Mouse Sensitivity
          </h2>
          <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
            how much should the camera move when you move your mouse?
          </p>
          <div className="flex flex-col items-end gap-[0.4cqh]">
            <input
              className="menu-range-slider w-full m-0 cursor-pointer outline-none appearance-none h-[0.8cqh] rounded-full bg-[rgba(245,251,255,0.42)]"
              type="range"
              min={10}
              max={100}
              value={menuMouseSensitivity}
              onChange={(event) => handleMouseSensitivityChange(Number(event.target.value))}
            />
            <span className="font-serif text-[rgba(240,245,252,0.85)] text-[clamp(16px,1.35cqw,22px)]">
              {menuMouseSensitivity}%
            </span>
          </div>
        </div>
      </div>

      <div className="absolute z-[1] left-[4.3%] bottom-[4.1%] font-serif text-[clamp(30px,4.2cqw,52px)] text-[rgba(248,248,245,0.92)] leading-none tracking-wider pointer-events-none [text-shadow:0_0_18px_rgba(0,0,0,0.38),0_0_4px_rgba(255,255,255,0.16)]">
        Settings
      </div>

      <button
        type="button"
        className="absolute z-[1] right-[var(--menu-right-edge)] bottom-[4.1%] min-w-[132px] m-0 p-[0.9cqh_1.5cqw] box-border appearance-none cursor-pointer font-serif text-[clamp(19px,2.2cqw,30px)] text-text-secondary leading-none tracking-tight bg-[rgba(8,12,20,0.28)] border border-[rgba(245,251,255,0.8)] pointer-events-auto transition-all duration-[160ms] hover:bg-[rgba(245,251,255,0.9)] hover:text-[rgba(15,20,32,0.95)] hover:-translate-y-px"
        onClick={onBack}
      >
        Back
      </button>

      {showFixModal && (
        <div
          className="absolute inset-0 z-[3] flex items-center justify-center bg-[rgba(2,6,16,0.55)] backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="border border-[rgba(245,251,255,0.66)] bg-[rgba(8,12,20,0.92)] text-[rgba(246,249,255,0.95)] w-[min(420px,76cqw)] p-[1.8cqh_1.6cqw]">
            <h3 className="m-0 mb-[0.6cqh] font-serif font-medium text-[clamp(26px,2.2cqw,34px)]">Fix World Engine?</h3>
            <p className="m-0 font-serif text-[rgba(233,242,255,0.82)] text-[clamp(16px,1.35cqw,21px)]">
              This will run repair/setup and open the installation log screen.
            </p>
            <div className="flex justify-end mt-[1.4cqh] gap-[0.8cqw]">
              <button
                type="button"
                className="cursor-pointer font-serif border border-[rgba(245,251,255,0.7)] bg-[rgba(8,12,20,0.18)] text-[rgba(245,251,255,0.95)] p-[0.5cqh_1cqw] text-[clamp(17px,1.4cqw,22px)]"
                onClick={() => setShowFixModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cursor-pointer font-serif bg-[rgba(245,251,255,0.9)] text-[rgba(15,20,32,0.95)] p-[0.5cqh_1cqw] text-[clamp(17px,1.4cqw,22px)]"
                onClick={handleConfirmFixEngine}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MenuSettingsView
