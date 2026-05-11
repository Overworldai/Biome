import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '../../bridge'
import { SETTINGS_MUTED_TEXT } from '../../styles'
import { ENGINE_MODES, QUANT_OPTIONS, type QuantOption, type Settings } from '../../types/settings'
import type { TranslationKey } from '../../i18n'
import { useEngineLifecycle, type LifecycleState } from '../../context/engineLifecycle/engineLifecycleContextValue'
import { useConnection } from '../../context/streaming/connection'
import { normalizeServerUrl, toHealthUrl } from '../../utils/serverUrl'
import SettingsSection from '../ui/SettingsSection'
import SettingsToggle from '../ui/SettingsToggle'
import SettingsSelect from '../ui/SettingsSelect'
import SettingsTextInput from '../ui/SettingsTextInput'
import SettingsCheckbox from '../ui/SettingsCheckbox'
import SettingsRow from '../ui/SettingsRow'
import ConfirmModal from '../ui/ConfirmModal'
import WorldEngineSection from '../engine/WorldEngineSection'
import EngineInstallModal from '../engine/EngineInstallModal'

type MenuModelOption = {
  id: string
  isLocal: boolean
  sizeBytes: number | null
}

/** Outcome of the server-URL validation probe. `error` covers
 *  unreachable / 4xx / 5xx; `ownManaged` is the special case where the
 *  URL resolves to *this* Biome's local managed standalone server —
 *  saving server-mode with that URL would teardown the server during
 *  the mode switch and immediately disconnect the user. */
type ServerUrlStatus = 'idle' | 'loading' | 'valid' | 'error' | 'ownManaged'

const isMac = navigator.platform.startsWith('Mac')
/** On macOS only INT8 is supported; on Windows/Linux both FP8 and INT8 are available. */
const availableQuantOptions = QUANT_OPTIONS.filter((q) => !isMac || q !== 'fp8w8a8')

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** Tooltip explaining why a standalone-mode-gated control is disabled.
 *  Mirrors the lifecycle's terminal-vs-transient states so the user
 *  knows whether to wait, fix, or install. Returns undefined for
 *  `ready` since enabled controls don't need a tooltip. */
