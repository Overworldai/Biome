import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { invoke } from '../bridge'
import { TranslatableError } from '../i18n'
import type { SeedRecord, SeedFileRecord } from '../types/app'

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event: ProgressEvent<FileReader>) => {
      const result = event.target?.result
      if (typeof result !== 'string' || !result.includes(',')) {
        reject(new TranslatableError('app.scenes.failedToReadImageData'))
        return
      }
      resolve(result.split(',')[1])
    }
    reader.onerror = () => reject(new TranslatableError('app.scenes.failedToReadImageData'))
    reader.readAsDataURL(blob)
  })
}

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic|heif)$/i.test(file.name)
}

/** Extract file paths from clipboard items (handles text/uri-list and text/plain with file paths). */
async function parseClipboardFilePaths(items: ClipboardItems): Promise<string[]> {
  for (const item of items) {
    if (item.types.includes('text/uri-list')) {
      const blob = await item.getType('text/uri-list')
      const text = await blob.text()
      return text
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((uri) => {
          try {
            return new URL(uri).pathname
          } catch {
            return ''
          }
        })
        .filter(Boolean)
        .map((p) => decodeURIComponent(p))
    }

    if (item.types.includes('text/plain')) {
      const blob = await item.getType('text/plain')
      const text = await blob.text()
      const lines = text
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean)
      const allPaths = lines.every((line) => /^[A-Za-z]:[\\/]/.test(line) || line.startsWith('/'))
      if (allPaths && lines.length > 0) return lines
    }
  }
  return []
}

function sortSeeds(a: SeedFileRecord, b: SeedFileRecord) {
  const aDefault = a.source === 'default'
  const bDefault = b.source === 'default'
  if (aDefault !== bDefault) return aDefault ? 1 : -1
  if (a.modifiedAt !== b.modifiedAt) return b.modifiedAt - a.modifiedAt
  return a.filename.localeCompare(b.filename)
}

type UseSeedManagerOptions = {
  wsRequest: <T = unknown>(type: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
  isActive: boolean
  onPinnedSceneRemoved: (filename: string) => void
}

export function useSeedManager({ wsRequest, isActive, onPinnedSceneRemoved }: UseSeedManagerOptions) {
  const [seeds, setSeeds] = useState<SeedRecord[]>([])
  const [seedsLoaded, setSeedsLoaded] = useState(false)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const loadingRef = useRef(false)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const checkSeedSafety = useCallback(
    async (seedRecords: SeedRecord[]) => {
      for (const seed of seedRecords) {
        if (!isMountedRef.current) return
        try {
          const imageResult = await invoke('get-seed-image-base64', seed.filename)
          if (!imageResult || !isMountedRef.current) continue
          const result = await wsRequest<{ is_safe: boolean; hash: string }>('check_seed_safety', {
            image_data: imageResult.base64
          })
          if (!isMountedRef.current) return
          setSeeds((prev) => prev.map((s) => (s.filename === seed.filename ? { ...s, is_safe: result.is_safe } : s)))
        } catch {
          // Safety check failed — leave as null (unchecked)
        }
      }
    },
    [wsRequest]
  )

  const loadSeedsAndThumbnails = useCallback(async () => {
    const records = await invoke('list-seeds')
    const sorted = [...records].sort(sortSeeds)

    const seedRecords: SeedRecord[] = sorted.map((r) => ({
      filename: r.filename,
      is_safe: null,
      source: r.source
    }))

    console.log(`[PauseOverlay] Loaded ${seedRecords.length} seeds`)
    setSeeds(seedRecords)
    setSeedsLoaded(true)

    if (!isMountedRef.current) return
    setUploadError(null)

    // Load thumbnails in parallel
    const thumbEntries = await Promise.all(
      sorted.map(async (r) => {
        try {
          const thumb = await invoke('get-seed-thumbnail-base64', r.filename)
          if (thumb) return [r.filename, `data:image/jpeg;base64,${thumb}`] as const
        } catch (err) {
          console.error(`[PauseOverlay] Thumbnail failed for ${r.filename}:`, err)
        }
        return null
      })
    )

    if (!isMountedRef.current) return
    const nextThumbs: Record<string, string> = Object.fromEntries(thumbEntries.filter((e) => e !== null))
    setThumbnails(nextThumbs)

    // Run safety checks in background (doesn't block UI)
    void checkSeedSafety(seedRecords)
  }, [checkSeedSafety])

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
          setUploadError(err instanceof Error ? err.message : String(err))
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

  const refreshSeeds = useCallback(async () => {
    await loadSeedsAndThumbnails()
  }, [loadSeedsAndThumbnails])

  const removeScene = async (seed: SeedRecord) => {
    if (seed.source === 'default') return
    try {
      await invoke('delete-seed', seed.filename, seed.source)
      onPinnedSceneRemoved(seed.filename)
      await refreshSeeds()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    }
  }

  const uploadImageFiles = async (files: File[]): Promise<string[]> => {
    if (uploadingImage) return []

    const imageFiles = files.filter(isImageFile)
    if (imageFiles.length === 0) {
      setUploadError('Please drop image files only')
      return []
    }

    setUploadingImage(true)
    setUploadError(null)

    const succeeded: string[] = []
    const failed: string[] = []
    try {
      for (const file of imageFiles) {
        try {
          const base64Data = await readBlobAsBase64(file)
          await invoke('upload-seed', file.name, base64Data)
          succeeded.push(file.name)
        } catch {
          failed.push(file.name)
        }
      }
      await refreshSeeds()
      if (failed.length > 0) {
        setUploadError(`Failed to upload: ${failed.join(', ')}`)
      }
    } finally {
      setUploadingImage(false)
    }
    return succeeded
  }

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    await uploadImageFiles(files)
    event.target.value = ''
  }

  const handleImageDrop = (files: File[]) => {
    void uploadImageFiles(files)
  }

  const handleClipboardUpload = async (): Promise<string[]> => {
    if (uploadingImage) return []
    if (!navigator.clipboard?.read) {
      setUploadError('Clipboard image upload is not supported')
      return []
    }

    try {
      const clipboardItems = await navigator.clipboard.read()
      const extensionMap: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp'
      }

      const files: File[] = []
      for (const item of clipboardItems) {
        const matchingType = item.types.find((type) => type.startsWith('image/'))
        if (matchingType) {
          const blob = await item.getType(matchingType)
          const extension = extensionMap[matchingType] || 'png'
          const filename = `clipboard-${Date.now()}-${files.length}.${extension}`
          files.push(new File([blob], filename, { type: matchingType || 'image/png' }))
        }
      }

      if (files.length === 0) {
        const paths = await parseClipboardFilePaths(clipboardItems)
        if (paths.length > 0) {
          const imageFiles = await invoke('read-image-files', paths)
          for (const { name, base64, mimeType } of imageFiles) {
            const binary = atob(base64)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            files.push(new File([bytes], name, { type: mimeType }))
          }
        }
      }

      if (files.length === 0) throw new TranslatableError('app.scenes.noImageInClipboard')

      return await uploadImageFiles(files)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
      return []
    }
  }

  return {
    seeds,
    seedsLoaded,
    thumbnails,
    uploadingImage,
    uploadError,
    removeScene,
    refreshSeeds,
    handleImageUpload,
    handleImageDrop,
    handleClipboardUpload
  }
}
