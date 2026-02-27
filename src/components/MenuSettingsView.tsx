import { useState, useEffect, useCallback } from 'react'
import { invoke } from '../bridge'
import { useConfig, ENGINE_MODES } from '../hooks/useConfig'
import { useStreaming } from '../context/StreamingContext'
import type { AppConfig } from '../types/app'
import ViewLabel from './ui/ViewLabel'
import MenuButton from './ui/MenuButton'
import SettingsSection from './ui/SettingsSection'
import SettingsToggle from './ui/SettingsToggle'
import SettingsSelect from './ui/SettingsSelect'
import ConfirmModal from './ui/ConfirmModal'

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
      <div className="menu-settings-panel absolute flex flex-col z-[1] top-[var(--edge-top-lg)] right-[var(--edge-right)] w-auto max-w-[760px] max-h-[78%] gap-[2.3cqh] pr-[0.4cqw] overflow-y-auto overflow-x-hidden [scrollbar-width:none]">
        <SettingsSection title="Engine Mode" description="how will you run the model? as part of Biome, or elsewhere?">
          <SettingsToggle
            options={[
              { value: 'server', label: 'Server' },
              { value: 'standalone', label: 'Standalone' }
            ]}
            value={menuEngineMode}
            onChange={(v) => handleEngineModeChange(v as 'server' | 'standalone')}
          />
        </SettingsSection>

        {menuEngineMode === 'server' && (
          <SettingsSection
            title="Server Options"
            description={
              <>
                <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
                  Install Dir: {engineDirPath || 'Loading...'}
                </p>
                <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
                  Server URL: {serverUrl}
                </p>
              </>
            }
          />
        )}

        {menuEngineMode === 'standalone' && (
          <SettingsSection title="Standalone Options" description={standaloneStatusText}>
            <button
              type="button"
              className="block ml-auto w-fit cursor-pointer border-none bg-transparent font-serif text-right text-[rgba(246,249,255,0.95)] mt-[0.6cqh] p-0 text-[clamp(20px,1.8cqw,28px)] hover:bg-[rgba(245,251,255,0.95)] hover:text-[rgba(10,14,24,0.96)]"
              onClick={() => setShowFixModal(true)}
            >
              Fix World Engine
            </button>
          </SettingsSection>
        )}

        <SettingsSection title="World Model" description="which Overworld model will simulate your world?">
          <SettingsSelect value={menuWorldModel} onChange={handleWorldModelChange} disabled={menuModelsLoading}>
            {menuModelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id} {model.isLocal ? '- Local' : '- Download'}
              </option>
            ))}
          </SettingsSelect>
          {menuModelsError && (
            <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
              {menuModelsError}
            </p>
          )}
        </SettingsSection>

        <SettingsSection
          title="Mouse Sensitivity"
          description="how much should the camera move when you move your mouse?"
        >
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
        </SettingsSection>
      </div>

      <ViewLabel>Settings</ViewLabel>

      <MenuButton
        variant="primary"
        className="absolute z-[1] right-[var(--edge-right)] bottom-[var(--edge-bottom)] min-w-[132px] m-0 p-[0.9cqh_1.5cqw] box-border appearance-none text-[clamp(19px,2.2cqw,30px)] tracking-tight pointer-events-auto"
        onClick={onBack}
      >
        Back
      </MenuButton>

      {showFixModal && (
        <ConfirmModal
          title="Fix World Engine?"
          description="This will run repair/setup and open the installation log screen."
          onCancel={() => setShowFixModal(false)}
          onConfirm={handleConfirmFixEngine}
        />
      )}
    </div>
  )
}

export default MenuSettingsView
