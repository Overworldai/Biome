import { useEffect, useRef } from 'react'

// Tauri invoke helper
const invoke = async (cmd, args = {}) => {
  return window.__TAURI_INTERNALS__.invoke(cmd, args)
}

/**
 * Hook that runs one-time startup tasks when the app mounts.
 * Currently unpacks server files to the engine directory (without overwriting existing files).
 */
export const useAppStartup = () => {
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    const runStartupTasks = async () => {
      try {
        // Always unpack server files on startup (without overwriting existing)
        const result = await invoke('unpack_server_files', { force: false })
        console.log('[Startup] Server files:', result)
      } catch (err) {
        console.warn('[Startup] Failed to unpack server files:', err)
      }
    }

    runStartupTasks()
  }, [])
}

export default useAppStartup
