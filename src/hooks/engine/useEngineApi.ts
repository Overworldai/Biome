import { useState, useCallback } from 'react'
import { invoke } from '../../bridge'
import type { EngineStatus } from '../../types/app'

export type UseEngineResult = {
  status: EngineStatus | null
  checkStatus: () => Promise<EngineStatus | null>
  stopServer: () => Promise<string>
  probeServerHealth: (healthUrl: string, timeoutMs?: number) => Promise<boolean>
  isReady: boolean
  isServerRunning: boolean
  serverPort: number | null
  serverLogPath: string | null
}

export const useEngineApi = (): UseEngineResult => {
  const [status, setStatus] = useState<EngineStatus | null>(null)

  const checkStatus = useCallback(async () => {
    try {
      const engineStatus = await invoke('check-engine-status', 'useEngineApi.checkStatus')
      setStatus(engineStatus)
      return engineStatus
    } catch {
      return null
    }
  }, [])

  const stopServer = useCallback(async () => {
    const result = await invoke('stop-engine-server')
    const newStatus = await invoke('check-engine-status', 'useEngineApi.stopServer.post')
    setStatus(newStatus)
    return result
  }, [])

  const probeServerHealth = useCallback(async (healthUrl: string, timeoutMs?: number) => {
    try {
      // The IPC returns the full identity object; warm-connect callers and
      // health-poll loops only care about reachability — strip down to
      // the boolean here so the shared shape stays simple.
      const result = await invoke('probe-server-health', healthUrl, timeoutMs)
      return result.reachable
    } catch {
      return false
    }
  }, [])

  return {
    status,
    checkStatus,
    stopServer,
    probeServerHealth,
    isReady: !!(status?.uv_installed && status?.repo_cloned && status?.dependencies_synced),
    isServerRunning: status?.server_running ?? false,
    serverPort: status?.server_port ?? null,
    serverLogPath: status?.server_log_path ?? null
  }
}

export default useEngineApi
