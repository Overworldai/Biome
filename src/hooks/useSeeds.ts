import { useState, useCallback } from 'react'
import { invoke } from '../bridge'
import { createLogger } from '../utils/logger'
import { TranslatableError } from '../i18n'
import type { SeedRecord, SeedFileRecord } from '../types/app'

const log = createLogger('Seeds')

type UseSeedsResult = {
  seeds: SeedRecord[]
  seedsDir: string | null
  isLoading: boolean
  error: string | null
  initializeSeeds: () => Promise<SeedRecord[]>
  refreshSeeds: () => Promise<SeedRecord[]>
  getDefaultSeedBlob: () => Promise<Blob>
  openSeedsDir: () => Promise<void>
  getSeedsDirPath: () => Promise<string>
}

function fileRecordsToSeedRecords(records: SeedFileRecord[]): SeedRecord[] {
  return records
    .map((r) => ({
      filename: r.filename,
      is_safe: null,
      source: r.source
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename))
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
      const records = await invoke('list-seeds')
      const seedList = fileRecordsToSeedRecords(records)
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
  }, [])

  const refreshSeeds = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const records = await invoke('list-seeds')
      const seedList = fileRecordsToSeedRecords(records)
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

  const getDefaultSeedBlob = useCallback(async () => {
    try {
      const result = await invoke('get-seed-image-base64', 'default.jpg')
      if (!result) {
        throw new TranslatableError('app.server.defaultSeedNotFound')
      }
      const binary = atob(result.base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return new Blob([bytes], { type: 'image/jpeg' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    }
  }, [])

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
    getDefaultSeedBlob,
    openSeedsDir,
    getSeedsDirPath
  }
}

export default useSeeds
