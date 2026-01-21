import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { createLogger } from '../utils/logger'

const log = createLogger('Seeds')

export const useSeeds = () => {
  const [seeds, setSeeds] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [seedsDir, setSeedsDir] = useState(null)

  // Initialize seeds directory (copy bundled seeds on first run)
  const initializeSeeds = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await invoke('initialize_seeds')
      log.info('Seeds initialized:', result)
      // Refresh the list after initialization
      const seedList = await invoke('list_seeds')
      setSeeds(seedList)
      // Get the seeds directory path
      const path = await invoke('get_seeds_dir_path')
      setSeedsDir(path)
      return result
    } catch (err) {
      log.error('Failed to initialize seeds:', err)
      setError(err)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Refresh the list of available seeds
  const refreshSeeds = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const seedList = await invoke('list_seeds')
      setSeeds(seedList)
      log.info('Seeds refreshed:', seedList.length, 'seeds found')
      return seedList
    } catch (err) {
      log.error('Failed to refresh seeds:', err)
      setError(err)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Get the default seed (default.png) as base64 encoded data
  const getDefaultSeedBase64 = useCallback(async () => {
    try {
      let seedList = seeds
      if (seedList.length === 0) {
        seedList = await invoke('list_seeds')
        setSeeds(seedList)
      }

      if (!seedList.includes('default.png')) {
        throw new Error('Required seed file "default.png" not found in seeds folder')
      }

      log.info('Loading default seed: default.png')
      const base64Data = await invoke('read_seed_as_base64', { filename: 'default.png' })
      return base64Data
    } catch (err) {
      log.error('Failed to load default seed:', err)
      setError(err)
      throw err
    }
  }, [seeds])

  // Open the seeds directory in file explorer
  const openSeedsDir = useCallback(async () => {
    try {
      await invoke('open_seeds_dir')
      log.info('Opened seeds directory')
    } catch (err) {
      log.error('Failed to open seeds directory:', err)
      setError(err)
      throw err
    }
  }, [])

  // Get the seeds directory path
  const getSeedsDirPath = useCallback(async () => {
    try {
      const path = await invoke('get_seeds_dir_path')
      setSeedsDir(path)
      return path
    } catch (err) {
      log.error('Failed to get seeds directory path:', err)
      setError(err)
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
