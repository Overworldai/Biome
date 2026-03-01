import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { invoke } from '../bridge'
import { useStreaming } from '../context/StreamingContext'
import type { SeedRecord, SeedRecordWithThumbnail } from '../types/app'
import SocialCtaRow from './SocialCtaRow'
import MenuSettingsView from './MenuSettingsView'
import ViewLabel from './ui/ViewLabel'
import MenuButton from './ui/MenuButton'
import { useConfig } from '../hooks/useConfig'

const PINNED_SCENES_KEY = 'biome_pinned_scenes'

const PauseOverlay = ({ isActive }: { isActive: boolean }) => {
  const {
    canUnpause,
    unlockDelayMs,
    pauseElapsedMs,
    pointerLockBlockedSeq,
    requestPointerLock,
    reset,
    sendPromptWithSeed
  } = useStreaming()
  const { config, isLoaded, saveConfig, getUrl } = useConfig()
  const [view, setView] = useState<'main' | 'scenes' | 'settings'>('main')
  const [seeds, setSeeds] = useState<SeedRecord[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pinnedSceneIds, setPinnedSceneIds] = useState<string[]>([])
  const [showUnlockHint, setShowUnlockHint] = useState(false)
  const lastPointerLockBlockedSeqRef = useRef(0)
  const loadingRef = useRef(false)
  const isMountedRef = useRef(true)
  const hasHydratedPinnedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadBaseUrl = getUrl()

  const loadSeedsAndThumbnails = useCallback(async () => {
    let seedList: SeedRecordWithThumbnail[] = []
    const batchedResult = await invoke('list-seeds-with-thumbnails')

    if (Array.isArray(batchedResult)) {
      seedList = batchedResult
    }

    // Fallback to metadata-only endpoint if batched endpoint returns no entries.
    if (seedList.length === 0) {
      const basicSeeds = await invoke('list-seeds')
      seedList = basicSeeds.map((seed) => ({ ...seed, thumbnail_base64: null }))
    }

    console.log(`[PauseOverlay] Loaded ${seedList.length} seeds`)
    setSeeds(seedList.map(({ filename, is_safe, is_default }) => ({ filename, is_safe, is_default })))

    if (!isMountedRef.current) return
    setUploadError(null)

    try {
      const nextThumbs: Record<string, string> = Object.fromEntries(
        seedList
          .filter((seed) => Boolean(seed.thumbnail_base64))
          .map((seed) => [seed.filename, `data:image/jpeg;base64,${seed.thumbnail_base64}`])
      )

      // Fallback: fetch thumbnails for visible items that came back without inline thumb data.
      const visibleSeeds = seedList.slice(0, 14)
      const missingVisible = visibleSeeds.filter((seed) => !nextThumbs[seed.filename])
      if (missingVisible.length > 0) {
        const fetchedThumbs = await Promise.all(
          missingVisible.map(async (seed) => {
            try {
              const b64 = await invoke('read-seed-thumbnail', seed.filename, 180)
              return [seed.filename, `data:image/jpeg;base64,${b64}`] as const
            } catch {
              return null
            }
          })
        )
        for (const entry of fetchedThumbs) {
          if (!entry) continue
          nextThumbs[entry[0]] = entry[1]
        }
      }

      if (!isMountedRef.current) return
      setThumbnails(nextThumbs)
    } catch (thumbErr) {
      console.error('[PauseOverlay] Thumbnail hydration failed:', thumbErr)
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!isActive || loadingRef.current) return
    loadingRef.current = true
    let cancelled = false

    const loadVisibleSeeds = async () => {
      try {
        await loadSeedsAndThumbnails()
      } catch (err) {
        if (!cancelled) {
          console.error('[PauseOverlay] Failed to load seeds/thumbnails:', err)
          setUploadError(err instanceof Error ? err.message : 'Failed to load scenes')
        }
      } finally {
        loadingRef.current = false
      }
    }

    void loadVisibleSeeds()
    return () => {
      cancelled = true
      loadingRef.current = false
    }
  }, [isActive, loadSeedsAndThumbnails])

  useEffect(() => {
    if (!isActive) {
      setView('main')
      setShowUnlockHint(false)
      return
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (view === 'scenes' || view === 'settings') {
        setView('main')
      } else {
        requestPointerLock()
      }
    }

    window.addEventListener('keyup', handleKeyUp)
    return () => window.removeEventListener('keyup', handleKeyUp)
  }, [isActive, view, requestPointerLock])

  useEffect(() => {
    if (!showUnlockHint) return
    const timer = window.setTimeout(() => setShowUnlockHint(false), 1200)
    return () => window.clearTimeout(timer)
  }, [showUnlockHint])

  useEffect(() => {
    if (canUnpause) {
      setShowUnlockHint(false)
    }
  }, [canUnpause])

  useEffect(() => {
    if (!isActive) return
    if (pointerLockBlockedSeq <= 0) return
    if (pointerLockBlockedSeq === lastPointerLockBlockedSeqRef.current) return
    lastPointerLockBlockedSeqRef.current = pointerLockBlockedSeq
    setShowUnlockHint(true)
  }, [isActive, pointerLockBlockedSeq])

  useEffect(() => {
    if (!isLoaded || hasHydratedPinnedRef.current) return

    const fromConfig = Array.isArray(config.features?.pinned_scenes)
      ? config.features.pinned_scenes.filter((value) => typeof value === 'string')
      : []

    if (fromConfig.length > 0) {
      setPinnedSceneIds(fromConfig)
      hasHydratedPinnedRef.current = true
      return
    }

    // One-time migration fallback from localStorage to config persistence.
    try {
      const raw = localStorage.getItem(PINNED_SCENES_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const migrated = parsed.filter((value) => typeof value === 'string')
          setPinnedSceneIds(migrated)
        }
      }
    } catch {
      // Ignore malformed legacy storage.
    }

    hasHydratedPinnedRef.current = true
  }, [isLoaded, config.features?.pinned_scenes])

  useEffect(() => {
    if (!isLoaded || !hasHydratedPinnedRef.current) return

    const currentPinned = Array.isArray(config.features?.pinned_scenes) ? config.features.pinned_scenes : []
    const nextPinned = pinnedSceneIds

    if (JSON.stringify(currentPinned) === JSON.stringify(nextPinned)) return

    void saveConfig({
      ...config,
      features: {
        ...config.features,
        pinned_scenes: nextPinned
      }
    })
  }, [pinnedSceneIds, isLoaded, config, saveConfig])

  const pinnedScenes = useMemo(() => seeds.filter((s) => pinnedSceneIds.includes(s.filename)), [seeds, pinnedSceneIds])
  const sceneList = useMemo(() => seeds, [seeds])
  const pauseLockoutRemainingMs = Math.max(0, unlockDelayMs - pauseElapsedMs)
  const showPauseLockoutTimer = isActive && !canUnpause && pauseLockoutRemainingMs > 0 && showUnlockHint
  const pauseLockoutSecondsText = (pauseLockoutRemainingMs / 1000).toFixed(1)

  const handleSceneSelect = (filename: string) => {
    sendPromptWithSeed(filename)
    requestPointerLock()
  }

  const handleResetAndResume = () => {
    reset()
    requestPointerLock()
  }

  const refreshSeeds = useCallback(async () => {
    await loadSeedsAndThumbnails()
  }, [loadSeedsAndThumbnails])

  const togglePinnedScene = (filename: string) => {
    setPinnedSceneIds((prev) => {
      if (prev.includes(filename)) {
        return prev.filter((id) => id !== filename)
      }
      return [filename, ...prev]
    })
  }

  const removeScene = async (seed: SeedRecord) => {
    if (seed.is_default) return
    try {
      await invoke('delete-seed', seed.filename)
      setPinnedSceneIds((prev) => prev.filter((id) => id !== seed.filename))
      await refreshSeeds()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to remove scene')
    }
  }

  const readBlobAsBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event: ProgressEvent<FileReader>) => {
        const result = event.target?.result
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
    setUploadError(null)
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

      await refreshSeeds()
    } finally {
      setUploadingImage(false)
    }
  }

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file')
      event.target.value = ''
      return
    }

    try {
      const base64Data = await readBlobAsBase64(file)
      await uploadSeedData(file.name, base64Data)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload image')
    }

    event.target.value = ''
  }

  const handleClipboardUpload = async () => {
    if (uploadingImage) return
    if (!navigator.clipboard?.read) {
      setUploadError('Clipboard image upload is not supported')
      return
    }

    try {
      const clipboardItems = await navigator.clipboard.read()
      let imageBlob: Blob | null = null
      let imageType = ''

      for (const item of clipboardItems) {
        const matchingType = item.types.find((type) => type.startsWith('image/'))
        if (matchingType) {
          imageBlob = await item.getType(matchingType)
          imageType = matchingType
          break
        }
      }

      if (!imageBlob) throw new Error('No image found in clipboard')

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
      setUploadError(err instanceof Error ? err.message : 'Failed to read image from clipboard')
    }
  }

  return (
    <div
      className={`absolute inset-0 z-45 transition-opacity duration-[240ms] ease-in-out bg-black/[0.34] backdrop-blur-[7px] ${isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      id="pause-overlay"
    >
      <div className="absolute inset-0 pointer-events-none [background:repeating-linear-gradient(0deg,transparent_0px,transparent_2px,rgba(255,255,255,0.04)_2px,rgba(255,255,255,0.04)_4px)]"></div>
      {view === 'settings' ? (
        <div className="absolute inset-0">
          <MenuSettingsView onBack={() => setView('main')} />
        </div>
      ) : view === 'main' ? (
        <div className="absolute inset-0 p-[3.8%_4%]">
          <SocialCtaRow rowClassName="pause-cta-row" />

          <section className="absolute top-[var(--edge-top-xl)] left-[var(--edge-left)] w-[70%] flex flex-col gap-[0.7cqh]">
            <h2 className="m-0 font-serif text-heading text-text-primary font-normal text-left">Pinned Scenes</h2>
            <p className="m-0 font-serif text-caption text-text-muted max-w-[103.12cqh] text-left">
              Your pinned scenes. Use the Scenes button to pin scenes, or drag/paste an image in to play it.
            </p>
            <div className="pause-scene-scroll pause-scene-scroll-pinned mt-[0.7cqh]">
              <div className="pause-scene-grid">
                {pinnedScenes.length > 0 ? (
                  pinnedScenes.map((seed) => (
                    <button
                      type="button"
                      key={`pinned-${seed.filename}`}
                      className="pause-scene-card group/scene relative"
                      title={seed.filename}
                      onClick={() => handleSceneSelect(seed.filename)}
                    >
                      <img
                        className="w-full h-full object-cover block"
                        src={thumbnails[seed.filename] || ''}
                        alt={seed.filename}
                      />
                      <span className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 transition-opacity duration-[140ms] ease-in-out group-hover/scene:opacity-100">
                        <span
                          role="button"
                          tabIndex={0}
                          className="pause-scene-action is-pinned"
                          title="Unpin scene"
                          onClick={(event) => {
                            event.stopPropagation()
                            togglePinnedScene(seed.filename)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              event.stopPropagation()
                              togglePinnedScene(seed.filename)
                            }
                          }}
                        >
                          <svg
                            className="w-[66%] h-[66%]"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="10.6" r="4.1" />
                            <circle cx="12" cy="10.6" r="1.55" fill="currentColor" stroke="none" />
                            <path d="M12 14.7v2.35" />
                            <path d="M10.98 16.9L12 19.1 13.02 16.95z" fill="currentColor" stroke="none" />
                          </svg>
                        </span>
                        {!seed.is_default && (
                          <span
                            role="button"
                            tabIndex={0}
                            className="pause-scene-action is-delete"
                            title="Remove scene"
                            onClick={(event) => {
                              event.stopPropagation()
                              void removeScene(seed)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                event.stopPropagation()
                                void removeScene(seed)
                              }
                            }}
                          >
                            <svg
                              className="w-[66%] h-[66%]"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M3 6h18" />
                              <path d="M8 6V4h8v2" />
                              <rect x="6.5" y="6.5" width="11" height="13" rx="1.5" />
                              <path d="M10 10v6" />
                              <path d="M14 10v6" />
                            </svg>
                          </span>
                        )}
                      </span>
                    </button>
                  ))
                ) : (
                  <div
                    className="pause-scene-card pause-scene-card-empty relative grid place-items-center"
                    aria-hidden="true"
                  >
                    <svg
                      className="w-[36%] h-[36%] text-[rgba(245,249,255,0.5)]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.4" />
                      <polyline points="21,15 16,10 5,21" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          </section>

          <ViewLabel>
            <span className="inline-flex items-end gap-[1.42cqh]">
              <span>Paused</span>
              <span
                className={`self-end font-serif text-[2.13cqh] leading-[1.0] tracking-[0.03em] text-[rgba(245,249,255,0.62)] transition-opacity duration-120 ${
                  showPauseLockoutTimer
                    ? 'opacity-100 [animation:pauseUnlockHintPulse_1200ms_ease-out_forwards]'
                    : 'opacity-0'
                }`}
              >
                {showPauseLockoutTimer ? `unlock in ${pauseLockoutSecondsText}s` : ''}
              </span>
            </span>
          </ViewLabel>

          <div className="absolute right-[var(--edge-right)] bottom-[var(--edge-bottom)] w-btn-w flex flex-col gap-[1.1cqh]">
            <MenuButton variant="secondary" className="w-full px-0" onClick={handleResetAndResume}>
              Reset
            </MenuButton>
            <MenuButton variant="secondary" className="w-full px-0" onClick={() => setView('scenes')}>
              Scenes
            </MenuButton>
            <MenuButton variant="secondary" className="w-full px-0" onClick={() => setView('settings')}>
              Settings
            </MenuButton>
            <MenuButton variant="primary" className="w-full px-0" onClick={requestPointerLock}>
              Resume
            </MenuButton>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 p-[3.8%_4%] z-[2]">
          <section className="absolute top-[var(--edge-top-xl)] left-[var(--edge-left)] w-[70%] z-[3]">
            <h2 className="m-0 font-serif text-heading text-text-primary font-normal text-left">Scenes</h2>
            <p className="m-0 font-serif text-caption text-text-muted max-w-[103.12cqh] text-left">
              All of your scenes. Add more by using the + button, or by drag/pasting them in.
            </p>
            <p className="m-0 mt-[0.4cqh] font-serif text-[1.96cqh] text-[rgba(245,249,255,0.7)]">
              Scenes loaded: {sceneList.length}
            </p>
            {uploadError && <p className="!mt-[0.6cqh] !text-[rgba(255,180,180,0.92)]">{uploadError}</p>}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            <div className="pause-scene-scroll pause-scene-scroll-main mt-[1.1cqh] relative z-[4]">
              <div className="pause-scene-grid w-full">
                <button
                  type="button"
                  className={`pause-scene-add-card grid grid-cols-2 ${uploadingImage ? 'opacity-60 pointer-events-none' : ''}`}
                  onClick={(event) => event.preventDefault()}
                >
                  <span
                    className="grid place-items-center font-serif text-small text-text-secondary cursor-pointer"
                    onClick={() => void handleClipboardUpload()}
                    title="Paste image from clipboard"
                  >
                    <svg
                      className="w-[2.67cqh] h-[2.67cqh]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <rect x="9" y="3" width="6" height="4" rx="1" />
                      <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
                      <rect x="12" y="10" width="8" height="10" rx="1" />
                    </svg>
                  </span>
                  <span
                    className="grid place-items-center font-serif text-small text-text-secondary cursor-pointer border-l border-[rgba(245,249,255,0.35)]"
                    onClick={() => fileInputRef.current?.click()}
                    title="Browse for image file"
                  >
                    <svg
                      className="w-[2.67cqh] h-[2.67cqh]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path
                        d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
                      <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
                {sceneList.map((seed) => (
                  <button
                    type="button"
                    key={`scene-${seed.filename}`}
                    className="pause-scene-card group/scene relative z-[5]"
                    title={seed.filename}
                    onClick={() => handleSceneSelect(seed.filename)}
                  >
                    <img
                      className="w-full h-full object-cover block"
                      src={thumbnails[seed.filename] || ''}
                      alt={seed.filename}
                    />
                    <span className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 transition-opacity duration-[140ms] ease-in-out group-hover/scene:opacity-100">
                      <span
                        role="button"
                        tabIndex={0}
                        className={`pause-scene-action ${pinnedSceneIds.includes(seed.filename) ? 'is-pinned' : 'is-default'}`}
                        title={pinnedSceneIds.includes(seed.filename) ? 'Unpin scene' : 'Pin scene'}
                        onClick={(event) => {
                          event.stopPropagation()
                          togglePinnedScene(seed.filename)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            event.stopPropagation()
                            togglePinnedScene(seed.filename)
                          }
                        }}
                      >
                        {pinnedSceneIds.includes(seed.filename) ? (
                          <svg
                            className="w-[66%] h-[66%]"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="10.6" r="4.1" />
                            <circle cx="12" cy="10.6" r="1.55" fill="currentColor" stroke="none" />
                            <path d="M12 14.7v2.35" />
                            <path d="M10.98 16.9L12 19.1 13.02 16.95z" fill="currentColor" stroke="none" />
                          </svg>
                        ) : (
                          <svg
                            className="w-[66%] h-[66%]"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <g transform="rotate(-36 12 12)">
                              <rect x="9.25" y="4.1" width="5.5" height="5.6" rx="1.2" />
                              <path d="M7.5 9.7h9l-4.5 4.55z" />
                              <path d="M12 14.2v5.1" />
                              <path d="M10.92 19.1L12 22 13.08 19.15z" fill="currentColor" stroke="none" />
                            </g>
                          </svg>
                        )}
                      </span>
                      {!seed.is_default && (
                        <span
                          role="button"
                          tabIndex={0}
                          className="pause-scene-action is-delete"
                          title="Remove scene"
                          onClick={(event) => {
                            event.stopPropagation()
                            void removeScene(seed)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              event.stopPropagation()
                              void removeScene(seed)
                            }
                          }}
                        >
                          <svg
                            className="w-[66%] h-[66%]"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <rect x="6.5" y="6.5" width="11" height="13" rx="1.5" />
                            <path d="M10 10v6" />
                            <path d="M14 10v6" />
                          </svg>
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
          <MenuButton
            variant="primary"
            className="absolute right-[var(--edge-right)] bottom-[var(--edge-bottom)] w-btn-w px-0"
            onClick={() => setView('main')}
          >
            Back
          </MenuButton>
        </div>
      )}
    </div>
  )
}

export default PauseOverlay
