import {
  useState,
  useRef,
  useEffect,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react'
import { invoke } from '../bridge'
import { useStreaming } from '../context/StreamingContext'
import { useConfig } from '../hooks/useConfig'
import { applyPrompt as processPrompt } from '../utils/promptSanitizer'
import { RESET_KEY_DISPLAY } from '../hooks/useGameInput'
import type { SeedRecord } from '../types/app'

type BottomPanelProps = {
  isOpen: boolean
  isHidden: boolean
  onToggleHidden: () => void
}

type BottomPanelTabId = 'prompt' | 'seeds'
type BottomPanelTab = { id: BottomPanelTabId; title: string; icon: ReactNode }
type RejectedSeed = { filename: string }

const BottomPanel = ({ isOpen, isHidden, onToggleHidden }: BottomPanelProps) => {
  const {
    sendPrompt,
    sendPromptWithSeed,
    sendInitialSeed,
    requestPointerLock,
    reset,
    mouseSensitivity,
    setMouseSensitivity,
    isPaused,
    canUnpause
  } = useStreaming()
  const { config, hasOpenAiKey, hasFalKey, getUrl } = useConfig()

  const [activeTab, setActiveTab] = useState<BottomPanelTabId>('prompt')
  const [textPrompt, setTextPrompt] = useState('')
  const [lastPrompt, setLastPrompt] = useState('')
  const generateSeed = true // Always generate seed images

  // Seeds gallery state
  const [seeds, setSeeds] = useState<SeedRecord[]>([])
  const [seedThumbnails, setSeedThumbnails] = useState<Record<string, string>>({})
  const [loadingSeeds, setLoadingSeeds] = useState(false)
  const [selectedSeed, setSelectedSeed] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [rejectedSeed, setRejectedSeed] = useState<RejectedSeed | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const seedGenerationEnabled = config?.features?.seed_generation
  const promptSanitizerEnabled = config?.features?.prompt_sanitizer
  const seedGalleryEnabled = config?.features?.seed_gallery
  const uploadBaseUrl = getUrl()

  // Seeds are disabled during the pointer lock cooldown period
  const seedsDisabled = isPaused && !canUnpause

  // Build array of available tabs based on feature flags
  const availableTabs: BottomPanelTab[] = [
    {
      id: 'prompt' as const,
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
            id: 'seeds' as const,
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
    const tabIds = availableTabs.map((t) => t.id) as BottomPanelTabId[]
    if (!tabIds.includes(activeTab) && tabIds.length > 0) {
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
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const promptButtonRef = useRef<HTMLSpanElement | null>(null)
  const resetButtonRef = useRef<HTMLSpanElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const handleClick = (e: MouseEvent<HTMLElement>) => e.stopPropagation()

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    e.stopPropagation()
  }

  const triggerSuccessFlash = (buttonRef: { current: HTMLElement | null }) => {
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
    void invoke('quit-app')
  }

  const handlePromptSubmit = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
  const loadingThumbnailsRef = useRef<Set<string>>(new Set())

  // Load seeds and thumbnails on mount
  useEffect(() => {
    let cancelled = false

    const loadSeedsAndThumbnails = async () => {
      setLoadingSeeds(true)
      try {
        const seedList = await invoke('list-seeds')
        if (cancelled) return
        setSeeds(seedList)

        // Load all thumbnails in background (unsafe ones rendered greyscaled via CSS)
        for (const seed of seedList) {
          if (loadingThumbnailsRef.current.has(seed.filename)) continue
          loadingThumbnailsRef.current.add(seed.filename)
          invoke('read-seed-thumbnail', seed.filename, 100)
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
  const handleSeedClick = async (seed: SeedRecord) => {
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
  const handleDeleteSeed = async (seed: SeedRecord) => {
    if (seed.is_default) {
      setError('Default seeds cannot be removed')
      setTimeout(() => setError(null), 3000)
      return
    }
    try {
      await invoke('delete-seed', seed.filename)
      setSeeds((prev) => prev.filter((s) => s.filename !== seed.filename))
      setSeedThumbnails((prev) => {
        const next = { ...prev }
        delete next[seed.filename]
        return next
      })
    } catch (err) {
      console.error('Failed to delete seed:', err)
      setError(err instanceof Error ? err.message : String(err))
      setTimeout(() => setError(null), 3000)
    }
  }

  const readBlobAsBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e: ProgressEvent<FileReader>) => {
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

  const uploadSeedData = async (filename: string, base64Data: string) => {
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

      const result = (await response.json()) as { is_safe?: boolean }

      // Refresh seeds list (includes unsafe seeds now)
      const seedList = await invoke('list-seeds')
      setSeeds(seedList)

      // Load thumbnail for the uploaded seed
      invoke('read-seed-thumbnail', filename, 100)
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
      setError(err instanceof Error ? err.message : 'Failed to upload image')
      setTimeout(() => setError(null), 3000)
    } finally {
      setUploadingImage(false)
    }
  }

  // Handle file picker upload
  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
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
      setError(err instanceof Error ? err.message : 'Failed to upload image')
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

      const extensionMap: Record<string, string> = {
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
      setError(err instanceof Error ? err.message : 'Failed to read image from clipboard')
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
      setError(err instanceof Error ? err.message : String(err))
      setStatus(null)
      setIsLoading(false)
    }
  }

  // When hidden, show only a small expand tab
  if (isHidden) {
    return (
      <div
        id="bottom-panel"
        className={`panel panel-bottom collapsed absolute bg-dark/95 border border-hud/30 -z-3 flex flex-col overflow-hidden left-[10%] top-[95%] w-4/5 h-0 border-t-0 rounded-b-lg ${isOpen ? 'open' : ''}`}
        onClick={handleClick}
      >
        <div
          className="group/toggle flex justify-start items-center pl-[25%] h-[6cqh] cursor-pointer bg-hud/6 border-b border-hud/15 transition-[background] duration-200 ease-in-out shrink-0 hover:bg-hud/12"
          onClick={onToggleHidden}
          title="Show panel"
        >
          <svg
            className="w-[3cqw] h-[3cqw] text-hud/60 transition-colors duration-200 ease-in-out group-hover/toggle:text-hud"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    )
  }

  return (
    <div
      id="bottom-panel"
      className={`panel panel-bottom absolute bg-dark/95 border border-hud/30 -z-3 flex flex-col overflow-hidden left-[10%] top-[95%] w-4/5 h-0 border-t-0 rounded-b-lg ${isOpen ? 'open' : ''}`}
      onClick={handleClick}
    >
      {/* Toggle button to hide panel */}
      <div
        className="group/toggle flex justify-start items-center pl-[25%] h-[6cqh] cursor-pointer bg-hud/6 border-b border-hud/15 transition-[background] duration-200 ease-in-out shrink-0 hover:bg-hud/12"
        onClick={onToggleHidden}
        title="Hide panel"
      >
        <svg
          className="w-[3cqw] h-[3cqw] text-hud/60 transition-colors duration-200 ease-in-out group-hover/toggle:text-hud"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="panel-content flex-1 flex flex-row items-stretch gap-0 h-full overflow-hidden py-[1cqh] pr-[2cqw] pl-0">
        {/* Vertical tab bar on left - only shown when more than one tab is available */}
        {availableTabs.length > 1 && (
          <div className="flex flex-col gap-[0.5cqh] py-[0.5cqh] px-[0.8cqw] shrink-0">
            {availableTabs.map((tab) => (
              <button
                key={tab.id}
                className={`w-[3cqw] h-[3cqw] min-w-7 min-h-7 p-0 flex items-center justify-center text-hud/40 bg-hud/3 border border-hud/15 rounded-[0.4cqw] cursor-pointer transition-all duration-200 ease-in-out [&>svg]:w-[60%] [&>svg]:h-[60%] hover:text-hud/80 hover:bg-hud/8 hover:border-hud/30 ${activeTab === tab.id ? 'active text-hud bg-hud/12 !border-hud/50' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                title={tab.title}
              >
                {tab.icon}
              </button>
            ))}
          </div>
        )}

        {/* Tab content area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* Prompt tab content */}
          {activeTab === 'prompt' && (
            <div className="flex-1 flex flex-col bg-hud/4 border border-hud/15 rounded-[0.5cqw] overflow-hidden min-h-0 transition-[border-color,background,box-shadow] duration-200 ease-in-out hover:border-hud/30 hover:bg-hud/6 focus-within:border-hud/50 focus-within:bg-hud/8 focus-within:shadow-[0_0_0_1px_rgba(120,255,245,0.1)]">
              <textarea
                ref={textareaRef}
                className="prompt-input-compact flex-1 w-full min-h-[4cqh] py-[1cqh] px-[1.5cqw] font-mono text-[1.5cqw] leading-[1.4] text-[rgba(230,255,255,0.9)] bg-transparent border-none outline-none resize-none overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:rgba(120,255,245,0.3)_transparent] disabled:opacity-70 disabled:cursor-not-allowed"
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
              <div className="flex flex-row justify-end items-center gap-[1.2cqw] py-[0.8cqh] px-[1cqw] shrink-0">
                {/* Mouse sensitivity slider */}
                <div className="flex items-center gap-[0.5cqw] group">
                  <span className="font-mono text-[1.4cqw] text-hud/50 tracking-[0.05em] uppercase transition-colors duration-200 ease-in-out group-hover:text-hud">
                    MOUSE SENS
                  </span>
                  <div className="flex items-center gap-0 min-w-[6cqw]">
                    <div className="group/slider relative flex-1 min-w-[6cqw] h-[1cqh] cursor-pointer">
                      <input
                        type="range"
                        className="absolute w-full h-full opacity-0 cursor-pointer z-2"
                        min="0.1"
                        max="3.0"
                        step="0.1"
                        value={mouseSensitivity}
                        onChange={(e) => setMouseSensitivity(parseFloat(e.target.value))}
                        onClick={handleClick}
                        title="Mouse sensitivity"
                      />
                      <div className="sensitivity-track absolute inset-0 pointer-events-none group-hover/slider:[background:repeating-linear-gradient(90deg,rgba(120,255,245,0.18)_0,rgba(120,255,245,0.18)_6px,transparent_6px,transparent_8px)]"></div>
                      <div
                        className="sensitivity-fill absolute left-0 top-0 bottom-0 pointer-events-none overflow-hidden min-w-0 group-hover/slider:[background:repeating-linear-gradient(90deg,rgba(120,255,245,0.45)_0,rgba(120,255,245,0.45)_6px,transparent_6px,transparent_8px)]"
                        style={{ width: `${((mouseSensitivity - 0.1) / (3.0 - 0.1)) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                  <span className="font-mono text-[1.4cqw] min-w-[2.5cqw] text-hud/80 tracking-[0.05em] text-right transition-colors duration-200 ease-in-out group-hover:text-hud">
                    {mouseSensitivity.toFixed(1)}
                  </span>
                </div>

                <div className="w-px h-[1.5cqw] min-h-3 bg-hud/20 mx-[0.3cqw]"></div>

                {/* Reset world button */}
                <div
                  className="group flex items-center gap-[0.3cqw] cursor-pointer"
                  onClick={handleResetWorld}
                  title={`Reset world (${RESET_KEY_DISPLAY})`}
                >
                  <span
                    ref={resetButtonRef}
                    className="shrink-0 w-[2cqw] h-[2cqw] min-w-[18px] min-h-[18px] flex items-center justify-center p-0 bg-transparent border-none text-hud/60 cursor-pointer transition-all duration-200 ease-in-out [&>svg]:w-full [&>svg]:h-full group-hover:text-hud active:scale-95"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path
                        d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="font-mono text-[1.4cqw] min-w-max text-hud/50 tracking-[0.05em] uppercase transition-colors duration-200 ease-in-out group-hover:text-hud">
                    RESET({RESET_KEY_DISPLAY})
                  </span>
                </div>

                {/* Logout button */}
                <div
                  className="group flex items-center gap-[0.3cqw] cursor-pointer"
                  onClick={handleLogout}
                  title="Logout"
                >
                  <span className="shrink-0 w-[2cqw] h-[2cqw] min-w-[18px] min-h-[18px] flex items-center justify-center p-0 bg-transparent border-none text-hud/60 cursor-pointer transition-all duration-200 ease-in-out [&>svg]:w-full [&>svg]:h-full group-hover:text-[rgba(255,120,120,1)] active:scale-95">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points="16,17 21,12 16,7" strokeLinecap="round" strokeLinejoin="round" />
                      <line x1="21" y1="12" x2="9" y2="12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="font-mono text-[1.4cqw] min-w-max text-hud/50 tracking-[0.05em] uppercase transition-colors duration-200 ease-in-out group-hover:text-[rgba(255,120,120,1)]">
                    EXIT
                  </span>
                </div>

                {/* Submit button */}
                <div
                  className={`group flex items-center gap-[0.3cqw] cursor-pointer ${isLoading || !textPrompt.trim() || isDisabledByConfig ? 'cursor-not-allowed opacity-30' : ''}`}
                  onClick={() => !(isLoading || !textPrompt.trim() || isDisabledByConfig) && applyPrompt()}
                  title={isDisabledByConfig ? disabledMessage : 'Apply prompt'}
                >
                  <span
                    ref={promptButtonRef}
                    className={`prompt-submit-btn shrink-0 w-[2cqw] h-[2cqw] min-w-[18px] min-h-[18px] flex items-center justify-center p-0 bg-transparent border-none text-hud/60 cursor-pointer transition-all duration-200 ease-in-out [&>svg]:w-full [&>svg]:h-full group-hover:text-hud ${isLoading || !textPrompt.trim() || isDisabledByConfig ? 'opacity-30 cursor-not-allowed group-hover:text-hud/50' : ''}`}
                  >
                    {isLoading ? (
                      <svg
                        className="animate-[spinPrompt_1s_linear_infinite]"
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
                  <span
                    className={`font-mono text-[1.4cqw] min-w-max text-hud/50 tracking-[0.05em] uppercase transition-colors duration-200 ease-in-out group-hover:text-hud ${isLoading || !textPrompt.trim() || isDisabledByConfig ? 'group-hover:text-hud/50' : ''}`}
                  >
                    APPLY
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Seeds tab content - only rendered when seed gallery is enabled */}
          {seedGalleryEnabled && activeTab === 'seeds' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                style={{ display: 'none' }}
              />

              <div className="seeds-gallery flex-1 flex flex-wrap content-start gap-[0.6cqw] overflow-y-auto overflow-x-hidden p-[0.5cqw] bg-black/15 border border-hud/10 rounded-[0.4cqw] min-h-0">
                {/* Upload button - always first */}
                <div
                  className={`relative w-[8cqw] h-[8cqw] min-w-[60px] min-h-[60px] border-2 border-dashed border-hud/20 rounded-[0.3cqw] overflow-hidden cursor-pointer transition-all duration-200 ease-in-out bg-black/30 hover:border-hud/60 hover:shadow-[0_0_8px_rgba(120,255,245,0.3)] hover:scale-105 hover:bg-hud/5 ${uploadingImage ? 'uploading' : ''} ${seedsDisabled ? 'disabled opacity-40 cursor-not-allowed pointer-events-none' : ''}`}
                  title={seedsDisabled ? 'Wait to upload...' : ''}
                >
                  {uploadingImage ? (
                    <div className="w-full h-full flex items-center justify-center text-hud/30 [&>svg]:w-1/2 [&>svg]:h-1/2">
                      <svg
                        className="animate-spin"
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
                    <div className="relative w-full h-full">
                      <button
                        type="button"
                        className="seed-upload-top absolute inset-0 border-none p-0 m-0 bg-transparent text-hud/45 flex items-center justify-center cursor-pointer transition-[color,background] duration-200 ease-in-out [&>svg]:w-[46%] [&>svg]:h-[46%] hover:text-hud/95 hover:bg-hud/8"
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
                        className="seed-upload-bottom absolute inset-0 border-none p-0 m-0 bg-transparent text-hud/45 flex items-center justify-center cursor-pointer transition-[color,background] duration-200 ease-in-out [&>svg]:w-[46%] [&>svg]:h-[46%] hover:text-hud/95 hover:bg-hud/8"
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
                  <div className="w-full py-[2cqh] text-center font-mono text-[1.2cqw] text-hud/50">
                    Loading seeds...
                  </div>
                ) : seeds.length === 0 ? (
                  <div className="w-full py-[2cqh] text-center font-mono text-[1.2cqw] text-hud/50">No seeds found</div>
                ) : (
                  seeds.map((seed) => (
                    <div
                      key={seed.filename}
                      className={`group/seed relative w-[8cqw] h-[8cqw] min-w-[60px] min-h-[60px] border border-hud/20 rounded-[0.3cqw] overflow-hidden cursor-pointer transition-all duration-200 ease-in-out bg-black/30 hover:border-hud/60 hover:shadow-[0_0_8px_rgba(120,255,245,0.3)] hover:scale-105 [&>img]:w-full [&>img]:h-full [&>img]:object-cover ${selectedSeed === seed.filename ? 'selected !border-hud shadow-[0_0_12px_rgba(120,255,245,0.5)]' : ''} ${seedsDisabled ? 'disabled opacity-40 cursor-not-allowed pointer-events-none' : ''} ${!seed.is_safe ? 'unsafe !border-[rgba(255,80,80,0.3)] opacity-40 grayscale hover:!border-[rgba(255,80,80,0.7)] hover:shadow-[0_0_8px_rgba(255,80,80,0.3)] hover:opacity-70 hover:grayscale-[0.8]' : ''}`}
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
                          className="absolute top-[0.25cqw] right-[0.25cqw] w-[1.35cqw] h-[1.35cqw] min-w-[18px] min-h-[18px] border border-[rgba(255,120,120,0.65)] rounded-full bg-[rgba(8,8,8,0.72)] text-[rgba(255,150,150,0.95)] flex items-center justify-center p-0 cursor-pointer z-3 opacity-0 pointer-events-none group-hover/seed:opacity-100 group-hover/seed:pointer-events-auto transition-[background,color,border-color,transform] duration-200 ease-in-out [&>svg]:w-[62%] [&>svg]:h-[62%] hover:bg-[rgba(160,35,35,0.85)] hover:text-[rgba(255,220,220,1)] hover:border-[rgba(255,160,160,0.95)] hover:scale-[1.08] disabled:opacity-40 disabled:cursor-not-allowed"
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
                        <div className="w-full h-full flex items-center justify-center text-hud/30 [&>svg]:w-1/2 [&>svg]:h-1/2">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21,15 16,10 5,21" />
                          </svg>
                        </div>
                      )}
                      {!seed.is_safe && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[rgba(255,100,100,0.9)] [&>svg]:w-[40%] [&>svg]:h-[40%]">
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
          {error && (
            <div className="absolute -bottom-[4cqh] left-0 right-0 py-[0.6cqh] px-[1.5cqw] font-mono text-[1.1cqw] text-[#ff6b6b] bg-[rgba(255,80,80,0.15)] border border-[rgba(255,80,80,0.3)] rounded-[0.5cqw] text-center">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Seed rejection modal */}
      <div
        className={`seed-rejected-overlay absolute inset-0 z-[150] pointer-events-none opacity-0 invisible bg-darkest/85 backdrop-blur-[4px] flex items-center justify-center ${rejectedSeed ? 'active' : ''}`}
      >
        <div className="flex flex-col items-center gap-[1cqh] py-[1cqh] px-[2cqw] animate-[seedRejectedFadeIn_0.4s_ease-out]">
          <div className="flex items-center gap-[0.5cqw]">
            <svg
              className="w-[1.6cqw] h-[1.6cqw] min-w-4 min-h-4 shrink-0 text-[rgba(255,100,100,0.9)] animate-[seedRejectedPulse_2s_ease-in-out_infinite]"
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
            <span className="font-mono text-[1.3cqw] font-bold tracking-[0.15em] whitespace-nowrap text-[rgba(255,100,100,0.95)] [text-shadow:0_0_12px_rgba(255,100,100,0.5)]">
              SEED REJECTED
            </span>
          </div>
          <span className="font-mono text-[0.9cqw] text-white/60 leading-[1.4] [&>strong]:text-white/85">
            <strong>{rejectedSeed?.filename}</strong> was flagged as inappropriate. Click the greyed-out seed to remove
            it.
          </span>
          <button
            className="py-[0.5cqh] px-[1.5cqw] font-mono text-[0.9cqw] font-medium tracking-[0.1em] uppercase text-hud/90 bg-hud/10 border border-hud/40 rounded-[0.4cqw] cursor-pointer transition-all duration-200 ease-in-out hover:text-hud hover:bg-hud/20 hover:border-hud/60 hover:shadow-[0_0_20px_rgba(120,255,245,0.3)] active:scale-[0.97] active:bg-hud/25"
            onClick={() => setRejectedSeed(null)}
          >
            DISMISS
          </button>
        </div>
      </div>
    </div>
  )
}

export default BottomPanel
