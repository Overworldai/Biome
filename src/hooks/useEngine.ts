import { useState, useCallback } from 'react'
import type { EngineStatus } from '../types/app'

const invoke = async <T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> => {
  return window.__TAURI_INTERNALS__.invoke<T>(cmd, args)
}

export type UseEngineResult = {
  status: EngineStatus | null
  isLoading: boolean
  error: string | null
  setupProgress: string | null
  serverStarting: boolean
  checkStatus: () => Promise<EngineStatus | null>
  installUv: () => Promise<string>
  setupServerComponents: () => Promise<string>
  syncDependencies: () => Promise<string>
  setupEngine: () => Promise<EngineStatus>
  startServer: (port: number) => Promise<string>
  stopServer: () => Promise<string>
  checkServerRunning: () => Promise<boolean>
  checkServerReady: () => Promise<boolean>
  checkPortInUse: (port: number) => Promise<boolean>
  isReady: boolean
  isServerRunning: boolean
  serverPort: number | null
  serverLogPath: string | null
}

export const useEngine = (): UseEngineResult => {
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setupProgress, setSetupProgress] = useState<string | null>(null)
  const [serverStarting, setServerStarting] = useState(false)

  const checkStatus = useCallback(async () => {
    try {
      setError(null)
      const engineStatus = await invoke<EngineStatus>('check_engine_status')
      setStatus(engineStatus)
      return engineStatus
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [])

  const installUv = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      setSetupProgress('Installing uv...')
      return await invoke<string>('install_uv')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setIsLoading(false)
      setSetupProgress(null)
    }
  }, [])

  const setupServerComponents = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      setSetupProgress('Setting up server components...')
      return await invoke<string>('setup_server_components')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setIsLoading(false)
      setSetupProgress(null)
    }
  }, [])

  const syncDependencies = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      setSetupProgress('Syncing dependencies...')
      return await invoke<string>('sync_engine_dependencies')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setIsLoading(false)
      setSetupProgress(null)
    }
  }, [])

  const setupEngine = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      setSetupProgress('Checking uv installation...')
      const currentStatus = await invoke<EngineStatus>('check_engine_status')

      if (!currentStatus.uv_installed) {
        setSetupProgress('Installing uv...')
        await invoke('install_uv')
      }

      setSetupProgress('Setting up server components...')
      await invoke('setup_server_components')

      setSetupProgress('Syncing dependencies (this may take a while)...')
      await invoke('sync_engine_dependencies')

      setSetupProgress('Verifying setup...')
      const finalStatus = await invoke<EngineStatus>('check_engine_status')
      setStatus(finalStatus)

      setSetupProgress(null)
      return finalStatus
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSetupProgress(null)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  const startServer = useCallback(async (port: number) => {
    try {
      setServerStarting(true)
      setError(null)
      const result = await invoke<string>('start_engine_server', { port })
      const newStatus = await invoke<EngineStatus>('check_engine_status')
      setStatus(newStatus)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setServerStarting(false)
    }
  }, [])

  const stopServer = useCallback(async () => {
    try {
      setError(null)
      const result = await invoke<string>('stop_engine_server')
      const newStatus = await invoke<EngineStatus>('check_engine_status')
      setStatus(newStatus)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    }
  }, [])

  const checkServerRunning = useCallback(async () => {
    try {
      const running = await invoke<boolean>('is_server_running')
      if (status?.server_running !== running) {
        const newStatus = await invoke<EngineStatus>('check_engine_status')
        setStatus(newStatus)
      }
      return running
    } catch {
      return false
    }
  }, [status?.server_running])

  const checkServerReady = useCallback(async () => {
    try {
      return await invoke<boolean>('is_server_ready')
    } catch {
      return false
    }
  }, [])

  const checkPortInUse = useCallback(async (port: number) => {
    try {
      return await invoke<boolean>('is_port_in_use', { port })
    } catch {
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
    isReady: !!(status?.uv_installed && status?.repo_cloned && status?.dependencies_synced),
    isServerRunning: status?.server_running ?? false,
    serverPort: status?.server_port ?? null,
    serverLogPath: status?.server_log_path ?? null
  }
}

export default useEngine
