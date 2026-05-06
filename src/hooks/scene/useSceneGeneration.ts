import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '../../bridge'
import { RpcError } from '../../lib/wsRpc'
import { useSettings } from '../settings/settingsContextValue'
import { useWebsocket } from '../../context/streaming/websocket'

type GenerateState = 'idle' | 'loading' | 'error'

const ERROR_AUTO_DISMISS_MS = 5000

type UseSceneGenerationOptions = {
  refreshSeeds: () => Promise<void>
  isActive: boolean
  /** Publishes the filename of the most recently-saved generated scene so the
   *  consumer can scroll it into view + surface an "unpause to play" hint.
   *  Called with `null` when a new generation starts (to hide the old hint)
   *  and when the pause menu goes inactive. */
  setLastAddedFilename: (filename: string | null) => void
}

export function useSceneGeneration({ refreshSeeds, isActive, setLastAddedFilename }: UseSceneGenerationOptions) {
  const { t } = useTranslation()
  const websocket = useWebsocket()
  const { settings } = useSettings()
  const [generateState, setGenerateState] = useState<GenerateState>('idle')
  const [generateError, setGenerateError] = useState<string | null>(null)

  useEffect(() => {
    if (!isActive) {
      setGenerateState('idle')
      setGenerateError(null)
      setLastAddedFilename(null)
    }
  }, [isActive, setLastAddedFilename])

  useEffect(() => {
    if (generateState !== 'error') return
    const timer = setTimeout(() => {
      setGenerateState('idle')
      setGenerateError(null)
    }, ERROR_AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [generateState])

  const generate = useCallback(
    async (prompt: string) => {
      setGenerateState('loading')
      setGenerateError(null)
      setLastAddedFilename(null)
      try {
        const response = await websocket.request('generate_scene', { prompt }, 60_000)
        if (settings.scene_authoring_save_generated ?? true) {
          try {
            const record = await invoke('save-generated-seed', response.image_jpeg_base64)
            await refreshSeeds()
            setLastAddedFilename(record.filename)
          } catch (saveErr) {
            // Saving is a best-effort side-channel; the scene is already live in
            // the engine so we shouldn't fail the RPC on a disk error.
            console.warn('Failed to save generated scene:', saveErr)
          }
        }
        setGenerateState('idle')
      } catch (err) {
        let msg: string
        if (err instanceof RpcError && err.errorId) {
          msg = t(err.errorId, { defaultValue: err.message })
        } else {
          msg = err instanceof Error ? err.message : String(err)
        }
        setGenerateState('error')
        setGenerateError(msg)
      }
    },
    [websocket, t, settings.scene_authoring_save_generated, refreshSeeds, setLastAddedFilename]
  )

  return {
    generateState,
    generateError,
    isGenerating: generateState === 'loading',
    generate
  }
}