const standaloneTooltip = (kind: LifecycleState['kind']): TranslationKey | undefined => {
  switch (kind) {
    case 'not_installed':
      return 'app.settings.worldEngine.notInstalledTooltip'
    case 'preparing':
      return 'app.settings.worldEngine.startingTooltip'
    case 'failed':
      return 'app.settings.worldEngine.failedTooltip'
    case 'ready':
      return undefined
  }
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
  const lifecycle = useEngineLifecycle()
  const { isStreaming } = useConnection()
  const checkEngine = lifecycle.check
  const engineReady = lifecycle.state.kind === 'ready'

  const configEngineMode = settings.engine_mode
  const configWorldModel = settings.engine_model
  const configServerUrl = settings.server_url

  const [menuServerUrl, setMenuServerUrl] = useState(configServerUrl)
  const [menuWorldModel, setMenuWorldModel] = useState(configWorldModel)
  const [menuQuant, setMenuQuant] = useState<QuantOption>(settings.engine_quant ?? 'none')
  const [menuCapInferenceFps, setMenuCapInferenceFps] = useState(() => settings.cap_inference_fps ?? true)

  const [menuModelOptions, setMenuModelOptions] = useState<MenuModelOption[]>([
    { id: configWorldModel, isLocal: false, sizeBytes: null }
  ])
  const [menuModelsLoading, setMenuModelsLoading] = useState(false)
  const [menuModelsError, setMenuModelsError] = useState<string | null>(null)

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
      checkEngine().catch(() => null)
    }
  }, [menuEngineMode, checkEngine])

  // Speculatively drive the engine lifecycle from the menu's draft toggle so
  // the model picker has a working server to query before the user clicks
  // Save. Skipped while streaming — flipping the toggle mid-session would
  // tear down the active engine; the existing restart-confirm modal in
  // MenuSettingsView still gates that case at save-time.
  const setDraftStandalone = lifecycle.setDraftStandalone
  useEffect(() => {
    if (isStreaming) return
    setDraftStandalone(menuEngineMode === 'standalone')
  }, [menuEngineMode, isStreaming, setDraftStandalone])

  // Clear the override on unmount so the lifecycle reverts to the saved
  // setting — handles the back-out-without-saving path. Separated from the
  // sync-effect above so toggling within the menu doesn't briefly null the
  // override between cleanup and re-set.
  useEffect(
    () => () => {
      setDraftStandalone(null)
    },
    [setDraftStandalone]
  )

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
        const identity = await invoke('probe-server-health', toHealthUrl(normalizedUrl), 5000)
        if (cancelled) return
        if (!identity.reachable) {
          setServerUrlStatus('error')
        } else if (identity.launched_from_standalone) {
          setServerUrlStatus('ownManaged')
        } else {
          setServerUrlStatus('valid')
          setLastValidatedServerUrl(normalizedUrl)
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
    // In standalone mode the metadata calls hit the local managed server,
    // so they only succeed once the engine is up. While preparing /
    // not_installed / failed, fall back to a single-default placeholder
    // so the picker isn't empty; this effect re-fires on the engineReady
    // transition and refetches when the server comes online (e.g. after
    // an Install click finishes).
    if (menuEngineMode === 'standalone' && !engineReady) {
      setMenuModelOptions([{ id: menuWorldModel, isLocal: false, sizeBytes: null }])
      setMenuModelsLoading(false)
      return
    }

    let cancelled = false

    const loadMenuModels = async () => {
      setMenuModelsLoading(true)
      setMenuModelsError(null)
      try {
        const models = await invoke('list-models', serverUrlForModels)
        if (cancelled) return

        // Pin the currently-selected model into the list even if the
        // server doesn't report it (e.g. user has a stale config from
        // before the model was retired from the Waypoint collection and
        // they've since cleared their cache). Without this the picker
        // would render with no selected option.
        const haveSelected = models.some((m) => m.id === menuWorldModel)
        const options: MenuModelOption[] = models.map((m) => ({
          id: m.id,
          isLocal: m.is_local,
          sizeBytes: m.size_bytes
        }))
        if (!haveSelected && menuWorldModel.trim()) {
          options.unshift({ id: menuWorldModel, isLocal: false, sizeBytes: null })
        }
        setMenuModelOptions(options)
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
  }, [menuWorldModel, menuEngineMode, serverUrlForModels, serverUrlStatus, t, engineReady])

  const handleEngineModeChange = (mode: 'server' | 'standalone') => {
    setMenuEngineMode(mode)
    setServerUrlStatus('idle')
    setLastValidatedServerUrl('')
  }

  const handleWorldModelChange = (model: string) => {
    setMenuWorldModel(model.trim())
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
      const identity = await invoke('probe-server-health', toHealthUrl(normalizedUrl), 5000)
      if (!identity.reachable) {
        setServerUrlStatus('error')
        setShowServerErrorModal(true)
      } else if (identity.launched_from_standalone) {
        setServerUrlStatus('ownManaged')
        setShowServerErrorModal(true)
      } else {
        setServerUrlStatus('valid')
        setLastValidatedServerUrl(normalizedUrl)
      }
    } catch {
      setServerUrlStatus('error')
      setShowServerErrorModal(true)
    }
  }, [menuServerUrl, lastValidatedServerUrl, serverUrlStatus])

  const handleConfirmDeleteCache = useCallback(async () => {
    if (!showDeleteCacheModal) return
    const modelId = showDeleteCacheModal
    setShowDeleteCacheModal(null)
    await invoke('delete-cached-model', modelId, serverUrlForModels)
    // The next list-models refetch will re-classify the row as not_local.
    // Update locally first so the UI reflects the action immediately.
    setMenuModelOptions((prev) => prev.map((m) => (m.id === modelId ? { ...m, isLocal: false } : m)))
  }, [showDeleteCacheModal, serverUrlForModels])

  // `reinstallEngine` orchestrates stop → install → start as one unit.
  // The modal stays open across the whole pipeline — including the
  // terminal `ready` state — so the user sees the green "Complete." dot
  // and dismisses on their own. The "view logs" affordance on
  // WorldEngineSection opens the same modal mid-flight, so closing on
  // `ready` would race with anyone who tabbed away and came back to
  // check status.
  const runReinstall = async (mode: 'fix' | 'nuke') => {
    setShowLocalInstallLog(true)
    await lifecycle.reinstallEngine(mode)
  }

  const handleConfirmFixEngine = async () => {
    setShowFixModal(false)
    await runReinstall('fix')
  }

  const handleConfirmNukeEngine = async () => {
    setShowNukeModal(false)
    await runReinstall('nuke')
  }

  // First-time install (and recovery from `failed`) goes through the same
  // pipeline; `reinstallEngine('fix')` is identical to a fresh install
  // when there's nothing to nuke.
  const handleInstallEngine = () => runReinstall('fix')

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
              {(serverUrlStatus === 'error' || serverUrlStatus === 'ownManaged') && (
                <>
                  {` · ${t(
                    serverUrlStatus === 'ownManaged'
                      ? 'app.settings.serverUrl.ownManaged'
                      : 'app.settings.serverUrl.unreachable'
                  )}`}
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
          onFixInPlaceClick={() => setShowFixModal(true)}
          onTotalReinstallClick={() => setShowNukeModal(true)}
          onInstallClick={() => void handleInstallEngine()}
          onViewStartupLogsClick={() => setShowLocalInstallLog(true)}
        />
      )}

      <SettingsSection title="app.settings.worldModel.title" description="app.settings.worldModel.description">
        <SettingsSelect
          options={menuModelOptions.map((model) => ({
            value: model.id,
            rawLabel: model.id.replace(/^Overworld\//, ''),
            prefix: [
              model.sizeBytes != null ? formatBytes(model.sizeBytes) : null,
              model.isLocal ? null : t('app.settings.worldModel.download')
            ]
              .filter(Boolean)
              .join(' · '),
            cacheDeletable: model.isLocal,
            dimmed: !model.isLocal
          }))}
          value={menuWorldModel}
          onChange={handleWorldModelChange}
          onCacheDelete={(modelId) => setShowDeleteCacheModal(modelId)}
          hideSelectedInDropdown
          disabled={
            menuModelsLoading ||
            (menuEngineMode === 'standalone' && !engineReady) ||
            (menuEngineMode === 'server' && serverUrlStatus !== 'valid')
          }
          disabledTooltip={
            menuEngineMode === 'standalone' && !engineReady ? standaloneTooltip(lifecycle.state.kind) : undefined
          }
          cacheDeleteLabel="app.settings.worldModel.deleteLocalCache"
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
              disabled={menuEngineMode === 'standalone' && !engineReady}
              disabledTooltip={
                menuEngineMode === 'standalone' && !engineReady ? standaloneTooltip(lifecycle.state.kind) : undefined
              }
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
          title={
            serverUrlStatus === 'ownManaged'
              ? 'app.dialogs.serverOwnManaged.title'
              : 'app.dialogs.serverUnreachable.title'
          }
          description={
            serverUrlStatus === 'ownManaged'
              ? 'app.dialogs.serverOwnManaged.description'
              : !menuServerUrl.trim()
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
