import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '../../bridge'
import { SETTINGS_MUTED_TEXT } from '../../styles'
import { ENGINE_MODES, localhostUrl, type EngineBackend, type QuantOption, type Settings } from '../../types/settings'
import type { TranslationKey } from '../../i18n'
import { useEngineLifecycle, type LifecycleState } from '../../context/engineLifecycle/engineLifecycleContextValue'
import { useConnection } from '../../context/streaming/connection'
import { useSettings } from '../../hooks/settings/settingsContextValue'
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
  /** `null` means "unknown" — used for freshly-typed custom rows
   *  between blur-validation completing and the next picker open.
   *  Picker treats unknown as not-cached for cache-delete affordance
   *  purposes while keeping the row visually neutral (no download
   *  badge either). */
  isLocal: boolean | null
  sizeBytes: number | null
}

/** Outcome of the server-URL validation probe. `error` covers
 *  unreachable / 4xx / 5xx; `ownManaged` is the special case where the
 *  URL resolves to *this* Biome's local managed standalone server —
 *  saving server-mode with that URL would teardown the server during
 *  the mode switch and immediately disconnect the user. */
type ServerUrlStatus = 'idle' | 'loading' | 'valid' | 'error' | 'ownManaged'

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
  const lifecycle = useEngineLifecycle()
  const { isStreaming, serverCapabilities, setServerCapabilities } = useConnection()
  const checkEngine = lifecycle.check
  const engineReady = lifecycle.state.kind === 'ready'

  const configWorldModel = settings.engine_model
  const configServerUrl = settings.server_url
  // User-curated extra HF repo ids. Stable identity matters here: every
  // dependent effect threads it through, and a fresh `?? []` literal
  // each render would retrigger the loader unnecessarily.
  const savedCustomModels = useMemo(() => settings.custom_models ?? [], [settings.custom_models])

  const [menuServerUrl, setMenuServerUrl] = useState(configServerUrl)
  const [menuWorldModel, setMenuWorldModel] = useState(configWorldModel)
  const [menuQuant, setMenuQuant] = useState<QuantOption>(settings.engine_quant ?? 'none')
  const [menuEngineBackend, setMenuEngineBackend] = useState<EngineBackend>(
    () => settings.engine_backend ?? 'world_engine'
  )
  const [menuCapInferenceFps, setMenuCapInferenceFps] = useState(() => settings.cap_inference_fps ?? true)

  // Effective option sets for the backend / quant dropdowns come straight
  // from the server-reported capabilities. Pre-probe the arrays are empty
  // and the dropdowns disable themselves — `PROTOCOL_VERSION` gating means
  // we never connect to a server that doesn't ship this field, and the
  // controls aren't actionable until a valid server lands anyway. The
  // quant set is keyed by the in-flight backend selection so the dropdown
  // reacts immediately when the user toggles between backends with
  // different quant support (e.g. CUDA quark excludes INT8 while CUDA
  // world_engine supports it).
  const effectiveBackendOptions = useMemo<EngineBackend[]>(
    () => (serverCapabilities ? [...serverCapabilities.backends] : []),
    [serverCapabilities]
  )

  const effectiveQuantOptions = useMemo<QuantOption[]>(
    () => [...(serverCapabilities?.quants[menuEngineBackend] ?? [])],
    [serverCapabilities, menuEngineBackend]
  )

  // Snap each dropdown to a valid value when its effective set changes —
  // covers initial probe (where the server may report a tighter set than
  // the saved value), engine-mode toggles (server vs standalone),
  // server-mode reconnects to a remote on a different platform, and
  // backend changes (when the new backend doesn't support the saved quant).
  useEffect(() => {
    if (effectiveBackendOptions.length > 0 && !effectiveBackendOptions.includes(menuEngineBackend)) {
      setMenuEngineBackend(effectiveBackendOptions[0])
    }
  }, [effectiveBackendOptions, menuEngineBackend])

  useEffect(() => {
    if (effectiveQuantOptions.length > 0 && !effectiveQuantOptions.includes(menuQuant)) {
      setMenuQuant(effectiveQuantOptions[0])
    }
  }, [effectiveQuantOptions, menuQuant])

  const [menuModelOptions, setMenuModelOptions] = useState<MenuModelOption[]>([
    { id: configWorldModel, isLocal: false, sizeBytes: null }
  ])
  const [menuModelsLoading, setMenuModelsLoading] = useState(false)
  const [menuModelsError, setMenuModelsError] = useState<string | null>(null)

  // Status of the in-flight HF validation for the custom-input text box
  // (the `Custom...` row in the model picker dropdown). `idle` is the
  // resting state — the picker treats the value as committed.
  // `loading` shows a "checking..." hint next to the typed id while
  // `get-models-info` runs; `error` surfaces the user-facing reason
  // (gated repo, not found, network) so a typo doesn't silently land
  // in `settings.custom_models`.
  const [customModelStatus, setCustomModelStatus] = useState<{
    state: 'idle' | 'loading' | 'error'
    error: string | null
  }>({ state: 'idle', error: null })

  const [serverUrlStatus, setServerUrlStatus] = useState<ServerUrlStatus>('idle')
  const [lastValidatedServerUrl, setLastValidatedServerUrl] = useState('')

  // True when `menuWorldModel` appears in the (backend-filtered) list
  // the server returned. False when the saved model is a wp-1 sitting
  // on a quark-only picker, or the user typed an id the server
  // doesn't recognise. The `loadMenuModels` effect maintains it; the
  // save-time guard reads it to refuse incompatible combos. Defaults
  // to true so the picker stays usable until the first list lands.
  const [menuWorldModelAvailable, setMenuWorldModelAvailable] = useState(true)

  const [showFixModal, setShowFixModal] = useState(false)
  const [showNukeModal, setShowNukeModal] = useState(false)
  const [showLocalInstallLog, setShowLocalInstallLog] = useState(false)
  const [showDeleteCacheModal, setShowDeleteCacheModal] = useState<string | null>(null)
  const [showServerErrorModal, setShowServerErrorModal] = useState(false)
  const [showIncompatibleModelModal, setShowIncompatibleModelModal] = useState(false)

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
          engine_backend: menuEngineBackend,
          engine_quant: menuQuant,
          cap_inference_fps: menuCapInferenceFps
        }
      },
      validateBeforeSave: () => {
        if (menuEngineMode === 'server' && (!menuServerUrl.trim() || serverUrlStatus !== 'valid')) {
          setShowServerErrorModal(true)
          return false
        }
        // The server filters `list-models` by the in-flight backend,
        // so a saved model that fell off the list is structurally
        // incompatible (most often: wp-1 model + quark backend).
        // Refuse the save and surface the modal — the user picks
        // a compatible model or flips backend before retrying.
        if (!menuWorldModelAvailable) {
          setShowIncompatibleModelModal(true)
          return false
        }
        return true
      }
    }),
    [
      menuEngineMode,
      menuServerUrl,
      menuWorldModel,
      menuQuant,
      menuEngineBackend,
      menuCapInferenceFps,
      menuWorldModelAvailable,
      serverUrlStatus,
      configServerUrl
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
        const result = await invoke('probe-server-health', toHealthUrl(normalizedUrl), 5000)
        if (cancelled) return
        if (!result.ok) {
          setServerUrlStatus('error')
        } else if (result.launched_from_standalone) {
          setServerUrlStatus('ownManaged')
        } else {
          setServerUrlStatus('valid')
          setLastValidatedServerUrl(normalizedUrl)
          setServerCapabilities(result.capabilities ?? null)
        }
      } catch {
        if (!cancelled) setServerUrlStatus('error')
      }
    }
    void validate()
    return () => {
      cancelled = true
    }
  }, [menuEngineMode, menuServerUrl, setServerCapabilities])

  // Standalone counterpart: probe the local managed server's `/health`
  // once the lifecycle reports it's up, so the backend / quant dropdowns
  // clamp to what the local platform actually supports as soon as the
  // user opens settings — without waiting for them to click Launch and
  // run the warm flow. The warm flow remains the canonical write site
  // when streaming starts; this is just an earlier population so the
  // settings UI reflects truth pre-launch.
  const standalonePort = lifecycle.status?.server_port ?? null
  useEffect(() => {
    if (menuEngineMode !== 'standalone') return
    if (!engineReady) return
    if (standalonePort === null) return

    let cancelled = false
    const probe = async () => {
      try {
        const result = await invoke('probe-server-health', toHealthUrl(localhostUrl(standalonePort)), 5000)
        if (cancelled || !result.ok) return
        setServerCapabilities(result.capabilities ?? null)
      } catch {
        // Non-fatal — leave existing capabilities (or fallback) in place.
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [menuEngineMode, engineReady, standalonePort, setServerCapabilities])

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
        const models = await invoke('list-models', serverUrlForModels, menuEngineBackend)
        if (cancelled) return

        // Saved custom models that the curated `/api/models` didn't
        // return need a separate metadata round-trip — they're either
        // outside the Waypoint collection (so `list-models` doesn't
        // know about them) or have a `model_type` the in-flight
        // backend filter dropped. Either way, the picker still has to
        // show them so the user can pick / manage them.
        const curatedIds = new Set(models.map((m) => m.id))
        const customIds = savedCustomModels.filter((id) => id.trim().length > 0 && !curatedIds.has(id))
        const customInfo = customIds.length ? await invoke('get-models-info', customIds, serverUrlForModels) : []
        if (cancelled) return

        const customOptions: MenuModelOption[] = customInfo.map((m) => ({
          id: m.id,
          isLocal: m.is_local,
          sizeBytes: m.size_bytes
        }))

        // Pin the currently-selected model into the list even if it
        // sits outside both the curated list and the saved custom set
        // (e.g. user has a stale config from before the model was
        // retired from the Waypoint collection and they've since
        // cleared their cache, or the saved model is incompatible
        // with the in-flight backend so the server filtered it out).
        // Without this the picker would render with no selected option.
        // The availability flag below lets the save-time guard
        // distinguish "pinned because incompatible / missing" from a
        // legitimate selection.
        const haveSelected =
          models.some((m) => m.id === menuWorldModel) || customOptions.some((m) => m.id === menuWorldModel)
        const curatedOptions: MenuModelOption[] = models.map((m) => ({
          id: m.id,
          isLocal: m.is_local,
          sizeBytes: m.size_bytes
        }))
        const options: MenuModelOption[] = [...curatedOptions, ...customOptions]
        if (!haveSelected && menuWorldModel.trim()) {
          options.unshift({ id: menuWorldModel, isLocal: false, sizeBytes: null })
        }
        setMenuModelOptions(options)
        setMenuWorldModelAvailable(haveSelected)
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
  }, [
    menuWorldModel,
    menuEngineMode,
    menuEngineBackend,
    serverUrlForModels,
    serverUrlStatus,
    savedCustomModels,
    t,
    engineReady
  ])

  const handleEngineModeChange = (mode: 'server' | 'standalone') => {
    setMenuEngineMode(mode)
    setServerUrlStatus('idle')
    setLastValidatedServerUrl('')
  }

  const handleWorldModelChange = (model: string) => {
    setMenuWorldModel(model.trim())
    setCustomModelStatus({ state: 'idle', error: null })
  }

  // Validate a user-typed custom model id against HuggingFace via the
  // active server's `/api/model-info`. On success, add the id to the
  // saved-customs list so it sticks around between settings opens; on
  // failure, surface the reason via `customModelStatus` so the picker
  // hint slot can show it. The committed id stays as `menuWorldModel`
  // either way — saving the menu with a transiently-broken custom id
  // is up to the user (the engine load will surface a clearer error
  // if it really won't load).
  //
  // The immediate save bundles `engine_model: modelId` alongside
  // `custom_models` so the two settings advance together — leaving
  // `engine_model` for the Back-click would let a mid-edit app crash
  // persist a custom id into the list without the corresponding
  // selection. Other pending menu fields (backend, quant) still wait
  // for Back; cleaning up that asymmetry is a separate refactor.
  const handleCustomModelBlur = useCallback(
    async (modelId: string) => {
      if (menuModelOptions.some((m) => m.id === modelId)) return
      setCustomModelStatus({ state: 'loading', error: null })
      try {
        const results = await invoke('get-models-info', [modelId], serverUrlForModels)
        const info = results[0]
        if (info && !info.exists) {
          setCustomModelStatus({ state: 'error', error: info.error ?? t('app.settings.worldModel.modelNotFound') })
        } else if (info?.error) {
          setCustomModelStatus({ state: 'error', error: info.error })
        } else {
          setCustomModelStatus({ state: 'idle', error: null })
          setMenuModelOptions((prev) => [
            ...prev,
            { id: modelId, isLocal: info?.is_local ?? null, sizeBytes: info?.size_bytes ?? null }
          ])
          const nextCustomModels = savedCustomModels.includes(modelId)
            ? savedCustomModels
            : [...savedCustomModels, modelId]
          void saveSettings({ ...settings, engine_model: modelId, custom_models: nextCustomModels })
        }
      } catch {
        setCustomModelStatus({ state: 'error', error: t('app.settings.worldModel.couldNotCheckModel') })
      }
    },
    [menuModelOptions, serverUrlForModels, savedCustomModels, settings, saveSettings, t]
  )

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
      const result = await invoke('probe-server-health', toHealthUrl(normalizedUrl), 5000)
      if (!result.ok) {
        setServerUrlStatus('error')
        setShowServerErrorModal(true)
      } else if (result.launched_from_standalone) {
        setServerUrlStatus('ownManaged')
        setShowServerErrorModal(true)
      } else {
        setServerUrlStatus('valid')
        setLastValidatedServerUrl(normalizedUrl)
        setServerCapabilities(result.capabilities ?? null)
      }
    } catch {
      setServerUrlStatus('error')
      setShowServerErrorModal(true)
    }
  }, [menuServerUrl, lastValidatedServerUrl, serverUrlStatus, setServerCapabilities])

  const handleConfirmDeleteCache = useCallback(async () => {
    if (!showDeleteCacheModal) return
    const modelId = showDeleteCacheModal
    setShowDeleteCacheModal(null)
    await invoke('delete-cached-model', modelId, serverUrlForModels)
    // The next list-models refetch will re-classify the row as not_local.
    // Update locally first so the UI reflects the action immediately.
    setMenuModelOptions((prev) => prev.map((m) => (m.id === modelId ? { ...m, isLocal: false } : m)))
  }, [showDeleteCacheModal, serverUrlForModels])

  /** Drop a user-added entry from `settings.custom_models`. Distinct
   *  from cache-delete (handled above) — the row disappears from the
   *  picker entirely once persisted. If the deleted entry is the
   *  current selection, fall back to whatever's left in the picker so
   *  the dropdown doesn't end up rendering an empty selection. */
  const handleRemoveCustomModel = useCallback(
    (modelId: string) => {
      const nextCustom = savedCustomModels.filter((m) => m !== modelId)
      void saveSettings({ ...settings, custom_models: nextCustom })
      setMenuModelOptions((prev) => prev.filter((m) => m.id !== modelId))
      if (menuWorldModel === modelId) {
        const fallback = menuModelOptions.find((m) => m.id !== modelId)?.id ?? settings.engine_model
        setMenuWorldModel(fallback)
        setCustomModelStatus({ state: 'idle', error: null })
      }
    },
    [savedCustomModels, settings, saveSettings, menuModelOptions, menuWorldModel]
  )

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

      <SettingsSection title="app.settings.simulation.title" description="app.settings.simulation.description">
        <div className="flex flex-col gap-[1cqh]">
          <SettingsRow
            label={t('app.settings.simulation.worldModel')}
            hint={t('app.settings.simulation.worldModelDescription')}
          >
            <SettingsSelect
              options={[...menuModelOptions]
                .sort((a, b) => {
                  // Cached rows up top so the user lands on actionable
                  // options first; custom (user-added) rows pushed
                  // below curated ones; ties resolve alphabetically so
                  // the picker is stable between renders.
                  const aLocal = a.isLocal === true
                  const bLocal = b.isLocal === true
                  if (aLocal !== bLocal) return aLocal ? -1 : 1
                  const aCustom = savedCustomModels.includes(a.id)
                  const bCustom = savedCustomModels.includes(b.id)
                  if (aCustom !== bCustom) return aCustom ? 1 : -1
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
                    // Cache-delete is meaningful only for downloaded
                    // models; `null` means "unknown" (freshly-validated
                    // custom row) — treat as not-yet-cached to avoid
                    // offering a delete we can't fulfil.
                    cacheDeletable: model.isLocal === true,
                    // Distinct "remove from list" affordance — only
                    // on user-added rows. Doesn't touch the on-disk
                    // cache (use cacheDelete for that).
                    deletable: isCustom,
                    dimmed: model.isLocal === false
                  }
                })}
              value={menuWorldModel}
              onChange={handleWorldModelChange}
              onCacheDelete={(modelId) => setShowDeleteCacheModal(modelId)}
              onDelete={handleRemoveCustomModel}
              hideSelectedInDropdown
              disabled={
                menuModelsLoading ||
                (menuEngineMode === 'standalone' && !engineReady) ||
                (menuEngineMode === 'server' && serverUrlStatus !== 'valid')
              }
              disabledTooltip={
                menuEngineMode === 'standalone' && !engineReady ? standaloneTooltip(lifecycle.state.kind) : undefined
              }
              allowCustom
              onCustomBlur={(modelId) => void handleCustomModelBlur(modelId)}
              customLabel="app.settings.worldModel.custom"
              rawCustomPrefix={
                customModelStatus.state === 'loading'
                  ? t('app.settings.worldModel.checking')
                  : customModelStatus.state === 'error'
                    ? (customModelStatus.error ?? t('app.settings.worldModel.modelNotFound'))
                    : undefined
              }
              deleteLabel="app.settings.worldModel.removeFromList"
              cacheDeleteLabel="app.settings.worldModel.deleteLocalCache"
            />
          </SettingsRow>
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
          <SettingsRow
            label={t('app.settings.simulation.backend')}
            hint={t('app.settings.simulation.backendDescription')}
          >
            <SettingsSelect
              options={effectiveBackendOptions.map((b) => ({
                value: b,
                label: `app.settings.engineBackend.${b}` as const
              }))}
              value={menuEngineBackend}
              onChange={(v) => setMenuEngineBackend(v as EngineBackend)}
              disabled={
                (menuEngineMode === 'standalone' && !engineReady) ||
                (menuEngineMode === 'server' && serverUrlStatus !== 'valid')
              }
              disabledTooltip={
                menuEngineMode === 'standalone' && !engineReady ? standaloneTooltip(lifecycle.state.kind) : undefined
              }
            />
          </SettingsRow>
        </div>
      </SettingsSection>

      <SettingsSection title="app.settings.performance.title" description="app.settings.performance.description">
        <div className="flex flex-col gap-[1cqh]">
          <SettingsRow
            label={t('app.settings.performance.quantization')}
            hint={t('app.settings.performance.quantizationDescription')}
          >
            <SettingsSelect
              options={effectiveQuantOptions.map((q) => ({
                value: q,
                label: `app.settings.quantization.${q}` as const
              }))}
              value={menuQuant}
              onChange={(v) => setMenuQuant(v as QuantOption)}
              disabled={
                (menuEngineMode === 'standalone' && !engineReady) ||
                (menuEngineMode === 'server' && serverUrlStatus !== 'valid')
              }
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

      {showIncompatibleModelModal && (
        <ConfirmModal
          title="app.dialogs.incompatibleModel.title"
          description="app.dialogs.incompatibleModel.description"
          onConfirm={() => setShowIncompatibleModelModal(false)}
          onCancel={() => setShowIncompatibleModelModal(false)}
          confirmLabel="app.buttons.back"
        />
      )}

      {showLocalInstallLog && <EngineInstallModal onClose={() => setShowLocalInstallLog(false)} />}
    </div>
  )
})

EngineTab.displayName = 'EngineTab'

export default EngineTab
