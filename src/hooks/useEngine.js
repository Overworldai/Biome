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
  const [serverStarting, setServerStarting] = useState(false)

  // Check the current engine status
  // Note: This does NOT modify isLoading to avoid interfering with setupEngine
  const checkStatus = useCallback(async () => {
    try {
      setError(null)
      const engineStatus = await invoke('check_engine_status')
      setStatus(engineStatus)
      return engineStatus
    } catch (err) {
      setError(err.message || String(err))
      return null
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

  // Setup server components (bundled pyproject.toml + server.py)
  const setupServerComponents = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      setSetupProgress('Setting up server components...')
      const result = await invoke('setup_server_components')
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

      // Step 2: Setup server components
      setSetupProgress('Setting up server components...')
      await invoke('setup_server_components')

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

  // Start the engine server on specified port
  const startServer = useCallback(async (port) => {
    try {
      setServerStarting(true)
      setError(null)
      console.log(`[useEngine] Starting server on port ${port}...`)
      const result = await invoke('start_engine_server', { port })
      console.log(`[useEngine] Server start result: ${result}`)
      // Refresh status to get server_running state
      const newStatus = await invoke('check_engine_status')
      setStatus(newStatus)
      return result
    } catch (err) {
      console.error(`[useEngine] Failed to start server: ${err}`)
      setError(err.message || String(err))
      throw err
    } finally {
      setServerStarting(false)
    }
  }, [])

  // Stop the engine server
  const stopServer = useCallback(async () => {
    try {
      setError(null)
      console.log('[useEngine] Stopping server...')
      const result = await invoke('stop_engine_server')
      console.log(`[useEngine] Server stop result: ${result}`)
      // Refresh status
      const newStatus = await invoke('check_engine_status')
      setStatus(newStatus)
      return result
    } catch (err) {
      console.error(`[useEngine] Failed to stop server: ${err}`)
      setError(err.message || String(err))
      throw err
    }
  }, [])

  // Check if server is running (updates process state if it has exited)
  const checkServerRunning = useCallback(async () => {
    try {
      const running = await invoke('is_server_running')
      // Also refresh full status if server state changed
      if (status?.server_running !== running) {
        const newStatus = await invoke('check_engine_status')
        setStatus(newStatus)
      }
      return running
    } catch (err) {
      console.error(`[useEngine] Failed to check server status: ${err}`)
      return false
    }
  }, [status?.server_running])

  // Check if server is ready (has finished startup and is accepting connections)
  const checkServerReady = useCallback(async () => {
    try {
      const ready = await invoke('is_server_ready')
      return ready
    } catch (err) {
      console.error(`[useEngine] Failed to check server ready: ${err}`)
      return false
    }
  }, [])

  // Check if a port is already in use (e.g., by an external server)
  const checkPortInUse = useCallback(async (port) => {
    try {
      const inUse = await invoke('is_port_in_use', { port })
      return inUse
    } catch (err) {
      console.error(`[useEngine] Failed to check port in use: ${err}`)
      return false
    }
  }, [])

  return {
    status,
    isLoading,
    error,
    setupProgress,
    serverStarting,
    checkStatus,
    installUv,
    setupServerComponents,
    syncDependencies,
    setupEngine,
    startServer,
    stopServer,
    checkServerRunning,
    checkServerReady,
    checkPortInUse,
    isReady: status?.uv_installed && status?.repo_cloned && status?.dependencies_synced,
    isServerRunning: status?.server_running ?? false,
    serverPort: status?.server_port ?? null,
    serverLogPath: status?.server_log_path ?? null
  }
}

export default useEngine
