import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES } from '../i18n'
import { invoke } from '../bridge'
import { HEADING_BASE, SETTINGS_MUTED_TEXT } from '../styles'
import { useSettings } from '../hooks/useSettings'
import { ENGINE_MODES, QUANT_OPTIONS, type AppLocale, type Keybindings, type QuantOption } from '../types/settings'
import { useStreaming } from '../context/StreamingContext'
import { useVolumeControls } from '../hooks/useVolumeControls'
import MenuButton from './ui/MenuButton'
import SettingsSection from './ui/SettingsSection'
import SettingsToggle from './ui/SettingsToggle'
import SettingsSelect from './ui/SettingsSelect'
import SettingsTextInput from './ui/SettingsTextInput'
import SettingsSlider from './ui/SettingsSlider'
import SettingsCheckbox from './ui/SettingsCheckbox'
import SettingsKeybind, { fixedControlDisplay, fixedControlLabel } from './ui/SettingsKeybind'
import SettingsRow from './ui/SettingsRow'
import { FIXED_CONTROLS, getKeybindConflict } from '../hooks/useGameInput'
import Modal from './ui/Modal'
import ConfirmModal from './ui/ConfirmModal'
import Button from './ui/Button'
import WorldEngineSection from './WorldEngineSection'
import EngineInstallModal from './EngineInstallModal'
import attributionText from '../../assets/audio/ATTRIBUTION.md?raw'
import { normalizeServerUrl, toHealthUrl } from '../utils/serverUrl'

const isMac = navigator.platform.startsWith('Mac')
/** On macOS only INT8 is supported; on Windows/Linux both FP8 and INT8 are available. */
const availableQuantOptions = QUANT_OPTIONS.filter((q) => !isMac || q !== 'fp8w8a8')

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
    <SettingsRow label={props.label} hint={props.warning}>
      {props.fixedLabel !== undefined ? (
        <SettingsKeybind value={props.fixedLabel} disabled />
      ) : (
        <SettingsKeybind value={props.value} onChange={props.onChange} />
      )}
    </SettingsRow>
  )
}

type MenuSettingsViewProps = {
  onBack: () => void
  wide?: boolean
}

