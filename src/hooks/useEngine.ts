import { useState, useCallback } from 'react'
import { invoke } from '../bridge'
import type { EngineStatus } from '../types/app'
import type { StageId } from '../stages'

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
  setupEngine: (onStage?: (stageId: StageId) => void) => Promise<EngineStatus>
  startServer: (port: number) => Promise<string>
  stopServer: () => Promise<string>
  checkServerRunning: () => Promise<boolean>
  checkServerReady: () => Promise<boolean>
  checkPortInUse: (port: number) => Promise<boolean>
  probeServerHealth: (healthUrl: string, timeoutMs?: number) => Promise<boolean>
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
      const engineStatus = await invoke('check-engine-status', 'useEngine.checkStatus')
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
      const result = await invoke('install-uv')
      const statusAfter = await invoke('check-engine-status', 'useEngine.installUv.post')
      setStatus(statusAfter)
      return result
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
      const result = await invoke('setup-server-components')
      const statusAfter = await invoke('check-engine-status', 'useEngine.setupServerComponents.post')
      setStatus(statusAfter)
      return result
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
      const result = await invoke('sync-engine-dependencies')
      const statusAfter = await invoke('check-engine-status', 'useEngine.syncDependencies.post')
      setStatus(statusAfter)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setIsLoading(false)
      setSetupProgress(null)
    }
  }, [])

  const setupEngine = useCallback(async (onStage?: (stageId: StageId) => void) => {
    try {
      setIsLoading(true)
      setError(null)

      setSetupProgress('Checking uv installation...')
      onStage?.('setup.uv_check')
      const currentStatus = await invoke('check-engine-status', 'useEngine.setupEngine.pre')

      if (!currentStatus.uv_installed) {
        setSetupProgress('Installing uv...')
        onStage?.('setup.uv_download')
        await invoke('install-uv')
      }

      setSetupProgress('Setting up server components...')
      onStage?.('setup.server_components')
      await invoke('setup-server-components')

      setSetupProgress('Syncing dependencies (this may take a while)...')
      onStage?.('setup.sync_deps')
      await invoke('sync-engine-dependencies')

      setSetupProgress('Verifying setup...')
      onStage?.('setup.verify')
      const finalStatus = await invoke('check-engine-status', 'useEngine.setupEngine.post')
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
      const result = await invoke('start-engine-server', port)
      const newStatus = await invoke('check-engine-status', 'useEngine.startServer.post')
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
      const result = await invoke('stop-engine-server')
      const newStatus = await invoke('check-engine-status', 'useEngine.stopServer.post')
      setStatus(newStatus)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    }
  }, [])

  const checkServerRunning = useCallback(async () => {
    try {
      const running = await invoke('is-server-running')
      if (status?.server_running !== running) {
        const newStatus = await invoke('check-engine-status', 'useEngine.checkServerRunning.delta')
        setStatus(newStatus)
      }
      return running
    } catch {
      return false
    }
  }, [status?.server_running])

  const checkServerReady = useCallback(async () => {
    try {
      return await invoke('is-server-ready')
    } catch {
      return false
    }
  }, [])

  const checkPortInUse = useCallback(async (port: number) => {
    try {
      return await invoke('is-port-in-use', port)
    } catch {
      return false
    }
  }, [])

  const probeServerHealth = useCallback(async (healthUrl: string, timeoutMs?: number) => {
    try {
      return await invoke('probe-server-health', healthUrl, timeoutMs)
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
    probeServerHealth,
    isReady: !!(status?.uv_installed && status?.repo_cloned && status?.dependencies_synced),
    isServerRunning: status?.server_running ?? false,
    serverPort: status?.server_port ?? null,
    serverLogPath: status?.server_log_path ?? null
  }
}

export default useEngine
