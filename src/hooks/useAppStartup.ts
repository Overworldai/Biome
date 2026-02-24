import { useEffect, useRef } from 'react'

const invoke = async <T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> => {
  return window.__TAURI_INTERNALS__.invoke<T>(cmd, args)
}

export const useAppStartup = () => {
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    const runStartupTasks = async () => {
      try {
        const result = await invoke<string>('unpack_server_files', { force: false })
        console.log('[Startup] Server files:', result)
      } catch (err) {
        console.warn('[Startup] Failed to unpack server files:', err)
      }
    }

    runStartupTasks()
  }, [])
}

export default useAppStartup
