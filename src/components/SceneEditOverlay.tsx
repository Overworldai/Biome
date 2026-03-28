import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { useStreaming } from '../context/StreamingContext'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT } from '../styles'
import type { SceneEditPhase } from '../context/sceneEditMachine'
import { RpcError } from '../lib/wsRpc'
import type { TranslationKey } from '../i18n'

const SceneEditOverlay = () => {
  const { t } = useTranslation()
  const { sceneEditState, dispatchSceneEdit, wsRequest } = useStreaming()
  const { phase, errorMessage } = sceneEditState
  const isActive = phase !== 'inactive'

  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input when entering the prompting phase
  useEffect(() => {
    if (phase === 'prompting') {
      setPrompt('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [phase])

  // Auto-dismiss error after 3 seconds
  useEffect(() => {
    if (phase !== 'error') return
    const timer = setTimeout(() => dispatchSceneEdit({ type: 'ERROR_TIMEOUT' }), 3000)
    return () => clearTimeout(timer)
  }, [phase, dispatchSceneEdit])

  // Global capture-phase Escape handler — intercepts before pointer-lock /
  // pause handlers so Escape only dismisses the overlay, not the game.
  useEffect(() => {
    if (!isActive) return
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        dispatchSceneEdit({ type: 'DISMISS' })
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true)
  }, [isActive, dispatchSceneEdit])

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed || phase !== 'prompting') return

    dispatchSceneEdit({ type: 'SUBMIT', prompt: trimmed })
    try {
      const result = await wsRequest<{
        elapsed_ms: number
        original_jpeg_b64?: string
        preview_jpeg_b64?: string
        edit_prompt?: string
      }>('scene_edit', { prompt: trimmed }, 30_000)
      dispatchSceneEdit({
        type: 'SUCCESS',
        preview:
          result?.original_jpeg_b64 && result?.preview_jpeg_b64
            ? { originalB64: result.original_jpeg_b64, inpaintedB64: result.preview_jpeg_b64 }
            : undefined,
        editPrompt: result?.edit_prompt
      })
    } catch (err) {
      let msg: string
      if (err instanceof RpcError && err.errorId) {
        msg = t(err.errorId as TranslationKey, { defaultValue: err.message })
      } else {
        msg = err instanceof Error ? err.message : String(err)
      }
      dispatchSceneEdit({ type: 'ERROR', message: msg })
    }
  }, [prompt, phase, wsRequest, dispatchSceneEdit])

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const content: Record<Exclude<SceneEditPhase, 'inactive'>, () => React.ReactNode> = {
    prompting: () => (
      <div className="flex flex-col gap-[0.8cqh]">
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={t('app.sceneEdit.placeholder')}
          className={`${SETTINGS_CONTROL_BASE} ${SETTINGS_CONTROL_TEXT} w-full outline-none focus:ring-1 focus:ring-border-medium`}
        />
        <span className="font-serif text-[1.8cqh] text-text-muted">{t('app.sceneEdit.instructions')}</span>
      </div>
    ),
    loading: () => (
      <div className="flex items-center gap-[1cqw]">
        <div className="h-[2cqh] w-[2cqh] animate-spin rounded-full border-[0.3cqh] border-text-muted border-t-text-primary" />
        <span className="font-serif text-[2.4cqh] text-text-muted">{t('app.sceneEdit.applying')}</span>
      </div>
    ),
    error: () => <span className="font-serif text-[2.4cqh] text-red-400">{errorMessage}</span>
  }

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          className="absolute inset-x-0 bottom-[8cqh] z-50 flex justify-center px-[4cqw]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
          exit={{ opacity: 0, y: 20, transition: { duration: 0.15, ease: 'easeIn' } }}
        >
          <div className="w-full max-w-[60cqw] bg-black/80 p-[1.5cqh_2cqw] backdrop-blur-sm">
            {content[phase as Exclude<SceneEditPhase, 'inactive'>]()}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default SceneEditOverlay
