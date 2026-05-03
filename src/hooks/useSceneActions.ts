import { useCallback, useEffect } from 'react'
import { useStreaming } from '../context/streamingContextValue'
import { ALLOW_USER_SCENES } from '../constants'

/**
 * Scene selection and clipboard-paste-to-play logic.
 *
 * - `selectScene(filename)` loads a seed and resumes streaming.
 * - `pasteScene()` reads the clipboard, uploads the image, and auto-selects it.
 * - Ctrl+V / Cmd+V keyboard shortcut is bound when `pasteEnabled` is true
 *   and {@link ALLOW_USER_SCENES} is on.
 */
export function useSceneActions(handleClipboardUpload: () => Promise<string[]>, pasteEnabled = true) {
  const { selectSeed, requestPointerLock } = useStreaming()

  const selectScene = useCallback(
    async (filename: string) => {
      await selectSeed(filename)
      requestPointerLock()
    },
    [selectSeed, requestPointerLock]
  )

  const pasteScene = useCallback(async () => {
    const uploaded = await handleClipboardUpload()
    if (uploaded.length === 1) {
      await selectScene(uploaded[0])
    }
  }, [handleClipboardUpload, selectScene])

  useEffect(() => {
    if (!pasteEnabled || !ALLOW_USER_SCENES) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v')) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)
      )
        return
      e.preventDefault()
      void pasteScene()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pasteScene, pasteEnabled])

  return { selectScene, pasteScene }
}
