import { useCallback, useEffect, useState } from 'react'
import { listen } from '../bridge'
import type { LogRecord } from '../types/ipc'

const MAX_LINES = 500

/**
 * Subscribes to `engine-log` IPC events from the Electron main process and
 * maintains a rolling buffer of log lines.
 *
 * This covers **standalone-mode** logs only: engine install output (uv sync,
 * server component unpacking) and server process stdout/stderr. These all
 * originate in the main process before any WebSocket connection exists.
 *
 * For **server-mode** logs (remote WebSocket `{type:'log'}` messages), use
 * `wsLogs` from `useWebSocket` instead. Components pick whichever source
 * matches the active engine mode:
 *
 * ```tsx
 * const logs = isServerMode ? wsLogs : engineLogs
 * ```
 *
 * Each mount gets its own independent buffer, so multiple consumers
 * (e.g. TerminalDisplay and EngineInstallModal) can coexist without
 * interfering.
 */
export function useEngineLogs(enabled = true): { logs: LogRecord[]; clear: () => void } {
  const [logs, setLogs] = useState<LogRecord[]>([])

  useEffect(() => {
    if (!enabled) return

    const unlisten = listen('engine-log', (record) => {
      setLogs((prev) => {
        const next = [...prev, record]
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
      })
    })

    return unlisten
  }, [enabled])

  const clear = useCallback(() => setLogs([]), [])

  return { logs, clear }
}
