import { useState, useEffect, type MouseEvent } from 'react'
import { usePortal } from '../context/PortalContext'
import { useStreaming } from '../context/StreamingContext'
import { useConfig, STANDALONE_PORT, ENGINE_MODES, DEFAULT_WORLD_ENGINE_MODEL } from '../hooks/useConfig'
import type { AppConfig, EngineMode, SetupStatus } from '../types/app'

// Tauri invoke helper
const invoke = async <T,>(cmd: string, args: Record<string, unknown> = {}): Promise<T> => {
  return window.__TAURI_INTERNALS__.invoke<T>(cmd, args)
}

type ModelOption = { id: string; isLocal: boolean; isCustom: boolean }

const normalizeModelInput = (input: string | null | undefined): string => {
  const raw = (input || '').trim()
  if (!raw) return ''

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const url = new URL(raw)
      const path = (url.pathname || '').replace(/^\/+|\/+$/g, '')
      if (!path) return ''
      const parts = path.split('/')
      if (parts.length >= 2 && parts[0] && parts[1]) {
        return `${parts[0]}/${parts[1]}`
      }
      return ''
    } catch {
      return ''
    }
  }

  return raw
}

const toUniqueModelIds = (modelIds: Array<string | null | undefined>): string[] => {
  return [...new Set((modelIds || []).map((id) => normalizeModelInput(id)).filter((id) => id && id.includes('/')))]
}

