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
  const { canUnpause, requestPointerLock, reset, logout, sendPromptWithSeed } = useStreaming()
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
    }
  }, [isActive])

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
    <div className={`pause-overlay ${isActive ? 'active' : ''}`} id="pause-overlay">
      <div className="pause-scanlines"></div>
      {view === 'main' ? (
        <div className="pause-menu">
          <SocialCtaRow rowClassName="pause-cta-row" />

          <section className="pause-pinned">
            <h2>Pinned Scenes</h2>
            <p>Your favorite scenes. Use the Scenes button to set favorites, or drag/paste an image in to play it.</p>
            <div className="pause-scenes-row">
              {pinnedScenes.length > 0 ? (
                pinnedScenes.map((seed) => (
                  <button
                    type="button"
                    key={`pinned-${seed.filename}`}
                    className="pause-scene-card"
                    title={seed.filename}
                    onClick={() => handleSceneSelect(seed.filename)}
                  >
                    <img src={thumbnails[seed.filename] || ''} alt={seed.filename} />
                  </button>
                ))
              ) : (
                <div className="pause-scene-card pause-scene-card-empty" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.4" />
                    <polyline points="21,15 16,10 5,21" />
                  </svg>
                </div>
              )}
            </div>
          </section>

          <div className="pause-title">Paused</div>

          <div className="pause-actions">
            <button
              type="button"
              className="pause-action-btn primary"
              onClick={() => canUnpause && requestPointerLock()}
            >
              Resume
            </button>
            <button type="button" className="pause-action-btn" onClick={handleResetAndResume}>
              Reset
            </button>
            <button type="button" className="pause-action-btn" onClick={() => setView('scenes')}>
              Scenes
            </button>
            <button type="button" className="pause-action-btn" onClick={toggleSettings}>
              Settings
            </button>
            <button type="button" className="pause-action-btn danger" onClick={() => void logout()}>
              Quit
            </button>
          </div>
        </div>
      ) : (
        <div className="pause-scenes-view">
          <section className="pause-scenes-library">
            <h2>Scenes</h2>
            <p>All of your scenes. Add more by using the + button, or by drag/pasting them in.</p>
            {uploadError && <p className="pause-upload-error">{uploadError}</p>}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            <div className="pause-scenes-grid">
              <button
                type="button"
                className={`pause-upload-tile ${uploadingImage ? 'uploading' : ''}`}
                onClick={(event) => event.preventDefault()}
              >
                <span
                  className="pause-upload-half"
                  onClick={() => void handleClipboardUpload()}
                  title="Paste image from clipboard"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="9" y="3" width="6" height="4" rx="1" />
                    <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
                    <rect x="12" y="10" width="8" height="10" rx="1" />
                  </svg>
                </span>
                <span
                  className="pause-upload-half"
                  onClick={() => fileInputRef.current?.click()}
                  title="Browse for image file"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
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
                  className="pause-scene-card hoverable"
                  title={seed.filename}
                  onClick={() => handleSceneSelect(seed.filename)}
                >
                  <img src={thumbnails[seed.filename] || ''} alt={seed.filename} />
                  <span className="pause-scene-icons">
                    <button
                      type="button"
                      className={`pause-scene-icon-btn ${pinnedSceneIds.includes(seed.filename) ? 'active' : ''}`}
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
                        className="pause-scene-icon-btn danger"
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
          <button type="button" className="pause-action-btn primary pause-back-btn" onClick={() => setView('main')}>
            Back
          </button>
        </div>
      )}
    </div>
  )
}

export default PauseOverlay
