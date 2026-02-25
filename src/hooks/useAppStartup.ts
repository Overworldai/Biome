import { useEffect, useRef } from 'react'
import { invoke } from '../bridge'

export const useAppStartup = () => {
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    const runStartupTasks = async () => {
      try {
        const result = await invoke('unpack-server-files', false)
        console.log('[Startup] Server files:', result)
      } catch (err) {
        console.warn('[Startup] Failed to unpack server files:', err)
      }
    }

    runStartupTasks()
  }, [])
}

export default useAppStartup
