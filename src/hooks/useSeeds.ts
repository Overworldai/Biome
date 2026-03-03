import { useState, useCallback } from 'react'
import { invoke } from '../bridge'
import { createLogger } from '../utils/logger'
import type { SeedRecord } from '../types/app'

const log = createLogger('Seeds')

type UseSeedsResult = {
  seeds: SeedRecord[]
  seedsDir: string | null
  isLoading: boolean
  error: string | null
  initializeSeeds: (
    wsRequest: <T = unknown>(type: string, params?: Record<string, unknown>) => Promise<T>
  ) => Promise<SeedRecord[]>
  refreshSeeds: (
    wsRequest: <T = unknown>(type: string, params?: Record<string, unknown>) => Promise<T>
  ) => Promise<SeedRecord[]>
  getDefaultSeedBase64: (
    wsRequest: <T = unknown>(type: string, params?: Record<string, unknown>) => Promise<T>
  ) => Promise<string>
  openSeedsDir: () => Promise<void>
  getSeedsDirPath: () => Promise<string>
}

type SeedsListResponse = {
  seeds: Record<string, { filename: string; is_safe: boolean; is_default: boolean }>
  count: number
}

function parseSeedsResponse(data: SeedsListResponse): SeedRecord[] {
  const seedsObj = data.seeds ?? {}
  return Object.entries(seedsObj)
    .map(([filename, info]) => ({
      filename,
      is_safe: Boolean(info.is_safe ?? false),
      is_default: Boolean(info.is_default ?? true)
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename))
}

export const useSeeds = (): UseSeedsResult => {
  const [seeds, setSeeds] = useState<SeedRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seedsDir, setSeedsDir] = useState<string | null>(null)

  const initializeSeeds = useCallback(
    async (wsRequest: <T = unknown>(type: string, params?: Record<string, unknown>) => Promise<T>) => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await wsRequest<SeedsListResponse>('seeds_list')
        const seedList = parseSeedsResponse(data)
        setSeeds(seedList)
        const path = await invoke('get-seeds-dir-path')
        setSeedsDir(path)
        return seedList
      } catch (err) {
        log.error('Failed to load seeds:', err)
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        throw err
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  const refreshSeeds = useCallback(
    async (wsRequest: <T = unknown>(type: string, params?: Record<string, unknown>) => Promise<T>) => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await wsRequest<SeedsListResponse>('seeds_list')
        const seedList = parseSeedsResponse(data)
        setSeeds(seedList)
        return seedList
      } catch (err) {
        log.error('Failed to refresh seeds:', err)
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        throw err
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  const getDefaultSeedBase64 = useCallback(
    async (wsRequest: <T = unknown>(type: string, params?: Record<string, unknown>) => Promise<T>) => {
      try {
        let seedList = seeds
        if (seedList.length === 0) {
          const data = await wsRequest<SeedsListResponse>('seeds_list')
          seedList = parseSeedsResponse(data)
          setSeeds(seedList)
        }

        if (!seedList.some((s) => s.filename === 'default.png')) {
          throw new Error('Required seed file "default.png" not found in seeds folder')
        }

        const result = await wsRequest<{ image_base64: string }>('seeds_image', { filename: 'default.png' })
        return result.image_base64
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        throw err
      }
    },
    [seeds]
  )

  const openSeedsDir = useCallback(async () => {
    try {
      await invoke('open-seeds-dir')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [])

  const getSeedsDirPath = useCallback(async () => {
    try {
      const path = await invoke('get-seeds-dir-path')
      setSeedsDir(path)
      return path
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [])

  return {
    seeds,
    seedsDir,
    isLoading,
    error,
    initializeSeeds,
    refreshSeeds,
    getDefaultSeedBase64,
    openSeedsDir,
    getSeedsDirPath
  }
}

export default useSeeds
