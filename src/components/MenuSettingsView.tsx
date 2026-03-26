import { useState, useEffect, useCallback, useRef } from 'react'
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
import SettingsCheckbox from './ui/SettingsCheckbox'
import SettingsKeybind, { fixedControlDisplay } from './ui/SettingsKeybind'
import { FIXED_CONTROLS, getKeybindConflict } from '../hooks/useGameInput'
import Modal from './ui/Modal'
import ConfirmModal from './ui/ConfirmModal'
import Button from './ui/Button'
import WorldEngineSection from './WorldEngineSection'
import EngineInstallModal from './EngineInstallModal'
import attributionText from '../../assets/audio/ATTRIBUTION.md?raw'
import { normalizeServerUrl, toHealthUrl } from '../utils/serverUrl'

type MenuModelOption = {
  id: string
  isLocal: boolean | null
  sizeBytes: number | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
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
  wide?: boolean
}

const MenuSettingsView = ({ onBack, wide }: MenuSettingsViewProps) => {
  const { settings, saveSettings } = useSettings()
  const {
    engineStatus,
    checkEngineStatus,
    setupEngine,
    nukeAndReinstallEngine,
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
    { id: configWorldModel, isLocal: false, sizeBytes: null }
  ])
  const [menuModelsLoading, setMenuModelsLoading] = useState(false)
  const [menuModelsError, setMenuModelsError] = useState<string | null>(null)
  const [showFixModal, setShowFixModal] = useState(false)
  const [showNukeModal, setShowNukeModal] = useState(false)
  const [showModeSwitchModal, setShowModeSwitchModal] = useState(false)
  const [showLocalInstallLog, setShowLocalInstallLog] = useState(false)
  const [showCredits, setShowCredits] = useState(false)

  const [menuKeybindings, setMenuKeybindings] = useState<Keybindings>(() => ({ ...settings.keybindings }))
  const [menuSceneEditEnabled, setMenuSceneEditEnabled] = useState(
    () => settings.experimental?.scene_edit_enabled ?? false
  )
  const [menuPerformanceStats, setMenuPerformanceStats] = useState(() => settings.debug_overlays.performance_stats)
  const [menuInputOverlay, setMenuInputOverlay] = useState(() => settings.debug_overlays.input)
  const [menuFrameTimeline, setMenuFrameTimeline] = useState(() => settings.debug_overlays.frame_timeline)

  const configServerUrl = settings.server_url
  const [menuServerUrl, setMenuServerUrl] = useState(configServerUrl)

  const [serverUrlStatus, setServerUrlStatus] = useState<'idle' | 'loading' | 'valid' | 'error'>('idle')
  const [lastValidatedServerUrl, setLastValidatedServerUrl] = useState('')
  const [showServerErrorModal, setShowServerErrorModal] = useState(false)

  const serverUrlUsesSecureTransport = /^\s*wss?:\/\//i.test(menuServerUrl)
    ? /^\s*wss:\/\//i.test(menuServerUrl)
    : /^\s*https:\/\//i.test(menuServerUrl)

  const [customModelStatus, setCustomModelStatus] = useState<{
    state: 'idle' | 'loading' | 'error'
    error: string | null
  }>({ state: 'idle', error: null })

  const engineReady = engineStatus
    ? engineStatus.uv_installed && engineStatus.repo_cloned && engineStatus.dependencies_synced
    : null

  // Check engine status in standalone mode
  useEffect(() => {
    if (menuEngineMode === 'standalone') {
      checkEngineStatus().catch(() => null)
    }
  }, [menuEngineMode, checkEngineStatus])

  // Auto-validate server URL when entering server mode or opening settings with a saved URL.
  // Uses a ref to avoid including serverUrlStatus in deps (which would cancel the in-flight probe).
  const serverUrlStatusRef = useRef(serverUrlStatus)
  serverUrlStatusRef.current = serverUrlStatus
  useEffect(() => {
    if (menuEngineMode !== 'server') return
    if (!menuServerUrl.trim()) return
    if (serverUrlStatusRef.current !== 'idle') return

    let cancelled = false
    const validate = async () => {
      setServerUrlStatus('loading')
      try {
        const normalizedUrl = normalizeServerUrl(menuServerUrl)
        const ok = await invoke('probe-server-health', toHealthUrl(normalizedUrl), 5000)
        if (cancelled) return
        if (ok) {
          setServerUrlStatus('valid')
          setLastValidatedServerUrl(normalizedUrl)
        } else {
          setServerUrlStatus('error')
        }
      } catch {
        if (!cancelled) setServerUrlStatus('error')
      }
    }
    validate()
    return () => {
      cancelled = true
    }
  }, [menuEngineMode, menuServerUrl])

  // Load model list — refetch when mode, server URL, or selected model changes
  const serverUrlForModels = menuEngineMode === 'server' ? menuServerUrl : undefined
  const savedCustomModels = settings.custom_models ?? []
  useEffect(() => {
    // In server mode, don't fetch until server is validated
    if (menuEngineMode === 'server' && serverUrlStatus !== 'valid') {
      setMenuModelOptions([{ id: menuWorldModel, isLocal: false, sizeBytes: null }])
      setMenuModelsLoading(false)
      return
    }

    let cancelled = false

    const loadMenuModels = async () => {
      setMenuModelsLoading(true)
      setMenuModelsError(null)
      try {
        const remoteModels = await invoke('list-waypoint-models')
        if (cancelled) return

        const ids = [
          ...new Set([menuWorldModel, ...(Array.isArray(remoteModels) ? remoteModels : []), ...savedCustomModels])
        ]
          .map((id) => id.trim())
          .filter((id) => id.length > 0)

        const [availability, modelsInfo] = await Promise.all([
          invoke('list-model-availability', ids),
          invoke('get-models-info', ids, serverUrlForModels)
        ])
        if (cancelled) return

        const availabilityMap = new Map((availability || []).map((entry) => [entry.id, !!entry.is_local]))
        const infoMap = new Map((modelsInfo || []).map((entry) => [entry.id, entry]))
        setMenuModelOptions(
          ids.map((id) => ({
            id,
            isLocal: availabilityMap.get(id) ?? false,
            sizeBytes: infoMap.get(id)?.size_bytes ?? null
          }))
        )
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
  }, [menuWorldModel, menuEngineMode, serverUrlForModels, serverUrlStatus, savedCustomModels])

  useEffect(() => {
    setMenuEngineMode(configEngineMode === ENGINE_MODES.SERVER ? 'server' : 'standalone')
    setMenuWorldModel(configWorldModel)
    setMenuMouseSensitivity(streamingToMenu(settings.mouse_sensitivity ?? mouseSensitivity))
    setMenuServerUrl(configServerUrl)
    setMenuKeybindings({ ...settings.keybindings })
    setMenuSceneEditEnabled(settings.experimental?.scene_edit_enabled ?? false)
    setMenuPerformanceStats(settings.debug_overlays.performance_stats)
    setMenuInputOverlay(settings.debug_overlays.input)
    setMenuFrameTimeline(settings.debug_overlays.frame_timeline)
  }, [
    configEngineMode,
    configWorldModel,
    settings.mouse_sensitivity,
    mouseSensitivity,
    configServerUrl,
    settings.keybindings,
    settings.debug_overlays.performance_stats,
    settings.debug_overlays.input,
    settings.debug_overlays.frame_timeline
  ])

  const handleServerUrlBlur = useCallback(async () => {
    if (!menuServerUrl.trim()) {
      setServerUrlStatus('idle')
      return
    }

    let normalizedUrl: string
    try {
      normalizedUrl = normalizeServerUrl(menuServerUrl)
    } catch {
      setServerUrlStatus('error')
      return
    }

    if (normalizedUrl === lastValidatedServerUrl && serverUrlStatus === 'valid') return

    setServerUrlStatus('loading')
    try {
      const ok = await invoke('probe-server-health', toHealthUrl(normalizedUrl), 5000)
      if (ok) {
        setServerUrlStatus('valid')
        setLastValidatedServerUrl(normalizedUrl)
      } else {
        setServerUrlStatus('error')
        setShowServerErrorModal(true)
      }
    } catch {
      setServerUrlStatus('error')
      setShowServerErrorModal(true)
    }
  }, [menuServerUrl, configServerUrl, lastValidatedServerUrl, serverUrlStatus])

  const handleEngineModeChange = (mode: 'server' | 'standalone') => {
    setMenuEngineMode(mode)
    setServerUrlStatus('idle')
    setLastValidatedServerUrl('')
  }

  const handleWorldModelChange = (model: string) => {
    setMenuWorldModel(model.trim())
    setCustomModelStatus({ state: 'idle', error: null })
  }

  const handleCustomModelBlur = useCallback(
    async (modelId: string) => {
      if (menuModelOptions.some((m) => m.id === modelId)) return
      setCustomModelStatus({ state: 'loading', error: null })
      try {
        const results = await invoke('get-models-info', [modelId], serverUrlForModels)
        const info = results?.[0]
        if (info && !info.exists) {
          setCustomModelStatus({ state: 'error', error: info.error ?? 'Model not found' })
        } else if (info?.error) {
          setCustomModelStatus({ state: 'error', error: info.error })
        } else {
          setCustomModelStatus({ state: 'idle', error: null })
          setMenuModelOptions((prev) => [...prev, { id: modelId, isLocal: null, sizeBytes: info?.size_bytes ?? null }])
          // Save verified custom model to settings for persistence
          if (!savedCustomModels.includes(modelId)) {
            void saveSettings({ ...settings, custom_models: [...savedCustomModels, modelId] })
          }
        }
      } catch {
        setCustomModelStatus({ state: 'error', error: 'Could not check model' })
      }
    },
    [menuModelOptions, serverUrlForModels, savedCustomModels, settings, saveSettings]
  )

  const handleDeleteCustomModel = useCallback(
    (modelId: string) => {
      const updated = savedCustomModels.filter((m) => m !== modelId)
      void saveSettings({ ...settings, custom_models: updated })
      setMenuModelOptions((prev) => prev.filter((m) => m.id !== modelId))
      // If the deleted model was selected, switch to the first available option
      if (menuWorldModel === modelId) {
        const fallback = menuModelOptions.find((m) => m.id !== modelId)?.id ?? settings.engine_model
        setMenuWorldModel(fallback)
      }
    },
    [savedCustomModels, settings, saveSettings, menuModelOptions, menuWorldModel]
  )

  const handleMouseSensitivityChange = (value: number) => {
    setMenuMouseSensitivity(value)
  }

  const applyDraftSettings = useCallback(async () => {
    let nextServerUrl = menuServerUrl
    if (nextServerUrl.trim()) {
      try {
        normalizeServerUrl(nextServerUrl)
      } catch {
        nextServerUrl = configServerUrl
      }
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
      audio: volume.getAudioSettings(),
      experimental: {
        scene_edit_enabled: menuSceneEditEnabled
      },
      debug_overlays: {
        performance_stats: menuPerformanceStats,
        input: menuInputOverlay,
        frame_timeline: menuFrameTimeline
      }
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
    menuSceneEditEnabled,
    menuPerformanceStats,
    menuInputOverlay,
    menuFrameTimeline,
    volume.getAudioSettings,
    saveSettings,
    setMouseSensitivity
  ])

  const hasEngineModeChanged = menuEngineMode !== (configEngineMode === ENGINE_MODES.SERVER ? 'server' : 'standalone')
  const hasWorldModelChanged = menuWorldModel !== configWorldModel

  const handleBackClick = useCallback(async () => {
    if (menuEngineMode === 'server' && (!menuServerUrl.trim() || serverUrlStatus !== 'valid')) {
      setShowServerErrorModal(true)
      return
    }
    if (isStreaming && (hasEngineModeChanged || hasWorldModelChanged)) {
      setShowModeSwitchModal(true)
      return
    }
    await applyDraftSettings()
    onBack()
  }, [
    menuEngineMode,
    menuServerUrl,
    serverUrlStatus,
    isStreaming,
    hasEngineModeChanged,
    hasWorldModelChanged,
    applyDraftSettings,
    onBack
  ])

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
    if (menuEngineMode === 'server' && (!menuServerUrl.trim() || serverUrlStatus !== 'valid')) {
      setShowModeSwitchModal(false)
      setShowServerErrorModal(true)
      return
    }
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

  const handleConfirmNukeEngine = async () => {
    setShowNukeModal(false)
    setShowLocalInstallLog(true)
    try {
      await nukeAndReinstallEngine()
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
        <div
          className={`styled-scrollbar overflow-y-auto pr-[0.8cqh] max-h-[62cqh] mt-[1.1cqh] relative z-[4] flex flex-col gap-[2.3cqh] ${wide ? 'w-[83%]' : 'w-[63%]'}`}
        >
          <SettingsSection
            title="Engine Mode"
            description="how will you run the model? as part of Biome, or elsewhere?"
          >
            <SettingsToggle
              options={[
                { value: 'standalone', label: 'Standalone' },
                { value: 'server', label: 'Server' }
              ]}
              value={menuEngineMode}
              onChange={(v) => handleEngineModeChange(v as 'server' | 'standalone')}
            />
          </SettingsSection>

          {menuEngineMode === 'server' && (
            <SettingsSection
              title="Server URL"
              description={
                <span className="inline-flex items-center gap-[0.71cqh] flex-wrap">
                  the address of the GPU server running the model ·{' '}
                  <a
                    className="underline cursor-pointer text-inherit"
                    onClick={() =>
                      window.open(
                        'https://github.com/Overworldai/Biome/blob/main/server-components/README.md',
                        '_blank',
                        'noopener,noreferrer'
                      )
                    }
                  >
                    setup instructions
                  </a>
                  {serverUrlStatus === 'loading' && ' · checking...'}
                  {serverUrlStatus === 'valid' && (
                    <>
                      {' · connected'}
                      <span className="inline-block w-[0.98cqh] h-[0.98cqh] rounded-full bg-[rgba(100,220,100,0.95)] shadow-[0_0_5px_1px_rgba(100,220,100,0.4)]" />
                    </>
                  )}
                  {serverUrlStatus === 'error' && (
                    <>
                      {' · unreachable'}
                      <span className="inline-block w-[0.98cqh] h-[0.98cqh] rounded-full bg-[rgba(255,120,80,0.95)] shadow-[0_0_5px_1px_rgba(255,120,80,0.4)]" />
                    </>
                  )}
                </span>
              }
            >
              <SettingsTextInput
                value={menuServerUrl}
                onChange={setMenuServerUrl}
                onBlur={() => void handleServerUrlBlur()}
                placeholder="http://localhost:7987"
              />
            </SettingsSection>
          )}

          {menuEngineMode === 'standalone' && (
            <WorldEngineSection
              engineReady={engineReady}
              onFixInPlaceClick={() => setShowFixModal(true)}
              onTotalReinstallClick={() => setShowNukeModal(true)}
            />
          )}

          <SettingsSection title="World Model" description="which Overworld model will simulate your world?">
            <SettingsSelect
              options={menuModelOptions.map((model) => ({
                value: model.id,
                label: model.id.replace(/^Overworld\//, ''),
                prefix: [
                  model.sizeBytes != null ? formatBytes(model.sizeBytes) : null,
                  model.isLocal === true ? 'local' : model.isLocal === false ? 'download' : null
                ]
                  .filter(Boolean)
                  .join(' \u00B7 '),
                deletable: savedCustomModels.includes(model.id)
              }))}
              value={menuWorldModel}
              onChange={handleWorldModelChange}
              onDelete={handleDeleteCustomModel}
              disabled={menuModelsLoading || (menuEngineMode === 'server' && serverUrlStatus !== 'valid')}
              allowCustom
              onCustomBlur={handleCustomModelBlur}
              customPrefix={
                customModelStatus.state === 'loading'
                  ? 'checking...'
                  : customModelStatus.state === 'error'
                    ? (customModelStatus.error ?? 'Model not found')
                    : undefined
              }
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
              warning={getKeybindConflict(menuKeybindings.reset_scene, [menuKeybindings.scene_edit])}
            />
            {menuSceneEditEnabled && (
              <KeybindRow
                label="Scene Edit"
                value={menuKeybindings.scene_edit}
                onChange={(code) => setMenuKeybindings((prev) => ({ ...prev, scene_edit: code }))}
                warning={getKeybindConflict(menuKeybindings.scene_edit, [menuKeybindings.reset_scene])}
              />
            )}
          </SettingsSection>

          <SettingsSection title="Fixed Controls" description="what are the built-in controls?">
            {FIXED_CONTROLS.map((ctrl) => (
              <KeybindRow key={ctrl.label} label={ctrl.label} fixedLabel={fixedControlDisplay(ctrl)} />
            ))}
          </SettingsSection>

          <SettingsSection title="Experimental" description="features that are still in development">
            <SettingsCheckbox
              label="Scene Edit"
              description="Press a key during gameplay to edit the scene with a text prompt using AI. Requires ~10GB additional VRAM."
              checked={menuSceneEditEnabled}
              onChange={setMenuSceneEditEnabled}
            />
          </SettingsSection>

          <SettingsSection title="Debug Metrics" description="want to see what's happening under the hood?">
            <div className="flex flex-col gap-[1cqh]">
              <SettingsCheckbox
                label="Performance Stats"
                checked={menuPerformanceStats}
                onChange={setMenuPerformanceStats}
              />
              <SettingsCheckbox label="Input Overlay" checked={menuInputOverlay} onChange={setMenuInputOverlay} />
              <SettingsCheckbox label="Frame Timeline" checked={menuFrameTimeline} onChange={setMenuFrameTimeline} />
            </div>
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
          title="Fix In Place?"
          description="This will re-sync engine dependencies without deleting anything. Usually enough to fix issues after an update."
          onCancel={() => setShowFixModal(false)}
          onConfirm={() => void handleConfirmFixEngine()}
          confirmLabel="Fix"
        />
      )}

      {showNukeModal && (
        <ConfirmModal
          title="Total Reinstall?"
          description="This will completely delete the engine directory and reinstall everything from scratch, including re-downloading Python, all dependencies, and the UV package manager. This can take a while, but may fix stubborn issues that Fix In Place cannot."
          onCancel={() => setShowNukeModal(false)}
          onConfirm={() => void handleConfirmNukeEngine()}
          confirmLabel="Reinstall Everything"
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

      {showServerErrorModal && (
        <ConfirmModal
          title="Server Unreachable"
          description={
            menuServerUrl.trim()
              ? `Could not connect to ${menuServerUrl}. The server may be down, the URL may be wrong, or a firewall may be blocking the connection.${serverUrlUsesSecureTransport ? '\n\nHTTPS and WSS are not supported by default; if you are connecting directly to the Biome server, try using HTTP or WS instead.' : ''}`
              : 'Please enter a server URL before leaving settings.'
          }
          onConfirm={() => setShowServerErrorModal(false)}
          onCancel={() => {
            setShowServerErrorModal(false)
            setMenuServerUrl(configServerUrl)
            setServerUrlStatus('idle')
          }}
          confirmLabel="Edit URL"
          cancelLabel="Revert"
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
