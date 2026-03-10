import { useState, useEffect, useCallback } from 'react'
import { invoke } from '../bridge'
import { HEADING_BASE, SETTINGS_LABEL_BASE, SETTINGS_MUTED_TEXT } from '../styles'
import { useSettings } from '../hooks/useSettings'
import { ENGINE_MODES, type Keybindings } from '../types/settings'
import { useStreaming } from '../context/StreamingContext'
import { useVolumeControls } from '../hooks/useVolumeControls'
import MenuButton from './ui/MenuButton'
import SettingsSection from './ui/SettingsSection'
import SettingsToggle from './ui/SettingsToggle'
import SettingsSelect from './ui/SettingsSelect'
import SettingsTextInput from './ui/SettingsTextInput'
import SettingsSlider from './ui/SettingsSlider'
import SettingsKeybind, { fixedControlDisplay } from './ui/SettingsKeybind'
import { FIXED_CONTROLS, getKeybindConflict } from '../hooks/useGameInput'
import Modal from './ui/Modal'
import ConfirmModal from './ui/ConfirmModal'
import Button from './ui/Button'
import WorldEngineSection from './WorldEngineSection'
import EngineInstallModal from './EngineInstallModal'
import attributionText from '../../assets/audio/ATTRIBUTION.md?raw'

type MenuModelOption = {
  id: string
  isLocal: boolean
}

type KeybindRowProps =
  | { label: string; value: string; onChange: (code: string) => void; warning?: string | null; fixedLabel?: never }
  | { label: string; fixedLabel: string; value?: never; onChange?: never; warning?: never }

const KeybindRow = (props: KeybindRowProps) => {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-[2cqh]">
        <span className={`${SETTINGS_LABEL_BASE} text-text-primary w-[25cqh] text-right shrink-0`}>{props.label}</span>
        <div className="flex-1">
          {props.fixedLabel !== undefined ? (
            <SettingsKeybind value={props.fixedLabel} disabled />
          ) : (
            <SettingsKeybind value={props.value} onChange={props.onChange} />
          )}
        </div>
      </div>
      {props.warning && (
        <p className={`${SETTINGS_MUTED_TEXT} text-left m-0 mt-[0.4cqh] text-[1.8cqh] opacity-70 pl-[27cqh]`}>
          {props.warning}
        </p>
      )}
    </div>
  )
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
  const volume = useVolumeControls()

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
  const [showCredits, setShowCredits] = useState(false)

  const [menuKeybindings, setMenuKeybindings] = useState<Keybindings>(() => ({ ...settings.keybindings }))

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
    setMenuKeybindings({ ...settings.keybindings })
  }, [
    configEngineMode,
    configWorldModel,
    settings.mouse_sensitivity,
    mouseSensitivity,
    configServerUrl,
    settings.keybindings
  ])

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
      mouse_sensitivity: streamingValue,
      keybindings: menuKeybindings,
      audio: volume.getAudioSettings()
    })
    setMouseSensitivity(streamingValue)
  }, [
    settings,
    configServerUrl,
    menuEngineMode,
    menuMouseSensitivity,
    menuServerUrl,
    menuWorldModel,
    menuKeybindings,
    volume.getAudioSettings,
    saveSettings,
    setMouseSensitivity
  ])

  const hasEngineModeChanged = menuEngineMode !== (configEngineMode === ENGINE_MODES.SERVER ? 'server' : 'standalone')
  const hasWorldModelChanged = menuWorldModel !== configWorldModel

  const handleBackClick = useCallback(async () => {
    if (isStreaming && (hasEngineModeChanged || hasWorldModelChanged)) {
      setShowModeSwitchModal(true)
      return
    }
    await applyDraftSettings()
    onBack()
  }, [isStreaming, hasEngineModeChanged, hasWorldModelChanged, applyDraftSettings, onBack])

  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void handleBackClick()
      }
    }
    window.addEventListener('keyup', handleKeyUp)
    return () => window.removeEventListener('keyup', handleKeyUp)
  }, [handleBackClick])

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
        <div className="pause-scene-scroll overflow-y-auto pr-[0.8cqh] max-h-[62cqh] mt-[1.1cqh] relative z-[4] flex flex-col gap-[2.3cqh] w-[63%]">
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
              allowCustom
            />
            {menuModelsError && (
              <p className={`${SETTINGS_MUTED_TEXT} text-left [margin:0.35cqh_0_0.8cqh]`}>{menuModelsError}</p>
            )}
          </SettingsSection>

          <SettingsSection title="Volume" description="how loud should things be?">
            <div className="flex flex-col gap-[1.5cqh]">
              <SettingsSlider
                min={0}
                max={100}
                value={volume.master}
                onChange={volume.setMaster}
                label="master"
                suffix={`${volume.master}%`}
              />
              <SettingsSlider
                min={0}
                max={100}
                value={volume.sfx}
                onChange={volume.setSfx}
                label="sound effects"
                suffix={`${volume.sfx}%`}
              />
              <SettingsSlider
                min={0}
                max={100}
                value={volume.music}
                onChange={volume.setMusic}
                label="music"
                suffix={`${volume.music}%`}
              />
            </div>
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
              label="sensitivity"
              suffix={`${menuMouseSensitivity}%`}
            />
          </SettingsSection>

          <SettingsSection title="Keybindings" description="what keys do you want to use?">
            <KeybindRow
              label="Reset Scene"
              value={menuKeybindings.reset_scene}
              onChange={(code) => setMenuKeybindings((prev) => ({ ...prev, reset_scene: code }))}
              warning={getKeybindConflict(menuKeybindings.reset_scene, [])}
            />
          </SettingsSection>

          <SettingsSection title="Fixed Controls" description="what are the built-in controls?">
            {FIXED_CONTROLS.map((ctrl) => (
              <KeybindRow key={ctrl.label} label={ctrl.label} fixedLabel={fixedControlDisplay(ctrl)} />
            ))}
          </SettingsSection>
        </div>
      </section>

      <div className="absolute right-[var(--edge-right)] bottom-[var(--edge-bottom)] w-btn-w flex flex-col gap-[1.1cqh]">
        <MenuButton variant="secondary" className="w-full px-0" onClick={() => setShowCredits(true)}>
          Credits
        </MenuButton>
        <MenuButton
          variant="primary"
          className="w-full px-0"
          onClick={() => {
            void handleBackClick()
          }}
        >
          Back
        </MenuButton>
      </div>

      {showFixModal && (
        <ConfirmModal
          title="Reinstall?"
          description="This may fix issues with the simulation by reinstalling the engine."
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

      {showCredits && (
        <Modal title="Credits" onBackdropClick={() => setShowCredits(false)}>
          <pre className="m-0 mt-[0.8cqh] font-mono text-[1.8cqh] text-text-modal-muted whitespace-pre-wrap border border-border-subtle bg-white/5 p-[1.2cqh] rounded-[0.4cqh]">
            {attributionText.trim()}
          </pre>
          <div className="flex justify-end mt-[1.4cqh]">
            <Button
              variant="primary"
              className="p-[0.5cqh_1.78cqh] text-[2.49cqh]"
              onClick={() => setShowCredits(false)}
            >
              Close
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default MenuSettingsView
