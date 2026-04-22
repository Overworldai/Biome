import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '../../bridge'
import { SETTINGS_MUTED_TEXT } from '../../styles'
import { ENGINE_MODES, QUANT_OPTIONS, type QuantOption, type Settings } from '../../types/settings'
import { useSettings } from '../../hooks/settingsContextValue'
import { useStreaming } from '../../context/streamingContextValue'
import { normalizeServerUrl, toHealthUrl } from '../../utils/serverUrl'
import SettingsSection from '../ui/SettingsSection'
import SettingsToggle from '../ui/SettingsToggle'
import SettingsSelect from '../ui/SettingsSelect'
import SettingsTextInput from '../ui/SettingsTextInput'
import SettingsCheckbox from '../ui/SettingsCheckbox'
import SettingsRow from '../ui/SettingsRow'
import ConfirmModal from '../ui/ConfirmModal'
import WorldEngineSection from '../WorldEngineSection'
import EngineInstallModal from '../EngineInstallModal'

type MenuModelOption = {
  id: string
  isLocal: boolean | null
  sizeBytes: number | null
}

type ServerUrlStatus = 'idle' | 'loading' | 'valid' | 'error'

const isMac = navigator.platform.startsWith('Mac')
/** On macOS only INT8 is supported; on Windows/Linux both FP8 and INT8 are available. */
const availableQuantOptions = QUANT_OPTIONS.filter((q) => !isMac || q !== 'fp8w8a8')

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export type EngineTabHandle = {
  collectDraft: () => Partial<Settings>
  /** Check whether the current draft is savable. If not, surfaces an error modal
   *  internally and returns false so the parent can abort the save flow. */
  validateBeforeSave: () => boolean
  /** True when engine-mode / world-model / quantization differ from persisted
   *  settings — parent uses this (alongside `isStreaming`) to decide whether a
   *  mid-session restart confirmation modal is needed. */
  hasChangesRequiringRestart: () => boolean
}

type EngineTabProps = {
  settings: Settings
  active: boolean
  menuEngineMode: 'server' | 'standalone'
  setMenuEngineMode: (mode: 'server' | 'standalone') => void
}

