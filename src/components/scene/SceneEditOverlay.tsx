import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { useInput } from '../../context/streaming/input'
import { useSession } from '../../context/streaming/session'
import { useWebsocket } from '../../context/streaming/websocket'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT } from '../../styles'
import { RpcError } from '../../lib/wsRpc'
import { propImageUrl, usePropManifest, type PropEntry } from '../../hooks/scene/usePropManifest'

const slugToSubject = (slug: string): string => slug.replace(/_/g, ' ')

const fetchImageAsBase64 = async (url: string): Promise<string> => {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`)
  }
  const blob = await res.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('FileReader did not return a data URL'))
        return
      }
      // Strip the `data:image/jpeg;base64,` prefix.
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}

const SceneEditOverlay = () => {
  const { t } = useTranslation()
  const requestPointerLock = useInput().pointerLock.request
  const wsRequest = useWebsocket().request
  const { state: sceneEditState, dispatch } = useSession().sceneEdit
  const { mode, errorMessage } = sceneEditState
  const isActive = mode !== 'inactive'

  const manifestState = usePropManifest()
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [spawnAtCenter, setSpawnAtCenter] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset prompt + hover state when transitioning to active.
  useEffect(() => {
    if (isActive) {
      setPrompt('')
      setHoveredSlug(null)
    }
  }, [isActive])

  // Pick the first category as default once the manifest lands.
  useEffect(() => {
    if (manifestState.status === 'ready' && activeCategory === null) {
      const first = Object.keys(manifestState.manifest.categories)[0]
      if (first) setActiveCategory(first)
    }
  }, [manifestState, activeCategory])

  // Auto-dismiss the error mode after 3s (mirrors the previous overlay).
  useEffect(() => {
    if (mode !== 'error') return
    const timer = setTimeout(() => dispatch({ type: 'ERROR_TIMEOUT' }), 3000)
    return () => clearTimeout(timer)
  }, [mode, dispatch])

  // Capture-phase Escape handler — intercept before pointer-lock / pause
  // handlers so Escape only dismisses the overlay, not the game.
  useEffect(() => {
    if (!isActive) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        dispatch({ type: 'ESC' })
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [isActive, dispatch])

  // Re-acquire pointer lock when the overlay finishes (close, success,
  // error timeout) so the lifecycle machine doesn't read the unlocked
  // cursor as a pause request.
  const wasActiveRef = useRef(false)
  useEffect(() => {
    if (isActive) {
      wasActiveRef.current = true
    } else if (wasActiveRef.current) {
      wasActiveRef.current = false
      const timer = setTimeout(() => requestPointerLock(), 150)
      return () => clearTimeout(timer)
    }
  }, [isActive, requestPointerLock])

  const formatError = useCallback(
    (err: unknown): string => {
      if (err instanceof RpcError && err.errorId) {
        return t(err.errorId, { defaultValue: err.message })
      }
      return err instanceof Error ? err.message : String(err)
    },
    [t]
  )

  // ─── Submit: text prompt → existing scene_edit RPC (VLM + Klein) ────
  const submitPrompt = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed || mode !== 'open') return
    dispatch({ type: 'SUBMIT' })
    try {
      const result = await wsRequest('scene_edit', { prompt: trimmed }, 30_000)
      dispatch({
        type: 'SUCCESS',
        preview:
          result?.original_jpeg_b64 && result?.preview_jpeg_b64
            ? { originalB64: result.original_jpeg_b64, inpaintedB64: result.preview_jpeg_b64 }
            : undefined,
        editPrompt: result?.edit_prompt
      })
    } catch (err) {
      dispatch({ type: 'ERROR', message: formatError(err) })
    }
  }, [prompt, mode, wsRequest, dispatch, formatError])

  // ─── Submit: tile click → new scene_prop_edit RPC (Klein, no VLM) ───
  const submitProp = useCallback(
    async (prop: PropEntry) => {
      if (mode !== 'open') return
      dispatch({ type: 'SUBMIT' })
      try {
        const refRel = prop.kind === 'holdable' && prop.held_image ? prop.held_image : prop.image
        const referenceB64 = await fetchImageAsBase64(propImageUrl(refRel))
        await wsRequest(
          'scene_prop_edit',
          {
            reference_jpeg_b64: referenceB64,
            kind: prop.kind,
            target: spawnAtCenter ? 'centre' : 'appropriate',
            subject: slugToSubject(prop.slug)
          },
          60_000
        )
        // Silent close — no preview / editPrompt for the tile path.
        dispatch({ type: 'SUCCESS' })
      } catch (err) {
        dispatch({ type: 'ERROR', message: formatError(err) })
      }
    },
    [mode, spawnAtCenter, wsRequest, dispatch, formatError]
  )

  const categoryEntries = useMemo(
    () => (manifestState.status === 'ready' ? Object.entries(manifestState.manifest.categories) : []),
    [manifestState]
  )
  const visibleProps =
    activeCategory && manifestState.status === 'ready' ? (manifestState.manifest.categories[activeCategory] ?? []) : []

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      submitPrompt()
    }
  }

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          className="absolute inset-y-[3cqh] left-[2cqw] z-50 flex w-[33cqw] flex-col"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
          exit={{ opacity: 0, x: -20, transition: { duration: 0.15, ease: 'easeIn' } }}
        >
          <div
            className="
              relative flex h-full flex-col gap-[1.5cqh] border border-border-medium bg-black/60 p-[1.6cqh_1.4cqw]
              backdrop-blur-md
            "
          >
            {/* Categories — horizontal tab strip */}
            <div className="flex shrink-0 gap-[0.4cqw] overflow-x-auto pb-[0.3cqh]">
              {categoryEntries.map(([cat]) => {
                const isActive = activeCategory === cat
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`
                      shrink-0 px-[0.7cqw] py-[0.3cqh] font-serif text-[1.9cqh] capitalize transition-colors
                      ${
                        isActive
                          ? 'bg-surface-btn-secondary text-text-primary'
                          : `
                            text-text-muted
                            hover:text-text-primary
                          `
                      }
                    `}
                  >
                    {cat.replace(/_/g, ' ')}
                  </button>
                )
              })}
            </div>

            {/* Tile grid — 3 columns, image-only with hover popover */}
            <div className="grid flex-1 grid-cols-3 gap-[0.5cqh] overflow-y-auto pr-[0.3cqw]">
              {visibleProps.map((prop) => (
                <button
                  key={prop.slug}
                  type="button"
                  onClick={() => submitProp(prop)}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHoveredSlug(prop.slug)}
                  onMouseLeave={() => setHoveredSlug((current) => (current === prop.slug ? null : current))}
                  className="
                    group relative aspect-square overflow-hidden border border-border-medium bg-surface-btn-secondary
                    transition-colors
                    hover:border-text-primary
                    disabled:cursor-not-allowed disabled:opacity-50
                  "
                  disabled={mode !== 'open'}
                  title={slugToSubject(prop.slug)}
                >
                  <img
                    src={propImageUrl(prop.image)}
                    alt={slugToSubject(prop.slug)}
                    className="size-full object-contain"
                    draggable={false}
                  />
                  {hoveredSlug === prop.slug && (
                    <div
                      className="
                        absolute inset-x-0 bottom-0 truncate bg-black/80 px-[0.4cqw] py-[0.2cqh] text-center font-serif
                        text-[1.4cqh] text-text-primary
                      "
                    >
                      {slugToSubject(prop.slug)}
                    </div>
                  )}
                </button>
              ))}
              {manifestState.status === 'loading' && (
                <span className="col-span-3 py-[2cqh] text-center font-serif text-[1.8cqh] text-text-muted">
                  {t('app.sceneEdit.loadingProps', { defaultValue: 'Loading props…' })}
                </span>
              )}
              {manifestState.status === 'error' && (
                <span className="col-span-3 py-[2cqh] text-center font-serif text-[1.8cqh] text-red-400">
                  {manifestState.message}
                </span>
              )}
            </div>

            {/* Bottom: spawn-position checkbox + prompt input */}
            <div className="flex shrink-0 flex-col gap-[0.8cqh]">
              <label className="flex cursor-pointer items-center gap-[0.5cqw] font-serif text-[1.8cqh] text-text-muted">
                <input
                  type="checkbox"
                  checked={spawnAtCenter}
                  onChange={(e) => setSpawnAtCenter(e.target.checked)}
                  className="h-[1.4cqh] w-[1.4cqh] accent-text-primary"
                />
                {t('app.sceneEdit.spawnAtCenter', { defaultValue: 'Spawn at centre of view' })}
              </label>
              <input
                ref={inputRef}
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onMouseDown={() => dispatch({ type: 'LOCK' })}
                onFocus={() => dispatch({ type: 'LOCK' })}
                placeholder={t('app.sceneEdit.placeholder')}
                disabled={mode !== 'open'}
                className={`
                  ${SETTINGS_CONTROL_BASE}
                  ${SETTINGS_CONTROL_TEXT}
                  w-full outline-none
                  focus:ring-1 focus:ring-border-medium
                  disabled:cursor-not-allowed disabled:opacity-50
                `}
              />
              <span className="font-serif text-[1.4cqh] text-text-muted">{t('app.sceneEdit.instructions')}</span>
            </div>

            {/* Spinner overlay during submitting */}
            {mode === 'submitting' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div
                  className="
                    h-[3cqh] w-[3cqh] animate-spin rounded-full border-[0.4cqh] border-text-muted border-t-text-primary
                  "
                />
              </div>
            )}

            {/* Error banner */}
            {mode === 'error' && (
              <div
                className="
                  absolute inset-x-[1.4cqw] bottom-[1.6cqh] border border-red-500/60 bg-red-900/85 p-[0.8cqh_1.2cqw]
                  font-serif text-[1.8cqh] text-red-100 backdrop-blur-sm
                "
              >
                {errorMessage}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default SceneEditOverlay
