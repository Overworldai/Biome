import { useState, useRef, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStreaming } from '../context/StreamingContextShared'
import { useConfig } from '../hooks/useConfig'
import { applyPrompt as processPrompt } from '../utils/promptSanitizer'
import { RESET_KEY_DISPLAY } from '../hooks/useGameInput'

const BottomPanel = ({ isOpen, isHidden, onToggleHidden }) => {
  const {
    sendPrompt,
    sendPromptWithSeed,
    sendInitialSeed,
    requestPointerLock,
    reset,
    logout,
    mouseSensitivity,
    setMouseSensitivity,
    isPaused,
    canUnpause
  } = useStreaming()
  const { config, hasOpenAiKey, hasFalKey } = useConfig()

  const [activeTab, setActiveTab] = useState('prompt')
  const [textPrompt, setTextPrompt] = useState('')
  const [lastPrompt, setLastPrompt] = useState('')
  const generateSeed = true // Always generate seed images

  // Seeds gallery state
  const [seeds, setSeeds] = useState([])
  const [seedThumbnails, setSeedThumbnails] = useState({})
  const [loadingSeeds, setLoadingSeeds] = useState(false)
  const [selectedSeed, setSelectedSeed] = useState(null)

  const seedGenerationEnabled = config?.features?.seed_generation
  const promptSanitizerEnabled = config?.features?.prompt_sanitizer
  const seedGalleryEnabled = config?.features?.seed_gallery

  // Seeds are disabled during the pointer lock cooldown period
  const seedsDisabled = isPaused && !canUnpause

  // Build array of available tabs based on feature flags
  const availableTabs = [
    {
      id: 'prompt',
      title: 'Prompt',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path
            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    },
    ...(seedGalleryEnabled
      ? [
          {
            id: 'seeds',
            title: 'Seeds',
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21,15 16,10 5,21" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )
          }
        ]
      : [])
  ]

  // Reset to first available tab if current tab becomes unavailable
  useEffect(() => {
    const tabIds = availableTabs.map((t) => t.id)
    if (!tabIds.includes(activeTab)) {
      setActiveTab(tabIds[0])
    }
  }, [availableTabs.length, activeTab])

  // Determine why the prompt box might be disabled
  const getDisabledState = () => {
    // Image generation is the core feature - check code-level and user setting
    if (!generateSeed || !seedGenerationEnabled) {
      return { disabled: true, message: 'Image generation is disabled - enable in settings' }
    }
    if (!hasFalKey) {
      return { disabled: true, message: 'FAL key required for image generation - configure in settings' }
    }

    // Prompt sanitizer is optional, but if enabled needs OpenAI key
    if (promptSanitizerEnabled && !hasOpenAiKey) {
      return { disabled: true, message: 'OpenAI key required for prompt enhancement - configure in settings' }
    }

    return { disabled: false, message: '' }
  }

  const { disabled: isDisabledByConfig, message: disabledMessage } = getDisabledState()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState(null)
  const promptButtonRef = useRef(null)
  const resetButtonRef = useRef(null)
  const textareaRef = useRef(null)

  const handleClick = (e) => e.stopPropagation()

  const handleKeyDown = (e) => {
    e.stopPropagation()
  }

  const triggerSuccessFlash = (buttonRef) => {
    if (buttonRef.current) {
      buttonRef.current.classList.remove('success-flash')
      void buttonRef.current.offsetWidth
      buttonRef.current.classList.add('success-flash')
    }
  }

  const handleResetWorld = () => {
    reset()
    triggerSuccessFlash(resetButtonRef)
    // Relock pointer to unpause and resume streaming
    requestPointerLock()
  }

  const handleLogout = () => {
    logout()
  }

  const handlePromptSubmit = async (e) => {
    // Submit on Enter (without Shift for newline)
    if (e.key === 'Enter' && !e.shiftKey && textPrompt.trim() && !isLoading) {
      e.preventDefault()
      await applyPrompt()
    }
  }

  // Auto-resize textarea as content grows
  // Max height is controlled by CSS (15cqw), we just need to trigger auto-resize
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      // Let CSS max-height (15cqw) handle the limit
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [textPrompt, status, isLoading])

  // Track which thumbnails are currently being loaded
  const loadingThumbnailsRef = useRef(new Set())

  // Load seeds list
  const loadSeeds = useCallback(async () => {
    setLoadingSeeds(true)
    try {
      const seedList = await invoke('list_seeds')
      setSeeds(seedList)
    } catch (err) {
      console.error('Failed to load seeds:', err)
    } finally {
      setLoadingSeeds(false)
    }
  }, [])

  // Load seeds once when tab first opens
  useEffect(() => {
    if (activeTab === 'seeds' && seeds.length === 0 && !loadingSeeds) {
      loadSeeds()
    }
  }, [activeTab, seeds.length, loadingSeeds, loadSeeds])

  // Load thumbnails for seeds (batched, with deduplication)
  useEffect(() => {
    if (activeTab !== 'seeds' || seeds.length === 0) return

    const loadBatch = async () => {
      for (const filename of seeds) {
        // Skip if already loaded or currently loading
        if (loadingThumbnailsRef.current.has(filename)) continue

        setSeedThumbnails((prev) => {
          if (prev[filename]) return prev // Already have it

          // Mark as loading and start the load
          loadingThumbnailsRef.current.add(filename)
          invoke('read_seed_thumbnail', { filename, maxSize: 100 })
            .then((base64) => {
              setSeedThumbnails((p) => ({ ...p, [filename]: base64 }))
            })
            .catch((err) => console.error('Failed to load thumbnail:', filename, err))
            .finally(() => loadingThumbnailsRef.current.delete(filename))

          return prev
        })
      }
    }

    loadBatch()
  }, [activeTab, seeds])

  // Handle seed selection - reset server and send filename (server loads from its storage)
  const handleSeedClick = async (filename) => {
    setSelectedSeed(filename)
    try {
      reset()
      sendInitialSeed(filename)
      requestPointerLock()
    } catch (err) {
      console.error('Failed to apply seed:', err)
    }
  }

  const applyPrompt = async () => {
    if (!textPrompt.trim() || isLoading) return

    // Request pointer lock immediately on user gesture (Safari requirement)
    // Must be called synchronously in response to user action
    requestPointerLock()

    setIsLoading(true)
    setError(null)
    triggerSuccessFlash(promptButtonRef)
    setStatus('Enhancing prompt...')

    try {
      const { sanitized_prompt, seed_image_url } = await processPrompt(textPrompt.trim(), generateSeed, config)

      setLastPrompt(textPrompt.trim())
      setTextPrompt(sanitized_prompt)

      if (generateSeed && seed_image_url) {
        setStatus('Seed image ready, applying...')
        sendPromptWithSeed(sanitized_prompt, seed_image_url)
      } else {
        setStatus('Applying prompt...')
        sendPrompt(sanitized_prompt)
      }

      setStatus(null)
      setIsLoading(false)
    } catch (err) {
      console.error('Prompt error:', err)
      setError(err.message)
      setStatus(null)
      setIsLoading(false)
    }
  }

  // When hidden, show only a small expand tab
  if (isHidden) {
    return (
      <div id="bottom-panel" className={`panel panel-bottom collapsed ${isOpen ? 'open' : ''}`} onClick={handleClick}>
        <div className="panel-toggle-bar" onClick={onToggleHidden} title="Show panel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    )
  }

  return (
    <div id="bottom-panel" className={`panel panel-bottom ${isOpen ? 'open' : ''}`} onClick={handleClick}>
      {/* Toggle button to hide panel */}
      <div className="panel-toggle-bar" onClick={onToggleHidden} title="Hide panel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="panel-content">
        {/* Vertical tab bar on left - only shown when more than one tab is available */}
        {availableTabs.length > 1 && (
          <div className="panel-tabs">
            {availableTabs.map((tab) => (
              <button
                key={tab.id}
                className={`panel-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                title={tab.title}
              >
                {tab.icon}
              </button>
            ))}
          </div>
        )}

        {/* Tab content area */}
        <div className="panel-tab-content">
          {/* Prompt tab content */}
          {activeTab === 'prompt' && (
            <div className="prompt-container">
              <textarea
                ref={textareaRef}
                className="prompt-input-compact"
                placeholder={isDisabledByConfig ? disabledMessage : lastPrompt || 'Describe a scene...'}
                value={isLoading ? status || '' : textPrompt}
                onChange={(e) => setTextPrompt(e.target.value)}
                onKeyDown={(e) => {
                  handleKeyDown(e)
                  handlePromptSubmit(e)
                }}
                disabled={isLoading || isDisabledByConfig}
                rows={1}
              />

              {/* Controls row - sensitivity, buttons */}
              <div className="prompt-buttons">
                {/* Mouse sensitivity slider */}
                <div className="sensitivity-control">
                  <span className="sensitivity-label">MOUSE SENS</span>
                  <div className="sensitivity-slider-wrapper compact">
                    <div className="sensitivity-slider-container">
                      <input
                        type="range"
                        className="setting-slider"
                        min="0.1"
                        max="3.0"
                        step="0.1"
                        value={mouseSensitivity}
                        onChange={(e) => setMouseSensitivity(parseFloat(e.target.value))}
                        onClick={handleClick}
                        title="Mouse sensitivity"
                      />
                      <div className="sensitivity-track"></div>
                      <div
                        className="sensitivity-fill"
                        style={{ width: `${((mouseSensitivity - 0.1) / (3.0 - 0.1)) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                  <span className="sensitivity-value">{mouseSensitivity.toFixed(1)}</span>
                </div>

                <div className="prompt-divider"></div>

                {/* Reset world button */}
                <div
                  className="prompt-control-group"
                  onClick={handleResetWorld}
                  title={`Reset world (${RESET_KEY_DISPLAY})`}
                >
                  <span ref={resetButtonRef} className="prompt-control-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path
                        d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="prompt-control-label">RESET({RESET_KEY_DISPLAY})</span>
                </div>

                {/* Logout button */}
                <div className="prompt-control-group" onClick={handleLogout} title="Logout">
                  <span className="prompt-control-btn danger">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points="16,17 21,12 16,7" strokeLinecap="round" strokeLinejoin="round" />
                      <line x1="21" y1="12" x2="9" y2="12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="prompt-control-label">EXIT</span>
                </div>

                {/* Submit button */}
                <div
                  className={`prompt-control-group ${isLoading || !textPrompt.trim() || isDisabledByConfig ? 'disabled' : ''}`}
                  onClick={() => !(isLoading || !textPrompt.trim() || isDisabledByConfig) && applyPrompt()}
                  title={isDisabledByConfig ? disabledMessage : 'Apply prompt'}
                >
                  <span
                    ref={promptButtonRef}
                    className={`prompt-submit-btn ${isLoading || !textPrompt.trim() || isDisabledByConfig ? 'disabled' : ''}`}
                  >
                    {isLoading ? (
                      <svg
                        className="prompt-spinner"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <circle cx="12" cy="12" r="9" strokeOpacity="0.3" />
                        <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M5 12h12M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="prompt-control-label">APPLY</span>
                </div>
              </div>
            </div>
          )}

          {/* Seeds tab content - only rendered when seed gallery is enabled */}
          {seedGalleryEnabled && activeTab === 'seeds' && (
            <div className="seeds-container">
              <div className="seeds-gallery">
                {loadingSeeds ? (
                  <div className="seeds-loading">Loading seeds...</div>
                ) : seeds.length === 0 ? (
                  <div className="seeds-empty">No seeds found</div>
                ) : (
                  seeds.map((filename) => (
                    <div
                      key={filename}
                      className={`seed-item ${selectedSeed === filename ? 'selected' : ''} ${seedsDisabled ? 'disabled' : ''}`}
                      onClick={() => !seedsDisabled && handleSeedClick(filename)}
                      title={seedsDisabled ? 'Wait to select a seed...' : filename}
                    >
                      {seedThumbnails[filename] ? (
                        <img src={`data:image/jpeg;base64,${seedThumbnails[filename]}`} alt={filename} />
                      ) : (
                        <div className="seed-placeholder">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21,15 16,10 5,21" />
                          </svg>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Error display */}
          {error && <div className="prompt-error-bar">{error}</div>}
        </div>
      </div>
    </div>
  )
}

export default BottomPanel