const SettingsPanel = () => {
  const { isSettingsOpen, toggleSettings } = usePortal()
  const { config, saveConfig, configPath, openConfig } = useConfig()
  const {
    engineStatus: status,
    engineSetupInProgress: engineLoading,
    engineSetupError: engineError,
    setupProgress,
    checkEngineStatus: checkStatus,
    setupEngine
  } = useStreaming()

  // Local state for form fields
  const [gpuServer, setGpuServer] = useState('')
  const [useSsl, setUseSsl] = useState(false)
  const [openaiKey, setOpenaiKey] = useState('')
  const [falKey, setFalKey] = useState('')
  const [huggingfaceKey, setHuggingfaceKey] = useState('')
  const [promptSanitizer, setPromptSanitizer] = useState(true)
  const [seedGeneration, setSeedGeneration] = useState(false)
  const [engineMode, setEngineMode] = useState<EngineMode>(ENGINE_MODES.UNCHOSEN)
  const [worldEngineModel, setWorldEngineModel] = useState(DEFAULT_WORLD_ENGINE_MODEL)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([
    { id: DEFAULT_WORLD_ENGINE_MODEL, isLocal: false, isCustom: false }
  ])
  const [customModelInput, setCustomModelInput] = useState('')
  const [customModelError, setCustomModelError] = useState<string | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SetupStatus>(null)
  const [engineDirPath, setEngineDirPath] = useState<string | null>(null)

  // Sync local state with config
  useEffect(() => {
    if (config) {
      const host = config.gpu_server?.host || 'localhost'
      const port = config.gpu_server?.port || STANDALONE_PORT
      setGpuServer(`${host}:${port}`)
      setUseSsl(config.gpu_server?.use_ssl || false)
      setOpenaiKey(config.api_keys?.openai || '')
      setFalKey(config.api_keys?.fal || '')
      setHuggingfaceKey(config.api_keys?.huggingface || '')
      setPromptSanitizer(config.features?.prompt_sanitizer ?? true)
      setSeedGeneration(config.features?.seed_generation ?? false)
      setEngineMode(config.features?.engine_mode ?? ENGINE_MODES.UNCHOSEN)
      const selectedModel =
        normalizeModelInput(config.features?.world_engine_model || DEFAULT_WORLD_ENGINE_MODEL) ||
        DEFAULT_WORLD_ENGINE_MODEL
      const savedCustomModels = toUniqueModelIds(
        Array.isArray(config.features?.custom_world_models) ? config.features.custom_world_models : []
      )
      setWorldEngineModel(selectedModel)
      setModelOptions((prev) => {
        const map = new Map(prev.map((m) => [m.id, m]))
        const ids = toUniqueModelIds([selectedModel, ...savedCustomModels, ...prev.map((m) => m.id)])
        return ids.map((id) => ({
          id,
          isLocal: map.get(id)?.isLocal ?? false,
          isCustom: savedCustomModels.includes(id) || map.get(id)?.isCustom || false
        }))
      })
    }
  }, [config])

  // Fetch engine directory path on mount
  useEffect(() => {
    invoke<string>('get_engine_dir_path').then(setEngineDirPath).catch(console.warn)
  }, [])

  // Check engine status when settings panel opens (for standalone mode)
  useEffect(() => {
    if (isSettingsOpen && engineMode === ENGINE_MODES.STANDALONE) {
      checkStatus()
    }
  }, [isSettingsOpen, engineMode, checkStatus])

  // Load available Waypoint models from Hugging Face when settings panel opens
  useEffect(() => {
    if (!isSettingsOpen) return

    let isCancelled = false
    const currentModel =
      normalizeModelInput(config?.features?.world_engine_model || DEFAULT_WORLD_ENGINE_MODEL) ||
      DEFAULT_WORLD_ENGINE_MODEL
    const savedCustomModels = toUniqueModelIds(
      Array.isArray(config?.features?.custom_world_models) ? config.features.custom_world_models : []
    )

    const loadModels = async () => {
      setModelsLoading(true)
      setModelsError(null)
      try {
        const models = await invoke<string[]>('list_waypoint_models')
        if (isCancelled) return

        const ids = toUniqueModelIds([currentModel, ...savedCustomModels, ...(Array.isArray(models) ? models : [])])
        const ensuredIds = ids.length ? ids : [DEFAULT_WORLD_ENGINE_MODEL]
        const availability = await invoke<Array<{ id: string; is_local: boolean }>>('list_model_availability', {
          modelIds: ensuredIds
        })
        if (isCancelled) return
        const availabilityMap = new Map(
          (Array.isArray(availability) ? availability : []).map((entry) => [entry.id, !!entry.is_local])
        )

        setModelOptions(
          ensuredIds.map((id) => ({
            id,
            isLocal: availabilityMap.get(id) ?? false,
            isCustom: savedCustomModels.includes(id)
          }))
        )
      } catch (err) {
        if (isCancelled) return
        console.warn('Failed to fetch Waypoint models:', err)
        setModelsError('Could not load models from Hugging Face')
        const fallbackIds = toUniqueModelIds([
          currentModel,
          ...savedCustomModels,
          ...modelOptions.map((m) => m.id),
          DEFAULT_WORLD_ENGINE_MODEL
        ])
        setModelOptions(
          fallbackIds.map((id) => ({
            id,
            isLocal: modelOptions.find((m) => m.id === id)?.isLocal ?? false,
            isCustom: savedCustomModels.includes(id) || modelOptions.find((m) => m.id === id)?.isCustom || false
          }))
        )
      } finally {
        if (!isCancelled) setModelsLoading(false)
      }
    }

    loadModels()
    return () => {
      isCancelled = true
    }
  }, [isSettingsOpen, config?.features?.world_engine_model, config?.features?.custom_world_models])

  const handleSetupEngine = async () => {
    try {
      await setupEngine()
      await checkStatus()
    } catch (err) {
      // Error is already handled in useEngine hook
    }
  }

  const isEngineReady = status?.uv_installed && status?.repo_cloned && status?.dependencies_synced
  const hasAnyEngineComponent = status?.uv_installed || status?.repo_cloned || status?.dependencies_synced
  const isEngineCorrupt = hasAnyEngineComponent && !isEngineReady

  // Parse host:port string
  const parseGpuServer = (serverStr: string): { host: string; port: number } => {
    const match = serverStr.match(/^([^:]+)(?::(\d+))?$/)
    if (!match) return { host: 'localhost', port: 8080 }
    return {
      host: match[1] || 'localhost',
      port: match[2] ? parseInt(match[2], 10) : 8080
    }
  }

  const handleAddCustomModel = async () => {
    const normalized = normalizeModelInput(customModelInput)
    if (!normalized || !normalized.includes('/')) {
      setCustomModelError('Enter a valid Hugging Face model URL or org/model id')
      return
    }

    setCustomModelError(null)
    let isLocal = false
    try {
      const availability = await invoke<Array<{ id: string; is_local: boolean }>>('list_model_availability', {
        modelIds: [normalized]
      })
      isLocal = Array.isArray(availability) && availability[0]?.is_local === true
    } catch {
      isLocal = false
    }

    setModelOptions((prev) => {
      const existing = prev.find((m) => m.id === normalized)
      if (existing) {
        return prev.map((m) =>
          m.id === normalized ? { ...m, isCustom: true, isLocal: existing.isLocal || isLocal } : m
        )
      }
      return [{ id: normalized, isLocal, isCustom: true }, ...prev]
    })
    setWorldEngineModel(normalized)
    setCustomModelInput('')
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveStatus(null)

    const { host, port } = parseGpuServer(gpuServer)
    const normalizedCustomWorldModels = toUniqueModelIds(modelOptions.filter((m) => m.isCustom).map((m) => m.id))

    const newConfig: AppConfig = {
      ...(config as AppConfig),
      gpu_server: {
        ...config.gpu_server,
        host,
        port,
        use_ssl: useSsl
      },
      api_keys: {
        ...config.api_keys,
        openai: openaiKey,
        fal: falKey,
        huggingface: huggingfaceKey
      },
      features: {
        ...config.features,
        prompt_sanitizer: promptSanitizer,
        seed_generation: seedGeneration,
        engine_mode: engineMode,
        world_engine_model: normalizeModelInput(worldEngineModel) || DEFAULT_WORLD_ENGINE_MODEL,
        custom_world_models: normalizedCustomWorldModels,
        seed_gallery: config.features.seed_gallery
      },
      ui: config.ui
    }

    const success = await saveConfig(newConfig)
    setIsSaving(false)
    setSaveStatus(success ? 'saved' : 'error')

    if (success) {
      setTimeout(() => setSaveStatus(null), 2000)
    }
  }

  const handleOpenConfig = () => {
    openConfig()
  }

  const handleOpenEngineDir = async () => {
    try {
      await invoke('open_engine_dir')
    } catch (err) {
      console.warn('Failed to open engine directory:', err)
    }
  }

  // Helper to check if standalone mode is active
  const isStandaloneMode = engineMode === ENGINE_MODES.STANDALONE
  const isServerMode = engineMode === ENGINE_MODES.SERVER

  const handleClose = () => {
    toggleSettings()
  }

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      toggleSettings()
    }
  }

  if (!isSettingsOpen) return null

  return (
    <div className="settings-overlay" onClick={handleBackdropClick}>
      <div className="settings-panel">
        <div className="panel-header">
          <span className="panel-title">Settings</span>
          <button className="panel-close" onClick={handleClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="panel-content">
          {/* World Engine Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">World Engine</h3>

            {/* Engine Directory - Always visible */}
            <div className="engine-dir-row">
              <span className="engine-dir-label">Engine Directory:</span>
              <button className="engine-dir-button" onClick={handleOpenEngineDir} title={engineDirPath || 'Loading...'}>
                <span className="engine-dir-path">
                  {engineDirPath
                    ? engineDirPath.length > 40
                      ? '...' + engineDirPath.slice(-37)
                      : engineDirPath
                    : 'Loading...'}
                </span>
                <svg className="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path
                    d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            {/* Engine Mode Selector */}
            <div className="setting-group">
              <label className="setting-label">Engine Mode</label>
              <div className="engine-mode-selector">
                <button
                  className={`mode-option ${isStandaloneMode ? 'active' : ''}`}
                  onClick={() => setEngineMode(ENGINE_MODES.STANDALONE)}
                >
                  Standalone
                </button>
                <button
                  className={`mode-option ${isServerMode ? 'active' : ''}`}
                  onClick={() => setEngineMode(ENGINE_MODES.SERVER)}
                >
                  Server
                </button>
              </div>
              <span className="setting-hint">
                {isStandaloneMode ? 'Biome manages World Engine automatically' : 'You run the server yourself'}
              </span>
            </div>

            <div className="setting-group">
              <label className="setting-label">World Model</label>
              <select
                className="setting-select"
                value={worldEngineModel}
                onChange={(e) => setWorldEngineModel(e.target.value)}
                disabled={modelsLoading}
              >
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id} {model.isLocal ? '- Local' : '- Download'}
                  </option>
                ))}
              </select>
              <div className="model-custom-row">
                <input
                  type="text"
                  className="setting-input"
                  value={customModelInput}
                  onChange={(e) => {
                    setCustomModelInput(e.target.value)
                    if (customModelError) setCustomModelError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddCustomModel()
                    }
                  }}
                  placeholder="https://huggingface.co/org/model or org/model"
                />
                <button type="button" className="engine-action-button secondary" onClick={handleAddCustomModel}>
                  Add
                </button>
              </div>
              <span className="setting-hint">
                {modelsLoading
                  ? 'Loading models from Hugging Face...'
                  : modelsError ||
                    `${modelOptions.filter((m) => m.isLocal).length} local / ${modelOptions.length} total - hf.co/collections/Overworld/waypoint-1`}
              </span>
              {customModelError && <span className="setting-hint">{customModelError}</span>}
            </div>

            {/* Standalone Engine Status */}
            {isStandaloneMode && (
              <div className="engine-status-box">
                {engineLoading ? (
                  <div className="engine-status-content">
                    <div className="engine-status-spinner" />
                    <span className="engine-status-text">{setupProgress || 'Checking status...'}</span>
                  </div>
                ) : engineError ? (
                  <div className="engine-status-content error">
                    <span className="engine-status-text">{engineError}</span>
                    <button className="engine-action-button" onClick={handleSetupEngine}>
                      Retry Setup
                    </button>
                  </div>
                ) : isEngineReady ? (
                  <div className="engine-status-content ready">
                    <svg
                      className="engine-status-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="engine-status-text">World Engine is ready</span>
                    <button
                      className="engine-action-button secondary"
                      onClick={handleSetupEngine}
                      disabled={engineLoading}
                    >
                      Reinstall Engine
                    </button>
                  </div>
                ) : isEngineCorrupt ? (
                  <div className="engine-status-content corrupt">
                    <svg
                      className="engine-status-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span className="engine-status-text">World Engine is corrupt</span>
                    <button className="engine-action-button" onClick={handleSetupEngine} disabled={engineLoading}>
                      Reinstall Engine
                    </button>
                  </div>
                ) : (
                  <div className="engine-status-content not-ready">
                    <svg
                      className="engine-status-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span className="engine-status-text">World Engine not installed</span>
                    <button className="engine-action-button" onClick={handleSetupEngine} disabled={engineLoading}>
                      Download & Setup
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Server Mode Settings */}
            {isServerMode && (
              <>
                <div className="setting-group">
                  <label className="setting-label">Server (host:port)</label>
                  <input
                    type="text"
                    className="setting-input"
                    value={gpuServer}
                    onChange={(e) => setGpuServer(e.target.value)}
                    placeholder={`localhost:${STANDALONE_PORT}`}
                  />
                </div>

                <div className="setting-group">
                  <div className="setting-row">
                    <label className="setting-label">Use SSL</label>
                    <input
                      type="checkbox"
                      className="setting-checkbox"
                      checked={useSsl}
                      onChange={(e) => setUseSsl(e.target.checked)}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* API Keys Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">API Keys</h3>

            <div className="setting-group">
              <label className="setting-label">OpenAI Key</label>
              <input
                type="text"
                className="setting-input"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
              />
            </div>

            <div className="setting-group">
              <label className="setting-label">FAL Key</label>
              <input
                type="text"
                className="setting-input"
                value={falKey}
                onChange={(e) => setFalKey(e.target.value)}
                placeholder="fal-..."
              />
            </div>

            <div className="setting-group">
              <label className="setting-label">HuggingFace Token</label>
              <input
                type="text"
                className="setting-input"
                value={huggingfaceKey}
                onChange={(e) => setHuggingfaceKey(e.target.value)}
                placeholder="hf_..."
              />
              <span className="setting-hint">Required for World Engine model access</span>
            </div>
          </div>

          {/* Features Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">Features</h3>

            <div className="setting-group">
              <div className="setting-row">
                <label className="setting-label">Prompt Sanitizer</label>
                <input
                  type="checkbox"
                  className="setting-checkbox"
                  checked={promptSanitizer}
                  onChange={(e) => setPromptSanitizer(e.target.checked)}
                />
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-row">
                <label className="setting-label">Seed Generation</label>
                <input
                  type="checkbox"
                  className="setting-checkbox"
                  checked={seedGeneration}
                  onChange={(e) => setSeedGeneration(e.target.checked)}
                />
              </div>
            </div>
          </div>

          {/* Config Path Display - Clickable */}
          {configPath && (
            <div className="settings-config-path" onClick={handleOpenConfig} title="Open config.json">
              <span className="config-path-label">Config file:</span>
              <span className="config-path-value">{configPath}</span>
            </div>
          )}
        </div>

        <div className="panel-footer">
          <button
            className={`setting-button ${isSaving ? 'loading' : ''} ${saveStatus === 'saved' ? 'success' : ''}`}
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
