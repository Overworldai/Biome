import { useState, useEffect, useCallback } from 'react'
import { invoke } from '../bridge'
import { useConfig, ENGINE_MODES } from '../hooks/useConfig'
import { useStreaming } from '../context/StreamingContext'
import type { AppConfig } from '../types/app'
import ViewLabel from './ui/ViewLabel'
import MenuButton from './ui/MenuButton'
import SettingsButton from './ui/SettingsButton'
import SettingsSection from './ui/SettingsSection'
import SettingsToggle from './ui/SettingsToggle'
import SettingsSelect from './ui/SettingsSelect'
import SettingsTextInput from './ui/SettingsTextInput'
import SettingsSlider from './ui/SettingsSlider'
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
  const [showFixModal, setShowFixModal] = useState(false)

  const configServerUrl = `${config.gpu_server.use_ssl ? 'https' : 'http'}://${config.gpu_server.host}:${config.gpu_server.port}`
  const [menuServerUrl, setMenuServerUrl] = useState(configServerUrl)

  const engineReady = engineStatus
    ? engineStatus.uv_installed && engineStatus.repo_cloned && engineStatus.dependencies_synced
    : null

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

  const handleServerUrlBlur = useCallback(() => {
    try {
      const url = new URL(menuServerUrl)
      const newConfig: AppConfig = {
        ...config,
        gpu_server: {
          ...config.gpu_server,
          host: url.hostname,
          port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
          use_ssl: url.protocol === 'https:'
        }
      }
      saveConfig(newConfig)
    } catch {
      // Invalid URL — revert to config value
      setMenuServerUrl(configServerUrl)
    }
  }, [menuServerUrl, config, configServerUrl, saveConfig])

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
          <SettingsSection title="Server URL" description="the address of the GPU server running the model">
            <SettingsTextInput
              value={menuServerUrl}
              onChange={setMenuServerUrl}
              onBlur={handleServerUrlBlur}
              placeholder="http://localhost:8000"
            />
          </SettingsSection>
        )}

        {menuEngineMode === 'standalone' && (
          <SettingsSection
            title="World Engine"
            description={
              <span className="inline-flex items-center gap-[0.4cqw]">
                is the local engine healthy?{' '}
                {engineReady === null ? (
                  'unknown'
                ) : engineReady ? (
                  <>
                    yes
                    <span className="inline-block w-[0.55cqw] h-[0.55cqw] rounded-full bg-[rgba(100,220,100,0.95)] shadow-[0_0_5px_1px_rgba(100,220,100,0.4)]" />
                  </>
                ) : (
                  <>
                    no
                    <span className="inline-block w-[0.55cqw] h-[0.55cqw] rounded-full bg-[rgba(255,120,80,0.95)] shadow-[0_0_5px_1px_rgba(255,120,80,0.4)]" />
                  </>
                )}
              </span>
            }
          >
            <div className="flex justify-end">
              <SettingsButton
                variant="ghost"
                onClick={() => setShowFixModal(true)}
              >
                Reinstall
              </SettingsButton>
            </div>
          </SettingsSection>
        )}

        <SettingsSection title="World Model" description="which Overworld model will simulate your world?">
          <SettingsSelect
            options={menuModelOptions.map((model) => ({
              value: model.id,
              label: model.id.replace(/^Overworld\//, ''),
              prefix: model.isLocal ? 'local' : 'download'
            }))}
            value={menuWorldModel}
            onChange={handleWorldModelChange}
            disabled={menuModelsLoading}
          />
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
          <SettingsSlider
            min={10}
            max={100}
            value={menuMouseSensitivity}
            onChange={handleMouseSensitivityChange}
            label={`${menuMouseSensitivity}%`}
          />
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