const EngineTab = forwardRef<EngineTabHandle, EngineTabProps>((props, ref) => {
  const { settings, active, menuEngineMode, setMenuEngineMode } = props
  const { t } = useTranslation()
  const { saveSettings } = useSettings()
  const { engineStatus, checkEngineStatus, setupEngine, nukeAndReinstallEngine } = useStreaming()

  const configEngineMode = settings.engine_mode
  const configWorldModel = settings.engine_model
  const configServerUrl = settings.server_url
  const savedCustomModels = useMemo(() => settings.custom_models ?? [], [settings.custom_models])

  const [menuServerUrl, setMenuServerUrl] = useState(configServerUrl)
  const [menuWorldModel, setMenuWorldModel] = useState(configWorldModel)
  const [menuQuant, setMenuQuant] = useState<QuantOption>(settings.engine_quant ?? 'none')
  const [menuCapInferenceFps, setMenuCapInferenceFps] = useState(() => settings.cap_inference_fps ?? true)

  const [menuModelOptions, setMenuModelOptions] = useState<MenuModelOption[]>([
    { id: configWorldModel, isLocal: false, sizeBytes: null }
  ])
  const [menuModelsLoading, setMenuModelsLoading] = useState(false)
  const [menuModelsError, setMenuModelsError] = useState<string | null>(null)
  const [customModelStatus, setCustomModelStatus] = useState<{
    state: 'idle' | 'loading' | 'error'
    error: string | null
  }>({ state: 'idle', error: null })

  const [serverUrlStatus, setServerUrlStatus] = useState<ServerUrlStatus>('idle')
  const [lastValidatedServerUrl, setLastValidatedServerUrl] = useState('')

  const [showFixModal, setShowFixModal] = useState(false)
  const [showNukeModal, setShowNukeModal] = useState(false)
  const [showLocalInstallLog, setShowLocalInstallLog] = useState(false)
  const [showDeleteCacheModal, setShowDeleteCacheModal] = useState<string | null>(null)
  const [showServerErrorModal, setShowServerErrorModal] = useState(false)

  const serverUrlUsesSecureTransport = /^\s*wss?:\/\//i.test(menuServerUrl)
    ? /^\s*wss:\/\//i.test(menuServerUrl)
    : /^\s*https:\/\//i.test(menuServerUrl)

  const engineReady = engineStatus
    ? engineStatus.uv_installed && engineStatus.repo_cloned && engineStatus.dependencies_synced
    : null

  useImperativeHandle(
    ref,
    () => ({
      collectDraft: () => {
        let nextServerUrl = menuServerUrl
        if (nextServerUrl.trim()) {
          try {
            normalizeServerUrl(nextServerUrl)
          } catch {
            nextServerUrl = configServerUrl
          }
        }
        return {
          engine_mode: menuEngineMode === 'server' ? ENGINE_MODES.SERVER : ENGINE_MODES.STANDALONE,
          server_url: nextServerUrl,
          engine_model: menuWorldModel,
          engine_quant: menuQuant,
          cap_inference_fps: menuCapInferenceFps
        }
      },
      validateBeforeSave: () => {
        if (menuEngineMode === 'server' && (!menuServerUrl.trim() || serverUrlStatus !== 'valid')) {
          setShowServerErrorModal(true)
          return false
        }
        return true
      },
      hasChangesRequiringRestart: () => {
        const configMode = configEngineMode === ENGINE_MODES.SERVER ? 'server' : 'standalone'
        if (menuEngineMode !== configMode) return true
        if (menuWorldModel !== configWorldModel) return true
        if (menuQuant !== (settings.engine_quant ?? 'none')) return true
        return false
      }
    }),
    [
      menuEngineMode,
      menuServerUrl,
      menuWorldModel,
      menuQuant,
      menuCapInferenceFps,
      serverUrlStatus,
      configEngineMode,
      configServerUrl,
      configWorldModel,
      settings.engine_quant
    ]
  )

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

  const handleEngineModeChange = (mode: 'server' | 'standalone') => {
    setMenuEngineMode(mode)
    setServerUrlStatus('idle')
    setLastValidatedServerUrl('')
  }

  const handleWorldModelChange = (model: string) => {
    setMenuWorldModel(model.trim())
    setCustomModelStatus({ state: 'idle', error: null })
  }

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

  const handleConfirmDeleteCache = useCallback(async () => {
    if (!showDeleteCacheModal) return
    const modelId = showDeleteCacheModal
    setShowDeleteCacheModal(null)
    await invoke('delete-cached-model', modelId)
    if (savedCustomModels.includes(modelId)) {
      // Custom model: remove from cache AND from custom list
      const updated = savedCustomModels.filter((m) => m !== modelId)
      void saveSettings({ ...settings, custom_models: updated })
      setMenuModelOptions((prev) => prev.filter((m) => m.id !== modelId))
      if (menuWorldModel === modelId) {
        const fallback = menuModelOptions.find((m) => m.id !== modelId)?.id ?? settings.engine_model
        setMenuWorldModel(fallback)
      }
    } else {
      // Default model: just update local status
      setMenuModelOptions((prev) => prev.map((m) => (m.id === modelId ? { ...m, isLocal: false } : m)))
    }
  }, [showDeleteCacheModal, savedCustomModels, settings, saveSettings, menuModelOptions, menuWorldModel])

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
    <div className={active ? 'flex flex-col gap-[2.3cqh]' : 'hidden'}>
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
            <span className="inline-flex flex-wrap items-center gap-[0.71cqh]">
              {t('app.settings.serverUrl.descriptionPrefix')} ·{' '}
              <a
                className="cursor-pointer text-inherit underline"
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
                  <span
                    className="
                      inline-block h-[0.98cqh] w-[0.98cqh] rounded-full bg-[rgba(100,220,100,0.95)]
                      shadow-[0_0_5px_1px_rgba(100,220,100,0.4)]
                    "
                  />
                </>
              )}
              {serverUrlStatus === 'error' && (
                <>
                  {` · ${t('app.settings.serverUrl.unreachable')}`}
                  <span
                    className="
                      inline-block h-[0.98cqh] w-[0.98cqh] rounded-full bg-[rgba(255,120,80,0.95)]
                      shadow-[0_0_5px_1px_rgba(255,120,80,0.4)]
                    "
                  />
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
          options={[...menuModelOptions]
            .filter((model) => !savedCustomModels.includes(model.id) || model.isLocal === true)
            .sort((a, b) => {
              // 1. Downloaded before undownloaded
              if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1
              // 2. Default models before custom
              if (savedCustomModels.includes(a.id) !== savedCustomModels.includes(b.id))
                return savedCustomModels.includes(a.id) ? 1 : -1
              // 3. Alphabetical
              return a.id.localeCompare(b.id)
            })
            .map((model) => {
              const isCustom = savedCustomModels.includes(model.id)
              return {
                value: model.id,
                rawLabel: model.id.replace(/^Overworld\//, ''),
                prefix: [
                  model.sizeBytes != null ? formatBytes(model.sizeBytes) : null,
                  model.isLocal === false ? t('app.settings.worldModel.download') : null
                ]
                  .filter(Boolean)
                  .join(' · '),
                deletable: isCustom && model.isLocal === true && menuEngineMode === 'standalone',
                cacheDeletable: !isCustom && model.isLocal === true && menuEngineMode === 'standalone',
                dimmed: model.isLocal === false
              }
            })}
          value={menuWorldModel}
          onChange={handleWorldModelChange}
          onDelete={(modelId) => setShowDeleteCacheModal(modelId)}
          onCacheDelete={(modelId) => setShowDeleteCacheModal(modelId)}
          hideSelectedInDropdown
          disabled={menuModelsLoading || (menuEngineMode === 'server' && serverUrlStatus !== 'valid')}
          allowCustom
          onCustomBlur={(modelId) => void handleCustomModelBlur(modelId)}
          customLabel="app.settings.worldModel.custom"
          deleteLabel="app.settings.worldModel.deleteLocalCache"
          cacheDeleteLabel="app.settings.worldModel.deleteLocalCache"
          rawCustomPrefix={
            customModelStatus.state === 'loading'
              ? t('app.settings.worldModel.checking')
              : customModelStatus.state === 'error'
                ? (customModelStatus.error ?? t('app.settings.worldModel.modelNotFound'))
                : undefined
          }
        />
        {menuModelsError && (
          <p
            className={`
              ${SETTINGS_MUTED_TEXT}
              m-[0.35cqh_0_0.8cqh] text-left
            `}
          >
            {menuModelsError}
          </p>
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

      {showDeleteCacheModal && (
        <ConfirmModal
          title="app.dialogs.deleteModelCache.title"
          description="app.dialogs.deleteModelCache.description"
          descriptionParams={{ modelId: showDeleteCacheModal }}
          descriptionComponents={{ bold: <span className="text-white" /> }}
          onCancel={() => setShowDeleteCacheModal(null)}
          onConfirm={() => void handleConfirmDeleteCache()}
          confirmLabel="app.buttons.delete"
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
    </div>
  )
})

EngineTab.displayName = 'EngineTab'

export default EngineTab
