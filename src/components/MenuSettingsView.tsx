import { useState, useEffect, useCallback } from 'react'
import { invoke } from '../bridge'
import { HEADING_BASE, SETTINGS_MUTED_TEXT } from '../styles'
import { useSettings } from '../hooks/useSettings'
import { ENGINE_MODES } from '../types/settings'
import { useStreaming } from '../context/StreamingContext'
import MenuButton from './ui/MenuButton'
import SettingsSection from './ui/SettingsSection'
import SettingsToggle from './ui/SettingsToggle'
import SettingsSelect from './ui/SettingsSelect'
import SettingsTextInput from './ui/SettingsTextInput'
import SettingsSlider from './ui/SettingsSlider'
import ConfirmModal from './ui/ConfirmModal'
import WorldEngineSection from './WorldEngineSection'
import EngineInstallModal from './EngineInstallModal'

type MenuModelOption = {
  id: string
  isLocal: boolean
}

type MenuSettingsViewProps = {
  onBack: () => void
}

const MenuSettingsView = ({ onBack }: MenuSettingsViewProps) => {
  const { settings, saveSettings } = useSettings()
  const {
    engineStatus,
    checkEngineStatus,
    setupEngine,
    engineSetupInProgress,
    isStreaming,
    mouseSensitivity,
    setMouseSensitivity
  } = useStreaming()

  // Convert streaming scale (0.1-3.0) to menu scale (10-100)
  const streamingToMenu = (v: number) => Math.round(10 + ((v - 0.1) * 90) / 2.9)

  const configEngineMode = settings.engine_mode
  const configWorldModel = settings.engine_model

  const [menuEngineMode, setMenuEngineMode] = useState<'server' | 'standalone'>(() =>
    configEngineMode === ENGINE_MODES.SERVER ? 'server' : 'standalone'
  )
  const [menuWorldModel, setMenuWorldModel] = useState(configWorldModel)
  const [menuMouseSensitivity, setMenuMouseSensitivity] = useState(() =>
    streamingToMenu(settings.mouse_sensitivity ?? mouseSensitivity)
  )
  const [menuModelOptions, setMenuModelOptions] = useState<MenuModelOption[]>([
    { id: configWorldModel, isLocal: false }
  ])
  const [menuModelsLoading, setMenuModelsLoading] = useState(false)
  const [menuModelsError, setMenuModelsError] = useState<string | null>(null)
  const [showFixModal, setShowFixModal] = useState(false)
  const [showModeSwitchModal, setShowModeSwitchModal] = useState(false)
  const [showLocalInstallLog, setShowLocalInstallLog] = useState(false)

  const configServerUrl = settings.server_url
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

  useEffect(() => {
    setMenuEngineMode(configEngineMode === ENGINE_MODES.SERVER ? 'server' : 'standalone')
    setMenuWorldModel(configWorldModel)
    setMenuMouseSensitivity(streamingToMenu(settings.mouse_sensitivity ?? mouseSensitivity))
    setMenuServerUrl(configServerUrl)
  }, [configEngineMode, configWorldModel, settings.mouse_sensitivity, mouseSensitivity, configServerUrl])

  const handleServerUrlBlur = useCallback(() => {
    try {
      const url = new URL(menuServerUrl)
      const normalizedPort = Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
      const normalizedUrl = `${url.protocol}//${url.hostname}:${normalizedPort}`
      setMenuServerUrl(normalizedUrl)
    } catch {
      // Invalid URL — revert to config value
      setMenuServerUrl(configServerUrl)
    }
  }, [menuServerUrl, configServerUrl])

  const handleEngineModeChange = (mode: 'server' | 'standalone') => {
    setMenuEngineMode(mode)
  }

  const handleWorldModelChange = (model: string) => {
    setMenuWorldModel(model)
  }

  const handleMouseSensitivityChange = (value: number) => {
    setMenuMouseSensitivity(value)
  }

  const applyDraftSettings = useCallback(async () => {
    let nextServerUrl = menuServerUrl
    try {
      // Validate the URL
      new URL(nextServerUrl)
    } catch {
      nextServerUrl = configServerUrl
      setMenuServerUrl(configServerUrl)
    }

    const engineModeValue = menuEngineMode === 'server' ? ENGINE_MODES.SERVER : ENGINE_MODES.STANDALONE
    const streamingValue = 0.1 + ((menuMouseSensitivity - 10) * 2.9) / 90

    await saveSettings({
      ...settings,
      server_url: nextServerUrl,
      engine_mode: engineModeValue,
      engine_model: menuWorldModel,
      mouse_sensitivity: streamingValue
    })
    setMouseSensitivity(streamingValue)
  }, [
    settings,
    configServerUrl,
    menuEngineMode,
    menuMouseSensitivity,
    menuServerUrl,
    menuWorldModel,
    saveSettings,
    setMouseSensitivity
  ])

  const hasEngineModeChanged = menuEngineMode !== (configEngineMode === ENGINE_MODES.SERVER ? 'server' : 'standalone')
  const hasWorldModelChanged = menuWorldModel !== configWorldModel

  const handleBackClick = async () => {
    if (isStreaming && (hasEngineModeChanged || hasWorldModelChanged)) {
      setShowModeSwitchModal(true)
      return
    }
    await applyDraftSettings()
    onBack()
  }

  const handleConfirmEngineModeSwitch = async () => {
    setShowModeSwitchModal(false)
    await applyDraftSettings()
    onBack()
  }

  const handleCancelEngineModeSwitch = () => {
    setShowModeSwitchModal(false)
  }

  const handleConfirmFixEngine = async () => {
    setShowFixModal(false)
    setShowLocalInstallLog(true)
    try {
      await setupEngine()
      await checkEngineStatus()
    } catch {
      // Error is surfaced by engineSetupError and server logs.
    }
  }

  return (
    <div className="absolute inset-0 z-[9] pointer-events-auto">
      <section className="absolute top-[var(--edge-top-xl)] left-[var(--edge-left)] w-[90%] z-[3] flex flex-col">
        <h2 className={`${HEADING_BASE} text-heading text-text-primary font-normal text-left`}>Settings</h2>
        <p className="m-0 font-serif text-caption text-text-muted max-w-[103.12cqh] text-left">
          Tweak your world to your liking.
        </p>
        <div className="pause-scene-scroll overflow-y-auto pr-[0.8cqh] max-h-[62cqh] mt-[1.1cqh] relative z-[4] flex flex-col gap-[2.3cqh] w-[60%]">
          <SettingsSection
            title="Engine Mode"
            description="how will you run the model? as part of Biome, or elsewhere?"
          >
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
            <WorldEngineSection engineReady={engineReady} onReinstallClick={() => setShowFixModal(true)} />
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
              <p className={`${SETTINGS_MUTED_TEXT} text-left [margin:0.35cqh_0_0.8cqh]`}>{menuModelsError}</p>
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
      </section>

      <MenuButton
        variant="primary"
        className="absolute right-[var(--edge-right)] bottom-[var(--edge-bottom)] w-btn-w px-0"
        onClick={() => {
          void handleBackClick()
        }}
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

      {showModeSwitchModal && (
        <ConfirmModal
          title="Apply Engine Changes?"
          description="Changing engine mode or world model will interrupt your current session and apply all pending settings."
          onCancel={handleCancelEngineModeSwitch}
          onConfirm={() => {
            void handleConfirmEngineModeSwitch()
          }}
          confirmLabel="Switch Mode"
          cancelLabel="Keep Current"
        />
      )}

      {showLocalInstallLog && <EngineInstallModal onClose={() => setShowLocalInstallLog(false)} />}
    </div>
  )
}

export default MenuSettingsView
