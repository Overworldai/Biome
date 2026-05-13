import { useState, useCallback } from 'react'
import { invoke } from '../../bridge'
import type { EngineStatus } from '../../types/app'
import type { ServerHealthResult } from '../../types/ipc'

export type UseEngineResult = {
  status: EngineStatus | null
  checkStatus: () => Promise<EngineStatus | null>
  probeServerHealth: (healthUrl: string, timeoutMs?: number) => Promise<ServerHealthResult>
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

  const probeServerHealth = useCallback(async (healthUrl: string, timeoutMs?: number): Promise<ServerHealthResult> => {
    try {
      return await invoke('probe-server-health', healthUrl, timeoutMs)
    } catch {
      return { ok: false, launched_from_standalone: false }
    }
  }, [])

  return {
    status,
    checkStatus,
    probeServerHealth,
    isReady: !!(status?.uv_installed && status?.repo_cloned && status?.dependencies_synced),
    isServerRunning: status?.server_running ?? false,
    serverPort: status?.server_port ?? null,
    serverLogPath: status?.server_log_path ?? null
  }
}

export default useEngineApi
