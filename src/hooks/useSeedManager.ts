import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { SeedRecord, SeedRecordWithThumbnail } from '../types/app'

type SeedsWithThumbsResponse = {
  seeds: Record<
    string,
    {
      filename: string
      is_safe: boolean
      is_default: boolean
      checked_at?: number
      uploaded_at?: number
      thumbnail_base64: string | null
    }
  >
  count: number
}

type SeedsListResponse = {
  seeds: Record<
    string,
    {
      filename: string
      is_safe: boolean
      is_default: boolean
      checked_at?: number
      uploaded_at?: number
    }
  >
  count: number
}

function sortSeedsByRecency(
  a: { filename: string; is_default: boolean; uploaded_at?: number; checked_at?: number },
  b: { filename: string; is_default: boolean; uploaded_at?: number; checked_at?: number }
) {
  if (a.is_default !== b.is_default) return a.is_default ? 1 : -1
  const aTime = Number(a.uploaded_at ?? a.checked_at ?? 0)
  const bTime = Number(b.uploaded_at ?? b.checked_at ?? 0)
  if (aTime !== bTime) return bTime - aTime
  return a.filename.localeCompare(b.filename)
}

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
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
}

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic|heif)$/i.test(file.name)
}

type UseSeedManagerOptions = {
  wsRequest: <T = unknown>(type: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
  isActive: boolean
  onPinnedSceneRemoved: (filename: string) => void
}

export function useSeedManager({ wsRequest, isActive, onPinnedSceneRemoved }: UseSeedManagerOptions) {
  const [seeds, setSeeds] = useState<SeedRecord[]>([])
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
          checked_at: Number(info.checked_at ?? 0),
          uploaded_at: Number(info.uploaded_at ?? 0),
          thumbnail_base64: typeof info.thumbnail_base64 === 'string' ? info.thumbnail_base64 : null
        }))
        .sort(sortSeedsByRecency)
    } catch {
      // ignore
    }

    if (seedList.length === 0) {
      const data = await wsRequest<SeedsListResponse>('seeds_list')
      const seedsObj = data.seeds ?? {}
      seedList = Object.entries(seedsObj)
        .map(([filename, info]) => ({
          filename,
          is_safe: Boolean(info.is_safe ?? false),
          is_default: Boolean(info.is_default ?? true),
          checked_at: Number(info.checked_at ?? 0),
          uploaded_at: Number(info.uploaded_at ?? 0),
          thumbnail_base64: null
        }))
        .sort(sortSeedsByRecency)
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

  const refreshSeeds = useCallback(async () => {
    await loadSeedsAndThumbnails()
  }, [loadSeedsAndThumbnails])

  const removeScene = async (seed: SeedRecord) => {
    if (seed.is_default) return
    try {
      await wsRequest('seeds_delete', { filename: seed.filename })
      onPinnedSceneRemoved(seed.filename)
      await refreshSeeds()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to remove scene')
    }
  }

  const uploadImageFiles = async (files: File[]) => {
    if (uploadingImage) return

    const imageFiles = files.filter(isImageFile)
    if (imageFiles.length === 0) {
      setUploadError('Please drop image files only')
      return
    }

    setUploadingImage(true)
    setUploadError(null)

    const failed: string[] = []
    try {
      for (const file of imageFiles) {
        try {
          const base64Data = await readBlobAsBase64(file)
          await wsRequest('seeds_upload', { filename: file.name, data: base64Data })
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
  }

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    await uploadImageFiles(files)
    event.target.value = ''
  }

  const handleImageDrop = (files: File[]) => {
    void uploadImageFiles(files)
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
      await uploadImageFiles([new File([imageBlob], filename, { type: imageType || 'image/png' })])
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to read image from clipboard')
    }
  }

  return {
    seeds,
    thumbnails,
    uploadingImage,
    uploadError,
    removeScene,
    handleImageUpload,
    handleImageDrop,
    handleClipboardUpload
  }
}
