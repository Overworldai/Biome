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
  const { config, hasOpenAiKey, hasFalKey, getUrl } = useConfig()

  const [activeTab, setActiveTab] = useState('prompt')
  const [textPrompt, setTextPrompt] = useState('')
  const [lastPrompt, setLastPrompt] = useState('')
  const generateSeed = true // Always generate seed images

  // Seeds gallery state
  const [seeds, setSeeds] = useState([])
  const [seedThumbnails, setSeedThumbnails] = useState({})
  const [loadingSeeds, setLoadingSeeds] = useState(false)
  const [selectedSeed, setSelectedSeed] = useState(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [rejectedSeed, setRejectedSeed] = useState(null) // { filename } when upload is NSFW
  const fileInputRef = useRef(null)

  const seedGenerationEnabled = config?.features?.seed_generation
  const promptSanitizerEnabled = config?.features?.prompt_sanitizer
  const seedGalleryEnabled = config?.features?.seed_gallery
  const uploadBaseUrl = getUrl()

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

  // Load seeds and thumbnails on mount
  useEffect(() => {
    let cancelled = false

    const loadSeedsAndThumbnails = async () => {
      setLoadingSeeds(true)
      try {
        const seedList = await invoke('list_seeds')
        if (cancelled) return
        setSeeds(seedList)

        // Load all thumbnails in background (unsafe ones rendered greyscaled via CSS)
        for (const seed of seedList) {
          if (loadingThumbnailsRef.current.has(seed.filename)) continue
          loadingThumbnailsRef.current.add(seed.filename)
          invoke('read_seed_thumbnail', { filename: seed.filename, maxSize: 100 })
            .then((base64) => {
              if (!cancelled) setSeedThumbnails((p) => ({ ...p, [seed.filename]: base64 }))
            })
            .catch((err) => console.error('Failed to load thumbnail:', seed.filename, err))
            .finally(() => loadingThumbnailsRef.current.delete(seed.filename))
        }
      } catch (err) {
        console.error('Failed to load seeds:', err)
      } finally {
        if (!cancelled) setLoadingSeeds(false)
      }
    }

    loadSeedsAndThumbnails()
    return () => {
      cancelled = true
    }
  }, [])

  // Handle safe seed selection - send to server
  const handleSeedClick = async (seed) => {
    if (!seed.is_safe) return
    setSelectedSeed(seed.filename)
    try {
      sendPromptWithSeed(seed.filename)
      requestPointerLock()
    } catch (err) {
      console.error('Failed to apply seed:', err)
    }
  }

  // Handle unsafe seed click - delete it (only user-uploaded seeds are deletable)
  const handleDeleteSeed = async (seed) => {
    if (seed.is_default) {
      setError('Default seeds cannot be removed')
      setTimeout(() => setError(null), 3000)
      return
    }
    try {
      await invoke('delete_seed', { filename: seed.filename })
      setSeeds((prev) => prev.filter((s) => s.filename !== seed.filename))
      setSeedThumbnails((prev) => {
        const next = { ...prev }
        delete next[seed.filename]
        return next
      })
    } catch (err) {
      console.error('Failed to delete seed:', err)
      setError(err.toString())
      setTimeout(() => setError(null), 3000)
    }
  }

  const readBlobAsBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result
        if (typeof result !== 'string' || !result.includes(',')) {
          reject(new Error('Failed to read image data'))
          return
        }
        resolve(result.split(',')[1])
      }
      reader.onerror = () => reject(new Error('Failed to read image data'))
      reader.readAsDataURL(blob)
    })

  const uploadSeedData = async (filename, base64Data) => {
    setUploadingImage(true)
    try {
      const response = await fetch(`${uploadBaseUrl}/seeds/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          data: base64Data
        })
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Upload failed' }))
        throw new Error(error.error || 'Upload failed')
      }

      const result = await response.json()

      // Refresh seeds list (includes unsafe seeds now)
      const seedList = await invoke('list_seeds')
      setSeeds(seedList)

      // Load thumbnail for the uploaded seed
      invoke('read_seed_thumbnail', { filename, maxSize: 100 })
        .then((base64) => setSeedThumbnails((prev) => ({ ...prev, [filename]: base64 })))
        .catch((err) => console.error('Failed to load thumbnail:', filename, err))

      // Check if server flagged this seed as unsafe
      if (!result.is_safe) {
        setRejectedSeed({ filename })
        return
      }

      // Auto-apply valid uploaded seed immediately
      setSelectedSeed(filename)
      sendPromptWithSeed(filename)
      requestPointerLock()
    } catch (err) {
      console.error('Upload error:', err)
      setError(err.message || 'Failed to upload image')
      setTimeout(() => setError(null), 3000)
    } finally {
      setUploadingImage(false)
    }
  }

  // Handle file picker upload
  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      setTimeout(() => setError(null), 3000)
      event.target.value = ''
      return
    }

    try {
      const base64Data = await readBlobAsBase64(file)
      await uploadSeedData(file.name, base64Data)
    } catch (err) {
      console.error('Upload error:', err)
      setError(err.message || 'Failed to upload image')
      setTimeout(() => setError(null), 3000)
    }

    event.target.value = ''
  }

  // Handle clipboard upload via top triangle click only
  const handleClipboardUpload = async () => {
    if (seedsDisabled || uploadingImage) return

    if (!navigator.clipboard?.read) {
      setError('Clipboard image upload is not supported in this environment')
      setTimeout(() => setError(null), 3000)
      return
    }

    try {
      const clipboardItems = await navigator.clipboard.read()
      let imageBlob = null
      let imageType = ''

      for (const item of clipboardItems) {
        const matchingType = item.types.find((type) => type.startsWith('image/'))
        if (matchingType) {
          imageBlob = await item.getType(matchingType)
          imageType = matchingType
          break
        }
      }

      if (!imageBlob) {
        throw new Error('No image found in clipboard')
      }

      const extensionMap = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp'
      }
      const extension = extensionMap[imageType] || 'png'
      const filename = `clipboard-${Date.now()}.${extension}`
      const base64Data = await readBlobAsBase64(imageBlob)
      await uploadSeedData(filename, base64Data)
    } catch (err) {
      console.error('Clipboard upload error:', err)
      setError(err.message || 'Failed to read image from clipboard')
      setTimeout(() => setError(null), 3000)
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
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                style={{ display: 'none' }}
              />

              <div className="seeds-gallery">
                {/* Upload button - always first */}
                <div
                  className={`seed-item seed-upload ${uploadingImage ? 'uploading' : ''} ${seedsDisabled ? 'disabled' : ''}`}
                  title={seedsDisabled ? 'Wait to upload...' : ''}
                >
                  {uploadingImage ? (
                    <div className="seed-placeholder">
                      <svg
                        className="upload-spinner"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <circle cx="12" cy="12" r="9" strokeOpacity="0.3" />
                        <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
                      </svg>
                    </div>
                  ) : (
                    <div className="seed-upload-split">
                      <button
                        type="button"
                        className="seed-upload-action seed-upload-top"
                        title="Upload image from clipboard"
                        onClick={handleClipboardUpload}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="9" y="3" width="6" height="4" rx="1" />
                          <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
                          <rect x="12" y="10" width="8" height="10" rx="1" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="seed-upload-action seed-upload-bottom"
                        title="Upload from folder"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path
                            d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
                          <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <div className="seed-upload-divider" />
                    </div>
                  )}
                </div>

                {loadingSeeds ? (
                  <div className="seeds-loading">Loading seeds...</div>
                ) : seeds.length === 0 ? (
                  <div className="seeds-empty">No seeds found</div>
                ) : (
                  seeds.map((seed) => (
                    <div
                      key={seed.filename}
                      className={`seed-item ${selectedSeed === seed.filename ? 'selected' : ''} ${seedsDisabled ? 'disabled' : ''} ${!seed.is_safe ? 'unsafe' : ''}`}
                      onClick={() => {
                        if (seedsDisabled) return
                        if (!seed.is_safe) {
                          handleDeleteSeed(seed)
                        } else {
                          handleSeedClick(seed)
                        }
                      }}
                      title={
                        seedsDisabled
                          ? 'Wait to select a seed...'
                          : !seed.is_safe
                            ? `${seed.filename} — flagged as inappropriate (click to remove)`
                            : seed.filename
                      }
                    >
                      {!seed.is_default && (
                        <button
                          type="button"
                          className="seed-delete-btn"
                          title={`Delete ${seed.filename}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteSeed(seed)
                          }}
                          disabled={seedsDisabled}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="7" y1="7" x2="17" y2="17" />
                            <line x1="17" y1="7" x2="7" y2="17" />
                          </svg>
                        </button>
                      )}
                      {seedThumbnails[seed.filename] ? (
                        <img src={`data:image/jpeg;base64,${seedThumbnails[seed.filename]}`} alt={seed.filename} />
                      ) : (
                        <div className="seed-placeholder">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21,15 16,10 5,21" />
                          </svg>
                        </div>
                      )}
                      {!seed.is_safe && (
                        <div className="seed-unsafe-badge">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
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

      {/* Seed rejection modal */}
      <div className={`seed-rejected-overlay ${rejectedSeed ? 'active' : ''}`}>
        <div className="seed-rejected-content">
          <div className="seed-rejected-title-row">
            <svg
              className="seed-rejected-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            <span className="seed-rejected-title">SEED REJECTED</span>
          </div>
          <span className="seed-rejected-message">
            <strong>{rejectedSeed?.filename}</strong> was flagged as inappropriate. Click the greyed-out seed to remove
            it.
          </span>
          <button className="seed-rejected-button" onClick={() => setRejectedSeed(null)}>
            DISMISS
          </button>
        </div>
      </div>
    </div>
  )
}

export default BottomPanel
