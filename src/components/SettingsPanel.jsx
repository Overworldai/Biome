import { useState, useEffect } from 'react'
import { usePortal } from '../context/PortalContext'
import useConfig from '../hooks/useConfig'
import { useEngine } from '../hooks/useEngine'

const SettingsPanel = () => {
  const { isSettingsOpen, toggleSettings } = usePortal()
  const { config, saveConfig, configPath, openConfig } = useConfig()
  const { status, isLoading: engineLoading, error: engineError, setupProgress, checkStatus, setupEngine } = useEngine()

  // Local state for form fields
  const [gpuServer, setGpuServer] = useState('')
  const [useSsl, setUseSsl] = useState(false)
  const [openaiKey, setOpenaiKey] = useState('')
  const [falKey, setFalKey] = useState('')
  const [promptSanitizer, setPromptSanitizer] = useState(true)
  const [seedGeneration, setSeedGeneration] = useState(false)
  const [useStandaloneEngine, setUseStandaloneEngine] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)

  // Sync local state with config
  useEffect(() => {
    if (config) {
      const host = config.gpu_server?.host || 'localhost'
      const port = config.gpu_server?.port || 8080
      setGpuServer(`${host}:${port}`)
      setUseSsl(config.gpu_server?.use_ssl || false)
      setOpenaiKey(config.api_keys?.openai || '')
      setFalKey(config.api_keys?.fal || '')
      setPromptSanitizer(config.features?.prompt_sanitizer ?? true)
      setSeedGeneration(config.features?.seed_generation ?? false)
      setUseStandaloneEngine(config.features?.use_standalone_engine ?? true)
    }
  }, [config])

  // Check engine status when settings panel opens
  useEffect(() => {
    if (isSettingsOpen && useStandaloneEngine) {
      checkStatus()
    }
  }, [isSettingsOpen, useStandaloneEngine, checkStatus])

  const handleSetupEngine = async () => {
    try {
      await setupEngine()
      await checkStatus()
    } catch (err) {
      // Error is already handled in useEngine hook
    }
  }

  const isEngineReady = status?.uv_installed && status?.repo_cloned && status?.dependencies_synced

  // Parse host:port string
  const parseGpuServer = (serverStr) => {
    const match = serverStr.match(/^([^:]+)(?::(\d+))?$/)
    if (!match) return { host: 'localhost', port: 8080 }
    return {
      host: match[1] || 'localhost',
      port: match[2] ? parseInt(match[2], 10) : 8080
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveStatus(null)

    const { host, port } = parseGpuServer(gpuServer)

    const newConfig = {
      gpu_server: {
        host,
        port,
        use_ssl: useSsl
      },
      api_keys: {
        openai: openaiKey,
        fal: falKey
      },
      features: {
        prompt_sanitizer: promptSanitizer,
        seed_generation: seedGeneration,
        use_standalone_engine: useStandaloneEngine
      }
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

  const handleClose = () => {
    toggleSettings()
  }

  const handleBackdropClick = (e) => {
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
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className="panel-content">
          {/* GPU Server Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">World Engine</h3>

            <div className="setting-group">
              <div className="setting-row">
                <label className="setting-label">Use Standalone Engine</label>
                <input
                  type="checkbox"
                  className="setting-checkbox"
                  checked={useStandaloneEngine}
                  onChange={(e) => setUseStandaloneEngine(e.target.checked)}
                />
              </div>
            </div>

            {useStandaloneEngine && (
              <div className="engine-status-box">
                {engineLoading ? (
                  <div className="engine-status-content">
                    <div className="engine-status-spinner" />
                    <span className="engine-status-text">
                      {setupProgress || 'Checking status...'}
                    </span>
                  </div>
                ) : engineError ? (
                  <div className="engine-status-content error">
                    <span className="engine-status-text">{engineError}</span>
                    <button
                      className="engine-action-button"
                      onClick={handleSetupEngine}
                    >
                      Retry Setup
                    </button>
                  </div>
                ) : isEngineReady ? (
                  <div className="engine-status-content ready">
                    <svg className="engine-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round"/>
                      <polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="engine-status-text">World Engine is ready</span>
                    <button
                      className="engine-action-button secondary"
                      onClick={handleSetupEngine}
                      disabled={engineLoading}
                    >
                      Check for Updates
                    </button>
                  </div>
                ) : (
                  <div className="engine-status-content not-ready">
                    <svg className="engine-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <span className="engine-status-text">World Engine not installed</span>
                    <button
                      className="engine-action-button"
                      onClick={handleSetupEngine}
                      disabled={engineLoading}
                    >
                      Download & Setup
                    </button>
                  </div>
                )}
              </div>
            )}

            {!useStandaloneEngine && (
              <>
                <div className="setting-group">
                  <label className="setting-label">Server (host:port)</label>
                  <input
                    type="text"
                    className="setting-input"
                    value={gpuServer}
                    onChange={(e) => setGpuServer(e.target.value)}
                    placeholder="localhost:8082"
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
