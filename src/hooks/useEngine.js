import { useState, useCallback } from 'react'

// Tauri invoke helper
const invoke = async (cmd, args = {}) => {
  return window.__TAURI_INTERNALS__.invoke(cmd, args)
}

export const useEngine = () => {
  const [status, setStatus] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [setupProgress, setSetupProgress] = useState(null)

  // Check the current engine status
  const checkStatus = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const engineStatus = await invoke('check_engine_status')
      setStatus(engineStatus)
      return engineStatus
    } catch (err) {
      setError(err.message || String(err))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Install uv package manager
  const installUv = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      setSetupProgress('Installing uv...')
      const result = await invoke('install_uv')
      return result
    } catch (err) {
      setError(err.message || String(err))
      throw err
    } finally {
      setIsLoading(false)
      setSetupProgress(null)
    }
  }, [])

  // Clone or update the engine repository
  const cloneRepo = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      setSetupProgress('Cloning world_engine repository...')
      const result = await invoke('clone_engine_repo')
      return result
    } catch (err) {
      setError(err.message || String(err))
      throw err
    } finally {
      setIsLoading(false)
      setSetupProgress(null)
    }
  }, [])

  // Sync dependencies with uv
  const syncDependencies = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      setSetupProgress('Syncing dependencies...')
      const result = await invoke('sync_engine_dependencies')
      return result
    } catch (err) {
      setError(err.message || String(err))
      throw err
    } finally {
      setIsLoading(false)
      setSetupProgress(null)
    }
  }, [])

  // Full setup: install uv, clone repo, sync dependencies
  const setupEngine = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Step 1: Check/install uv
      setSetupProgress('Checking uv installation...')
      const currentStatus = await invoke('check_engine_status')

      if (!currentStatus.uv_installed) {
        setSetupProgress('Installing uv...')
        await invoke('install_uv')
      }

      // Step 2: Clone/update repo
      setSetupProgress('Cloning world_engine repository...')
      await invoke('clone_engine_repo')

      // Step 3: Sync dependencies
      setSetupProgress('Syncing dependencies (this may take a while)...')
      await invoke('sync_engine_dependencies')

      // Refresh status
      setSetupProgress('Verifying setup...')
      const finalStatus = await invoke('check_engine_status')
      setStatus(finalStatus)

      setSetupProgress(null)
      return finalStatus
    } catch (err) {
      setError(err.message || String(err))
      setSetupProgress(null)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    status,
    isLoading,
    error,
    setupProgress,
    checkStatus,
    installUv,
    cloneRepo,
    syncDependencies,
    setupEngine,
    isReady: status?.uv_installed && status?.repo_cloned && status?.dependencies_synced
  }
}

export default useEngine
