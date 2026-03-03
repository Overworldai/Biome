import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useStreaming } from '../context/StreamingContext'
import type { SeedRecord, SeedRecordWithThumbnail } from '../types/app'
import MenuSettingsView from './MenuSettingsView'
import PauseMainView from './PauseMainView'
import PauseScenesView from './PauseScenesView'
import { useConfig } from '../hooks/useConfig'

const PauseOverlay = ({ isActive }: { isActive: boolean }) => {
  const {
    canUnpause,
    unlockDelayMs,
    pauseElapsedMs,
    pointerLockBlockedSeq,
    requestPointerLock,
    reset,
    sendPromptWithSeed,
    wsRequest
  } = useStreaming()
  const { config, isLoaded, saveConfig } = useConfig()
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

  type SeedsWithThumbsResponse = {
    seeds: Record<string, { filename: string; is_safe: boolean; is_default: boolean; thumbnail_base64: string | null }>
    count: number
  }

  type SeedsListResponse = {
    seeds: Record<string, { filename: string; is_safe: boolean; is_default: boolean }>
    count: number
  }

  const loadSeedsAndThumbnails = useCallback(async () => {
    let seedList: SeedRecordWithThumbnail[] = []

    try {
      const data = await wsRequest<SeedsWithThumbsResponse>('seeds_list_with_thumbnails')
      const seedsObj = data.seeds ?? {}
      seedList = Object.entries(seedsObj)
        .map(([filename, info]) => ({
          filename,
          is_safe: Boolean(info.is_safe ?? false),
          is_default: Boolean(info.is_default ?? true),
          thumbnail_base64: typeof info.thumbnail_base64 === 'string' ? info.thumbnail_base64 : null
        }))
        .sort((a, b) => a.filename.localeCompare(b.filename))
    } catch {
      // ignore
    }

    // Fallback to metadata-only endpoint if batched endpoint returns no entries.
    if (seedList.length === 0) {
      const data = await wsRequest<SeedsListResponse>('seeds_list')
      const seedsObj = data.seeds ?? {}
      seedList = Object.entries(seedsObj)
        .map(([filename, info]) => ({
          filename,
          is_safe: Boolean(info.is_safe ?? false),
          is_default: Boolean(info.is_default ?? true),
          thumbnail_base64: null
        }))
        .sort((a, b) => a.filename.localeCompare(b.filename))
    }

    console.log(`[PauseOverlay] Loaded ${seedList.length} seeds`)
    setSeeds(seedList.map(({ filename, is_safe, is_default }) => ({ filename, is_safe, is_default })))

    if (!isMountedRef.current) return
    setUploadError(null)

    const nextThumbs: Record<string, string> = Object.fromEntries(
      seedList
        .filter((seed) => Boolean(seed.thumbnail_base64))
        .map((seed) => [seed.filename, `data:image/jpeg;base64,${seed.thumbnail_base64}`])
    )

    if (!isMountedRef.current) return
    setThumbnails(nextThumbs)
  }, [wsRequest])

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
      const raw = localStorage.getItem('biome_pinned_scenes')
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
      await wsRequest('seeds_delete', { filename: seed.filename })
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
      await wsRequest('seeds_upload', { filename, data: base64Data })
      await refreshSeeds()
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
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
        <PauseMainView
          pinnedScenes={pinnedScenes}
          thumbnails={thumbnails}
          onSceneSelect={handleSceneSelect}
          onTogglePin={togglePinnedScene}
          onRemoveScene={removeScene}
          onResetAndResume={handleResetAndResume}
          onNavigate={setView}
          requestPointerLock={requestPointerLock}
          showPauseLockoutTimer={showPauseLockoutTimer}
          pauseLockoutSecondsText={pauseLockoutSecondsText}
          showUnlockHint={showUnlockHint}
        />
      ) : (
        <PauseScenesView
          seeds={seeds}
          thumbnails={thumbnails}
          pinnedSceneIds={pinnedSceneIds}
          uploadingImage={uploadingImage}
          uploadError={uploadError}
          onSceneSelect={handleSceneSelect}
          onTogglePin={togglePinnedScene}
          onRemoveScene={removeScene}
          onImageUpload={handleImageUpload}
          onClipboardUpload={handleClipboardUpload}
          onBack={() => setView('main')}
        />
      )}
    </div>
  )
}

export default PauseOverlay
