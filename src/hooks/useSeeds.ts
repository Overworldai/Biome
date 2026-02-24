import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { createLogger } from '../utils/logger'
import type { SeedRecord } from '../types/app'

const log = createLogger('Seeds')

type UseSeedsResult = {
  seeds: SeedRecord[]
  seedsDir: string | null
  isLoading: boolean
  error: string | null
  initializeSeeds: () => Promise<SeedRecord[]>
  refreshSeeds: () => Promise<SeedRecord[]>
  getDefaultSeedBase64: () => Promise<string>
  openSeedsDir: () => Promise<void>
  getSeedsDirPath: () => Promise<string>
}

export const useSeeds = (): UseSeedsResult => {
  const [seeds, setSeeds] = useState<SeedRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seedsDir, setSeedsDir] = useState<string | null>(null)

  const initializeSeeds = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const seedList = await invoke<SeedRecord[]>('list_seeds')
      setSeeds(seedList)
      const path = await invoke<string>('get_seeds_dir_path')
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
  }, [])

  const refreshSeeds = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const seedList = await invoke<SeedRecord[]>('list_seeds')
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
  }, [])

  const getDefaultSeedBase64 = useCallback(async () => {
    try {
      let seedList = seeds
      if (seedList.length === 0) {
        seedList = await invoke<SeedRecord[]>('list_seeds')
        setSeeds(seedList)
      }

      if (!seedList.some((s) => s.filename === 'default.png')) {
        throw new Error('Required seed file "default.png" not found in seeds folder')
      }

      return await invoke<string>('read_seed_as_base64', { filename: 'default.png' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [seeds])

  const openSeedsDir = useCallback(async () => {
    try {
      await invoke('open_seeds_dir')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [])

  const getSeedsDirPath = useCallback(async () => {
    try {
      const path = await invoke<string>('get_seeds_dir_path')
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
