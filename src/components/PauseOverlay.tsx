import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { invoke } from '../bridge'
import { usePortal } from '../context/PortalContext'
import { useStreaming } from '../context/StreamingContext'
import type { SeedRecord } from '../types/app'
import SocialCtaRow from './SocialCtaRow'
import { useConfig } from '../hooks/useConfig'

const MAX_THUMBNAILS = 24
const PINNED_SCENES_KEY = 'biome_pinned_scenes'

const PauseOverlay = ({ isActive }: { isActive: boolean }) => {
  const { toggleSettings } = usePortal()
  const { canUnpause, requestPointerLock, reset, sendPromptWithSeed } = useStreaming()
  const { getUrl } = useConfig()
  const [view, setView] = useState<'main' | 'scenes'>('main')
  const [seeds, setSeeds] = useState<SeedRecord[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pinnedSceneIds, setPinnedSceneIds] = useState<string[]>([])
  const loadingRef = useRef(false)
  const isMountedRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadBaseUrl = getUrl()

  const loadSeedsAndThumbnails = useCallback(async () => {
    const seedList = await invoke('list-seeds')
    const nextThumbs: Record<string, string> = {}
    await Promise.all(
      seedList.slice(0, MAX_THUMBNAILS).map(async (seed) => {
        try {
          const b64 = await invoke('read-seed-thumbnail', seed.filename, 180)
          nextThumbs[seed.filename] = `data:image/jpeg;base64,${b64}`
        } catch {
          // Ignore individual thumbnail failures.
        }
      })
    )
    if (!isMountedRef.current) return
    setSeeds(seedList)
    setThumbnails(nextThumbs)
  }, [])

  useEffect(() => {
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
      } catch {
        if (!cancelled) setSeeds([])
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
      return
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (view === 'scenes') {
        setView('main')
      } else if (canUnpause) {
        requestPointerLock()
      }
    }

    window.addEventListener('keyup', handleKeyUp)
    return () => window.removeEventListener('keyup', handleKeyUp)
  }, [isActive, view, canUnpause, requestPointerLock])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_SCENES_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setPinnedSceneIds(parsed.filter((v) => typeof v === 'string'))
      }
    } catch {
      // Ignore malformed storage.
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(PINNED_SCENES_KEY, JSON.stringify(pinnedSceneIds))
  }, [pinnedSceneIds])

  const pinnedScenes = useMemo(
    () => seeds.filter((s) => pinnedSceneIds.includes(s.filename)).slice(0, 5),
    [seeds, pinnedSceneIds]
  )
  const sceneList = useMemo(() => seeds.slice(0, 14), [seeds])

  const handleSceneSelect = (filename: string) => {
    sendPromptWithSeed(filename)
    if (canUnpause) {
      requestPointerLock()
    }
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
      return [filename, ...prev].slice(0, 24)
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
      {view === 'main' ? (
        <div
          className="absolute inset-0 p-[3.8%_4%]"
          style={{ '--pause-bottom-baseline': '8%' } as React.CSSProperties}
        >
          <SocialCtaRow rowClassName="absolute right-[4%] top-[5%] flex gap-[0.6cqw]" />

          <section className="absolute top-[12%] left-[4%] w-[70%] flex flex-col gap-[0.7cqh]">
            <h2 className="m-0 font-serif text-[clamp(40px,4.4cqw,68px)] text-[rgba(248,248,245,0.95)] font-normal text-left">
              Pinned Scenes
            </h2>
            <p className="m-0 font-serif text-[clamp(16px,1.3cqw,22px)] text-[rgba(238,244,252,0.68)] max-w-[58cqw] text-left">
              Your favorite scenes. Use the Scenes button to set favorites, or drag/paste an image in to play it.
            </p>
            <div className="flex gap-[0.5cqw] mt-[0.5cqh]">
              {pinnedScenes.length > 0 ? (
                pinnedScenes.map((seed) => (
                  <button
                    type="button"
                    key={`pinned-${seed.filename}`}
                    className="relative w-[7.8cqw] min-w-24 aspect-video rounded-[0.35cqw] border border-[rgba(245,249,255,0.52)] bg-[rgba(4,7,12,0.5)] p-0 cursor-pointer overflow-hidden"
                    title={seed.filename}
                    onClick={() => handleSceneSelect(seed.filename)}
                  >
                    <img
                      className="w-full h-full object-cover block"
                      src={thumbnails[seed.filename] || ''}
                      alt={seed.filename}
                    />
                  </button>
                ))
              ) : (
                <div
                  className="relative w-[7.8cqw] min-w-24 aspect-video rounded-[0.35cqw] border border-dashed border-[rgba(245,249,255,0.42)] bg-[rgba(4,7,12,0.24)] p-0 overflow-hidden grid place-items-center"
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
          </section>

          <div className="absolute left-[4%] bottom-[var(--pause-bottom-baseline)] font-serif text-[clamp(56px,4.8cqw,82px)] leading-[0.8] text-left text-[rgba(248,248,245,0.95)] font-normal translate-y-[0.35cqh]">
            Paused
          </div>

          <div className="absolute right-[4%] bottom-[var(--pause-bottom-baseline)] w-[13cqw] min-w-[150px] flex flex-col gap-[1.1cqh]">
            <button
              type="button"
              className="w-full border border-[rgba(245,249,255,0.8)] bg-[rgba(248,248,245,0.95)] text-[rgba(18,22,30,0.95)] font-serif text-[clamp(22px,2.1cqw,34px)] leading-none py-[0.8cqh] px-0 rounded-none cursor-pointer"
              onClick={() => canUnpause && requestPointerLock()}
            >
              Resume
            </button>
            <button
              type="button"
              className="w-full border border-[rgba(245,249,255,0.8)] bg-[rgba(10,16,28,0.38)] text-[rgba(245,249,255,0.95)] font-serif text-[clamp(22px,2.1cqw,34px)] leading-none py-[0.8cqh] px-0 rounded-none cursor-pointer"
              onClick={handleResetAndResume}
            >
              Reset
            </button>
            <button
              type="button"
              className="w-full border border-[rgba(245,249,255,0.8)] bg-[rgba(10,16,28,0.38)] text-[rgba(245,249,255,0.95)] font-serif text-[clamp(22px,2.1cqw,34px)] leading-none py-[0.8cqh] px-0 rounded-none cursor-pointer"
              onClick={() => setView('scenes')}
            >
              Scenes
            </button>
            <button
              type="button"
              className="w-full border border-[rgba(245,249,255,0.8)] bg-[rgba(10,16,28,0.38)] text-[rgba(245,249,255,0.95)] font-serif text-[clamp(22px,2.1cqw,34px)] leading-none py-[0.8cqh] px-0 rounded-none cursor-pointer"
              onClick={toggleSettings}
            >
              Settings
            </button>
            <button
              type="button"
              className="w-full border border-[rgba(193,32,11,0.95)] bg-[rgba(156,23,8,0.9)] text-[rgba(255,240,240,0.98)] font-serif text-[clamp(22px,2.1cqw,34px)] leading-none py-[0.8cqh] px-0 rounded-none cursor-pointer"
              onClick={() => void invoke('quit-app')}
            >
              Quit
            </button>
          </div>
        </div>
      ) : (
        <div
          className="absolute inset-0 p-[3.8%_4%]"
          style={{ '--pause-bottom-baseline': '8%' } as React.CSSProperties}
        >
          <section className="absolute top-[12%] left-[4%] w-[70%]">
            <h2 className="m-0 font-serif text-[clamp(40px,4.4cqw,68px)] text-[rgba(248,248,245,0.95)] font-normal text-left">
              Scenes
            </h2>
            <p className="m-0 font-serif text-[clamp(16px,1.3cqw,22px)] text-[rgba(238,244,252,0.68)] max-w-[58cqw] text-left">
              All of your scenes. Add more by using the + button, or by drag/pasting them in.
            </p>
            {uploadError && <p className="!mt-[0.6cqh] !text-[rgba(255,180,180,0.92)]">{uploadError}</p>}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            <div className="mt-[1.1cqh] flex gap-[0.45cqw] flex-wrap w-full">
              <button
                type="button"
                className={`w-[7.8cqw] min-w-24 aspect-video border border-[rgba(245,249,255,0.84)] bg-[rgba(248,248,245,0.14)] p-0 grid grid-cols-2 overflow-hidden ${uploadingImage ? 'opacity-60 pointer-events-none' : ''}`}
                onClick={(event) => event.preventDefault()}
              >
                <span
                  className="grid place-items-center font-serif text-[clamp(14px,1.15cqw,19px)] text-[rgba(245,249,255,0.95)] cursor-pointer"
                  onClick={() => void handleClipboardUpload()}
                  title="Paste image from clipboard"
                >
                  <svg
                    className="w-[1.5cqw] min-w-4 h-[1.5cqw] min-h-4"
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
                  className="grid place-items-center font-serif text-[clamp(14px,1.15cqw,19px)] text-[rgba(245,249,255,0.95)] cursor-pointer border-l border-[rgba(245,249,255,0.35)]"
                  onClick={() => fileInputRef.current?.click()}
                  title="Browse for image file"
                >
                  <svg
                    className="w-[1.5cqw] min-w-4 h-[1.5cqw] min-h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
                    <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>
              {sceneList.map((seed) => (
                <button
                  type="button"
                  key={`scene-${seed.filename}`}
                  className="group/scene relative w-[7.8cqw] min-w-24 aspect-video rounded-[0.35cqw] border border-[rgba(245,249,255,0.52)] bg-[rgba(4,7,12,0.5)] p-0 cursor-pointer overflow-hidden"
                  title={seed.filename}
                  onClick={() => handleSceneSelect(seed.filename)}
                >
                  <img
                    className="w-full h-full object-cover block"
                    src={thumbnails[seed.filename] || ''}
                    alt={seed.filename}
                  />
                  <span className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity duration-[140ms] ease-in-out group-hover/scene:opacity-100">
                    <button
                      type="button"
                      className={`w-4 h-4 grid place-items-center border bg-[rgba(2,5,10,0.54)] text-[10px] leading-none rounded-none p-0 cursor-pointer ${pinnedSceneIds.includes(seed.filename) ? 'text-[rgba(255,237,127,0.96)] border-[rgba(255,237,127,0.9)]' : 'text-[rgba(245,249,255,0.92)] border-[rgba(245,249,255,0.7)]'}`}
                      title={pinnedSceneIds.includes(seed.filename) ? 'Unpin scene' : 'Pin scene'}
                      onClick={(event) => {
                        event.stopPropagation()
                        togglePinnedScene(seed.filename)
                      }}
                    >
                      *
                    </button>
                    {!seed.is_default && (
                      <button
                        type="button"
                        className="w-4 h-4 grid place-items-center border border-[rgba(255,170,170,0.82)] bg-[rgba(2,5,10,0.54)] text-[rgba(255,205,205,0.95)] text-[10px] leading-none rounded-none p-0 cursor-pointer"
                        title="Remove scene"
                        onClick={(event) => {
                          event.stopPropagation()
                          void removeScene(seed)
                        }}
                      >
                        x
                      </button>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>
          <button
            type="button"
            className="absolute right-[4%] bottom-[var(--pause-bottom-baseline)] w-[13cqw] min-w-[150px] border border-[rgba(245,249,255,0.8)] bg-[rgba(248,248,245,0.95)] text-[rgba(18,22,30,0.95)] font-serif text-[clamp(22px,2.1cqw,34px)] leading-none py-[0.8cqh] px-0 rounded-none cursor-pointer"
            onClick={() => setView('main')}
          >
            Back
          </button>
        </div>
      )}
    </div>
  )
}

export default PauseOverlay