const MenuSettingsView = ({ onBack, wide }: MenuSettingsViewProps) => {
  const { t } = useTranslation()
  const { settings, saveSettings } = useSettings()
  const {
    engineStatus,
    checkEngineStatus,
    setupEngine,
    nukeAndReinstallEngine,
    isStreaming,
    mouseSensitivity,
    setMouseSensitivity
  } = useStreaming()
  const volume = useVolumeControls()

  const streamingToMenu = (v: number) => Math.round(10 + ((v - 0.1) * 90) / 2.9)

  const configEngineMode = settings.engine_mode
  const configWorldModel = settings.engine_model

  const [menuLocale, setMenuLocale] = useState<AppLocale>(settings.locale)
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

  const [menuQuant, setMenuQuant] = useState<QuantOption>(settings.engine_quant ?? 'none')
  const [menuCapInferenceFps, setMenuCapInferenceFps] = useState(() => settings.cap_inference_fps ?? true)
  const [menuKeybindings, setMenuKeybindings] = useState<Keybindings>(() => ({ ...settings.keybindings }))
  const [menuSceneEditEnabled, setMenuSceneEditEnabled] = useState(
    () => settings.experimental?.scene_edit_enabled ?? false
  )
  const [menuPerformanceStats, setMenuPerformanceStats] = useState(() => settings.debug_overlays.performance_stats)
  const [menuInputOverlay, setMenuInputOverlay] = useState(() => settings.debug_overlays.input)
  const [menuFrameTimeline, setMenuFrameTimeline] = useState(() => settings.debug_overlays.frame_timeline)
  const [menuActionLogging, setMenuActionLogging] = useState(() => settings.debug_overlays.action_logging)
  const [menuVideoRecording, setMenuVideoRecording] = useState(() => settings.debug_overlays.video_recording)

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

  useEffect(() => {
    if (menuEngineMode === 'standalone') {
      checkEngineStatus().catch(() => null)
    }
  }, [menuEngineMode, checkEngineStatus])

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
    void validate()
    return () => {
      cancelled = true
    }
  }, [menuEngineMode, menuServerUrl])

  const serverUrlForModels = menuEngineMode === 'server' ? menuServerUrl : undefined
  const savedCustomModels = settings.custom_models ?? []
  useEffect(() => {
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
        setMenuModelsError(t('app.settings.worldModel.couldNotLoadModelList'))
      } finally {
        if (!cancelled) {
          setMenuModelsLoading(false)
        }
      }
    }

    void loadMenuModels()

    return () => {
      cancelled = true
    }
  }, [menuWorldModel, menuEngineMode, serverUrlForModels, serverUrlStatus, savedCustomModels, t])

  useEffect(() => {
    setMenuLocale(settings.locale)
    setMenuEngineMode(configEngineMode === ENGINE_MODES.SERVER ? 'server' : 'standalone')
    setMenuWorldModel(configWorldModel)
    setMenuMouseSensitivity(streamingToMenu(settings.mouse_sensitivity ?? mouseSensitivity))
    setMenuServerUrl(configServerUrl)
    setMenuQuant(settings.engine_quant ?? 'none')
    setMenuKeybindings({ ...settings.keybindings })
    setMenuSceneEditEnabled(settings.experimental?.scene_edit_enabled ?? false)
    setMenuPerformanceStats(settings.debug_overlays.performance_stats)
    setMenuInputOverlay(settings.debug_overlays.input)
    setMenuFrameTimeline(settings.debug_overlays.frame_timeline)
    setMenuActionLogging(settings.debug_overlays.action_logging)
    setMenuVideoRecording(settings.debug_overlays.video_recording)
  }, [
    settings.locale,
    configEngineMode,
    configWorldModel,
    settings.mouse_sensitivity,
    mouseSensitivity,
    configServerUrl,
    settings.keybindings,
    settings.debug_overlays.performance_stats,
    settings.debug_overlays.input,
    settings.debug_overlays.frame_timeline,
    settings.debug_overlays.action_logging,
    settings.debug_overlays.video_recording
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
  }, [menuServerUrl, lastValidatedServerUrl, serverUrlStatus])

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
          setCustomModelStatus({ state: 'error', error: info.error ?? t('app.settings.worldModel.modelNotFound') })
        } else if (info?.error) {
          setCustomModelStatus({ state: 'error', error: info.error })
        } else {
          setCustomModelStatus({ state: 'idle', error: null })
          setMenuModelOptions((prev) => [...prev, { id: modelId, isLocal: null, sizeBytes: info?.size_bytes ?? null }])
          if (!savedCustomModels.includes(modelId)) {
            void saveSettings({ ...settings, custom_models: [...savedCustomModels, modelId] })
          }
        }
      } catch {
        setCustomModelStatus({ state: 'error', error: t('app.settings.worldModel.couldNotCheckModel') })
      }
    },
    [menuModelOptions, serverUrlForModels, savedCustomModels, settings, saveSettings, t]
  )

  const handleDeleteCustomModel = useCallback(
    (modelId: string) => {
      const updated = savedCustomModels.filter((m) => m !== modelId)
      void saveSettings({ ...settings, custom_models: updated })
      setMenuModelOptions((prev) => prev.filter((m) => m.id !== modelId))
      if (menuWorldModel === modelId) {
        const fallback = menuModelOptions.find((m) => m.id !== modelId)?.id ?? settings.engine_model
        setMenuWorldModel(fallback)
      }
    },
    [savedCustomModels, settings, saveSettings, menuModelOptions, menuWorldModel]
  )

  const handleLocaleChange = useCallback(
    (locale: AppLocale) => {
      setMenuLocale(locale)
      void saveSettings({ ...settings, locale })
    },
    [settings, saveSettings]
  )

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
      locale: menuLocale,
      server_url: nextServerUrl,
      engine_mode: engineModeValue,
      engine_model: menuWorldModel,
      engine_quant: menuQuant,
      cap_inference_fps: menuCapInferenceFps,
      mouse_sensitivity: streamingValue,
      keybindings: menuKeybindings,
      audio: volume.getAudioSettings(),
      experimental: {
        scene_edit_enabled: menuSceneEditEnabled
      },
      debug_overlays: {
        performance_stats: menuPerformanceStats,
        input: menuInputOverlay,
        frame_timeline: menuFrameTimeline,
        action_logging: menuActionLogging,
        video_recording: menuVideoRecording
      }
    })
    setMouseSensitivity(streamingValue)
  }, [
    settings,
    menuLocale,
    configServerUrl,
    menuEngineMode,
    menuMouseSensitivity,
    menuServerUrl,
    menuWorldModel,
    menuQuant,
    menuCapInferenceFps,
    menuKeybindings,
    menuSceneEditEnabled,
    menuPerformanceStats,
    menuInputOverlay,
    menuFrameTimeline,
    menuActionLogging,
    menuVideoRecording,
    volume.getAudioSettings,
    saveSettings,
    setMouseSensitivity
  ])

  const hasEngineModeChanged = menuEngineMode !== (configEngineMode === ENGINE_MODES.SERVER ? 'server' : 'standalone')
  const hasWorldModelChanged = menuWorldModel !== configWorldModel
  const hasQuantChanged = menuQuant !== (settings.engine_quant ?? 'none')

  const handleBackClick = useCallback(async () => {
    if (menuEngineMode === 'server' && (!menuServerUrl.trim() || serverUrlStatus !== 'valid')) {
      setShowServerErrorModal(true)
      return
    }
    if (isStreaming && (hasEngineModeChanged || hasWorldModelChanged || hasQuantChanged)) {
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
        <h2 className={`${HEADING_BASE} text-heading text-text-primary font-normal text-left`}>
          {t('app.settings.title')}
        </h2>
        <p className="m-0 font-serif text-caption text-text-muted max-w-[103.12cqh] text-left">
          {t('app.settings.subtitle')}
        </p>
        <div
          className={`styled-scrollbar overflow-y-auto pr-[0.8cqh] pb-[1.0cqh] max-h-[62cqh] mt-[1.1cqh] relative z-[4] flex flex-col gap-[2.3cqh] ${wide ? 'w-[83%]' : 'w-[63%]'}`}
        >
          <SettingsSection title="app.settings.engineMode.title" description="app.settings.engineMode.description">
            <SettingsToggle
              options={[
                { value: 'standalone', label: 'app.settings.engineMode.standalone' },
                { value: 'server', label: 'app.settings.engineMode.server' }
              ]}
              value={menuEngineMode}
              onChange={(v) => handleEngineModeChange(v as 'server' | 'standalone')}
            />
          </SettingsSection>

          {menuEngineMode === 'server' && (
            <SettingsSection
              title="app.settings.serverUrl.title"
              rawDescription={
                <span className="inline-flex items-center gap-[0.71cqh] flex-wrap">
                  {t('app.settings.serverUrl.descriptionPrefix')} ·{' '}
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
                    {t('app.settings.serverUrl.setupInstructions')}
                  </a>
                  {serverUrlStatus === 'loading' && ` · ${t('app.settings.serverUrl.checking')}`}
                  {serverUrlStatus === 'valid' && (
                    <>
                      {` · ${t('app.settings.serverUrl.connected')}`}
                      <span className="inline-block w-[0.98cqh] h-[0.98cqh] rounded-full bg-[rgba(100,220,100,0.95)] shadow-[0_0_5px_1px_rgba(100,220,100,0.4)]" />
                    </>
                  )}
                  {serverUrlStatus === 'error' && (
                    <>
                      {` · ${t('app.settings.serverUrl.unreachable')}`}
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
                placeholder="app.settings.serverUrl.placeholder"
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

          <SettingsSection title="app.settings.worldModel.title" description="app.settings.worldModel.description">
            <SettingsSelect
              options={menuModelOptions.map((model) => ({
                value: model.id,
                rawLabel: model.id.replace(/^Overworld\//, ''),
                prefix: [
                  model.sizeBytes != null ? formatBytes(model.sizeBytes) : null,
                  model.isLocal === true
                    ? t('app.settings.worldModel.local')
                    : model.isLocal === false
                      ? t('app.settings.worldModel.download')
                      : null
                ]
                  .filter(Boolean)
                  .join(' · '),
                deletable: savedCustomModels.includes(model.id)
              }))}
              value={menuWorldModel}
              onChange={handleWorldModelChange}
              onDelete={handleDeleteCustomModel}
              disabled={menuModelsLoading || (menuEngineMode === 'server' && serverUrlStatus !== 'valid')}
              allowCustom
              onCustomBlur={handleCustomModelBlur}
              customLabel="app.settings.worldModel.custom"
              deleteLabel="app.settings.worldModel.removeCustomModel"
              rawCustomPrefix={
                customModelStatus.state === 'loading'
                  ? t('app.settings.worldModel.checking')
                  : customModelStatus.state === 'error'
                    ? (customModelStatus.error ?? t('app.settings.worldModel.modelNotFound'))
                    : undefined
              }
            />
            {menuModelsError && (
              <p className={`${SETTINGS_MUTED_TEXT} text-left [margin:0.35cqh_0_0.8cqh]`}>{menuModelsError}</p>
            )}
          </SettingsSection>

          <SettingsSection title="app.settings.performance.title" description="app.settings.performance.description">
            <div className="flex flex-col gap-[1cqh]">
              <SettingsRow
                label={t('app.settings.performance.quantization')}
                hint={t('app.settings.performance.quantizationDescription')}
              >
                <SettingsSelect
                  options={availableQuantOptions.map((q) => ({
                    value: q,
                    label: `app.settings.quantization.${q}` as const
                  }))}
                  value={menuQuant}
                  onChange={(v) => setMenuQuant(v as QuantOption)}
                />
              </SettingsRow>
              <SettingsCheckbox
                label="app.settings.performance.capInferenceFps"
                description="app.settings.performance.capInferenceFpsDescription"
                checked={menuCapInferenceFps}
                onChange={setMenuCapInferenceFps}
              />
            </div>
          </SettingsSection>

          <SettingsSection title="app.settings.language.title" description="app.settings.language.description">
            <SettingsSelect
              options={[
                { value: 'system', label: 'app.settings.language.system' },
                ...SUPPORTED_LOCALES.map((locale) => ({
                  value: locale,
                  rawLabel: LOCALE_DISPLAY_NAMES[locale]
                }))
              ]}
              value={menuLocale}
              onChange={(value) => handleLocaleChange(value as AppLocale)}
            />
          </SettingsSection>

          <SettingsSection title="app.settings.volume.title" description="app.settings.volume.description">
            <div className="flex flex-col gap-[1.5cqh]">
              <SettingsSlider
                min={0}
                max={100}
                value={volume.master}
                onChange={volume.setMaster}
                label="app.settings.volume.master"
                suffix={`${volume.master}%`}
              />
              <SettingsSlider
                min={0}
                max={100}
                value={volume.sfx}
                onChange={volume.setSfx}
                label="app.settings.volume.soundEffects"
                suffix={`${volume.sfx}%`}
              />
              <SettingsSlider
                min={0}
                max={100}
                value={volume.music}
                onChange={volume.setMusic}
                label="app.settings.volume.music"
                suffix={`${volume.music}%`}
              />
            </div>
          </SettingsSection>

          <SettingsSection
            title="app.settings.mouseSensitivity.title"
            description="app.settings.mouseSensitivity.description"
          >
            <SettingsSlider
              min={10}
              max={100}
              value={menuMouseSensitivity}
              onChange={setMenuMouseSensitivity}
              label="app.settings.mouseSensitivity.sensitivity"
              suffix={`${menuMouseSensitivity}%`}
            />
          </SettingsSection>

          <SettingsSection title="app.settings.keybindings.title" description="app.settings.keybindings.description">
            <KeybindRow
              label={t('app.settings.keybindings.resetScene')}
              value={menuKeybindings.reset_scene}
              onChange={(code) => setMenuKeybindings((prev) => ({ ...prev, reset_scene: code }))}
              warning={getKeybindConflict(menuKeybindings.reset_scene, [menuKeybindings.scene_edit])}
            />
            {menuSceneEditEnabled && (
              <KeybindRow
                label={t('app.settings.keybindings.sceneEdit')}
                value={menuKeybindings.scene_edit}
                onChange={(code) => setMenuKeybindings((prev) => ({ ...prev, scene_edit: code }))}
                warning={getKeybindConflict(menuKeybindings.scene_edit, [menuKeybindings.reset_scene])}
              />
            )}
          </SettingsSection>

          <SettingsSection
            title="app.settings.fixedControls.title"
            description="app.settings.fixedControls.description"
          >
            {FIXED_CONTROLS.map((ctrl) => (
              <KeybindRow key={ctrl.label} label={fixedControlLabel(ctrl)} fixedLabel={fixedControlDisplay(ctrl)} />
            ))}
          </SettingsSection>

          <SettingsSection title="app.settings.experimental.title" description="app.settings.experimental.description">
            <SettingsCheckbox
              label="app.settings.experimental.sceneEdit"
              description="app.settings.experimental.sceneEditDescription"
              checked={menuSceneEditEnabled}
              onChange={setMenuSceneEditEnabled}
            />
          </SettingsSection>

          <SettingsSection title="app.settings.debugMetrics.title" description="app.settings.debugMetrics.description">
            <div className="flex flex-col gap-[1cqh]">
              <SettingsCheckbox
                label="app.settings.debugMetrics.performanceStats"
                description="app.settings.debugMetrics.performanceStatsDescription"
                checked={menuPerformanceStats}
                onChange={setMenuPerformanceStats}
              />
              <SettingsCheckbox
                label="app.settings.debugMetrics.inputOverlay"
                description="app.settings.debugMetrics.inputOverlayDescription"
                checked={menuInputOverlay}
                onChange={setMenuInputOverlay}
              />
              <SettingsCheckbox
                label="app.settings.debugMetrics.frameTimeline"
                description="app.settings.debugMetrics.frameTimelineDescription"
                checked={menuFrameTimeline}
                onChange={setMenuFrameTimeline}
              />
              <SettingsCheckbox
                label="app.settings.debugMetrics.actionLogging"
                description="app.settings.debugMetrics.actionLoggingDescription"
                checked={menuActionLogging}
                onChange={setMenuActionLogging}
              />
              <SettingsCheckbox
                label="app.settings.debugMetrics.videoRecording"
                description="app.settings.debugMetrics.videoRecordingDescription"
                checked={menuVideoRecording}
                onChange={setMenuVideoRecording}
              />
            </div>
          </SettingsSection>
        </div>
      </section>

      <div className="absolute right-[var(--edge-right)] bottom-[var(--edge-bottom)] z-[5] w-btn-w flex flex-col gap-[1.1cqh]">
        <MenuButton
          variant="secondary"
          label="app.buttons.credits"
          className="w-full px-0"
          onClick={() => setShowCredits(true)}
        />
        <MenuButton
          variant="primary"
          label="app.buttons.back"
          className="w-full px-0"
          onClick={() => {
            void handleBackClick()
          }}
        />
      </div>

      {showFixModal && (
        <ConfirmModal
          title="app.dialogs.fixInPlace.title"
          description="app.dialogs.fixInPlace.description"
          onCancel={() => setShowFixModal(false)}
          onConfirm={() => void handleConfirmFixEngine()}
          confirmLabel="app.buttons.fix"
        />
      )}

      {showNukeModal && (
        <ConfirmModal
          title="app.dialogs.totalReinstall.title"
          description="app.dialogs.totalReinstall.description"
          onCancel={() => setShowNukeModal(false)}
          onConfirm={() => void handleConfirmNukeEngine()}
          confirmLabel="app.buttons.reinstallEverything"
        />
      )}

      {showModeSwitchModal && (
        <ConfirmModal
          title="app.dialogs.applyEngineChanges.title"
          description="app.dialogs.applyEngineChanges.description"
          onCancel={() => setShowModeSwitchModal(false)}
          onConfirm={() => {
            void handleConfirmEngineModeSwitch()
          }}
          confirmLabel="app.buttons.switchMode"
          cancelLabel="app.buttons.keepCurrent"
        />
      )}

      {showServerErrorModal && (
        <ConfirmModal
          title="app.dialogs.serverUnreachable.title"
          description={
            !menuServerUrl.trim()
              ? 'app.dialogs.serverUnreachable.noUrl'
              : serverUrlUsesSecureTransport
                ? 'app.dialogs.serverUnreachable.withUrlSecure'
                : 'app.dialogs.serverUnreachable.withUrl'
          }
          descriptionParams={{ url: menuServerUrl }}
          onConfirm={() => setShowServerErrorModal(false)}
          onCancel={() => {
            setShowServerErrorModal(false)
            setMenuServerUrl(configServerUrl)
            setServerUrlStatus('idle')
          }}
          confirmLabel="app.buttons.editUrl"
          cancelLabel="app.buttons.revert"
        />
      )}

      {showLocalInstallLog && <EngineInstallModal onClose={() => setShowLocalInstallLog(false)} />}

      {showCredits && (
        <Modal title="app.settings.credits.title" onBackdropClick={() => setShowCredits(false)}>
          <pre className="m-0 mt-[0.8cqh] font-mono text-[1.8cqh] text-text-modal-muted whitespace-pre-wrap border border-border-subtle bg-white/5 p-[1.2cqh] rounded-[0.4cqh]">
            {attributionText.trim()}
          </pre>
          <div className="flex justify-end mt-[1.4cqh]">
            <Button
              variant="primary"
              autoShrinkLabel
              label="app.buttons.close"
              className="p-[0.5cqh_1.78cqh] text-[2.49cqh]"
              onClick={() => setShowCredits(false)}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}

export default MenuSettingsView
