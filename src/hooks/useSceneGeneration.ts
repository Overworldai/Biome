import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '../bridge'
import { RpcError } from '../lib/wsRpc'
import { useSettings } from './settingsContextValue'
import { useStreaming } from '../context/streamingContextValue'
import type { GenerateSceneResponse } from '../types/ws'

type GenerateState = 'idle' | 'loading' | 'error'

const ERROR_AUTO_DISMISS_MS = 5000

type UseSceneGenerationOptions = {
  refreshSeeds: () => Promise<void>
  isActive: boolean
}

export function useSceneGeneration({ refreshSeeds, isActive }: UseSceneGenerationOptions) {
  const { t } = useTranslation()
  const { wsRequest } = useStreaming()
  const { settings } = useSettings()
  const [generateState, setGenerateState] = useState<GenerateState>('idle')
  const [generateError, setGenerateError] = useState<string | null>(null)
  /** Filename of the last successfully-saved generated scene. Consumers use
   *  this to scroll the card into view + surface a "unpause to play" hint. */
  const [lastGeneratedFilename, setLastGeneratedFilename] = useState<string | null>(null)

  useEffect(() => {
    if (!isActive) {
      setGenerateState('idle')
      setGenerateError(null)
      setLastGeneratedFilename(null)
    }
  }, [isActive])

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
      setLastGeneratedFilename(null)
      try {
        const response = await wsRequest<GenerateSceneResponse>('generate_scene', { prompt }, 60_000)
        if (settings.scene_authoring_save_generated ?? true) {
          try {
            const record = await invoke('save-generated-seed', response.image_jpeg_base64)
            await refreshSeeds()
            setLastGeneratedFilename(record.filename)
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
    [wsRequest, t, settings.scene_authoring_save_generated, refreshSeeds]
  )

  return {
    generateState,
    generateError,
    isGenerating: generateState === 'loading',
    lastGeneratedFilename,
    generate
  }
}
