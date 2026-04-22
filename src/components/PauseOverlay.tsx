import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { useStreaming } from '../context/streamingContextValue'
import MenuSettingsView from './MenuSettingsView'
import PauseMainView from './PauseMainView'
import { PAUSE_VIEW, type PauseViewKey } from '../constants'
import { viewFadeVariants } from '../transitions'
import { useSeedManager } from '../hooks/useSeedManager'
import { useSceneOrder } from '../hooks/useSceneOrder'
import { usePointerLockFeedback } from '../hooks/usePointerLockFeedback'
import { useSceneActions } from '../hooks/useSceneActions'
import { RpcError } from '../lib/wsRpc'
import type { GenerateSceneResponse } from '../types/ws'
import type { SeedRecord } from '../types/app'
import { useSettings } from '../hooks/settingsContextValue'
import { FocusScope } from '../context/FocusScopeContext'

const PauseOverlay = ({ isActive }: { isActive: boolean }) => {
  const { t } = useTranslation()
  const { requestPointerLock, reset, wsRequest } = useStreaming()
  const { settings } = useSettings()
  const pauseMenuCode = settings.keybindings.pauseMenu
  const [view, setView] = useState<PauseViewKey>(PAUSE_VIEW.MAIN)
  const [generateState, setGenerateState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [generateError, setGenerateError] = useState<string | null>(null)
  const { showPauseLockoutTimer, pauseLockoutSecondsText, selectCooldown } = usePointerLockFeedback(isActive)

  const {
    seeds,
    seedsLoaded,
    thumbnails,
    uploadingImage,
    uploadError,
    removeScene: removeSceneFile,
    handleImageUpload,
    handleImageDrop,
    handleClipboardUpload
  } = useSeedManager({
    wsRequest,
    isActive,
    onPinnedSceneRemoved: (filename: string) => removeScene(filename)
  })

  const { pinnedSceneIds, unpinnedSceneIds, togglePinnedScene, removeScene, moveScene } = useSceneOrder({
    seeds,
    isLoaded: seedsLoaded
  })

  const { pinnedScenes, unpinnedScenes } = useMemo(() => {
    const byFilename = new Map(seeds.map((s) => [s.filename, s]))
    const resolve = (ids: string[]): SeedRecord[] =>
      ids.map((id) => byFilename.get(id)).filter((s): s is SeedRecord => s !== undefined)
    return { pinnedScenes: resolve(pinnedSceneIds), unpinnedScenes: resolve(unpinnedSceneIds) }
  }, [seeds, pinnedSceneIds, unpinnedSceneIds])

  const { selectScene, pasteScene } = useSceneActions(handleClipboardUpload, isActive && view !== PAUSE_VIEW.SETTINGS)

  useEffect(() => {
    if (!isActive) {
      setView(PAUSE_VIEW.MAIN)
      setGenerateState('idle')
      setGenerateError(null)
      return
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      // Escape is always a safety-escape; the user's configured pauseMenu key also re-locks.
      if (e.key !== 'Escape' && e.code !== pauseMenuCode) return
      // Settings view handles its own Escape (to save draft settings before navigating)
      if (view === PAUSE_VIEW.SETTINGS) return
      if (generateState === 'loading') return
      requestPointerLock()
    }

    window.addEventListener('keyup', handleKeyUp)
    return () => window.removeEventListener('keyup', handleKeyUp)
  }, [isActive, view, generateState, requestPointerLock, pauseMenuCode])

  // Auto-dismiss generate error after 5 seconds
  useEffect(() => {
    if (generateState !== 'error') return
    const timer = setTimeout(() => {
      setGenerateState('idle')
      setGenerateError(null)
    }, 5000)
    return () => clearTimeout(timer)
  }, [generateState])

  const handleGenerateScene = useCallback(
    async (prompt: string) => {
      setGenerateState('loading')
      setGenerateError(null)
      try {
        await wsRequest<GenerateSceneResponse>('generate_scene', { prompt }, 60_000)
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
    [wsRequest, t]
  )

  const handleResetAndResume = () => {
    reset()
    requestPointerLock()
  }

  return (
    <FocusScope
      active={isActive && view !== PAUSE_VIEW.SETTINGS}
      autoFocus
      onCancel={requestPointerLock}
      className={`
        absolute inset-0 z-45 bg-black/34 backdrop-blur-[1.94cqh] transition-opacity duration-240 ease-in-out
        ${isActive ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}
      `}
    >
      <div className="overlay-darken pointer-events-none absolute inset-0" />
      <AnimatePresence mode="wait">
        {view === PAUSE_VIEW.SETTINGS ? (
          <motion.div
            key={PAUSE_VIEW.SETTINGS}
            className="absolute inset-0"
            variants={viewFadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <MenuSettingsView onBack={() => setView(PAUSE_VIEW.MAIN)} wide />
          </motion.div>
        ) : (
          <motion.div
            key={PAUSE_VIEW.MAIN}
            className="absolute inset-0"
            variants={viewFadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <PauseMainView
              pinnedScenes={pinnedScenes}
              unpinnedScenes={unpinnedScenes}
              thumbnails={thumbnails}
              selectCooldown={selectCooldown}
              uploadingImage={uploadingImage}
              uploadError={uploadError}
              onSceneSelect={selectScene}
              onTogglePin={togglePinnedScene}
              onRemoveScene={removeSceneFile}
              onMoveScene={moveScene}
              onResetAndResume={handleResetAndResume}
              onNavigateSettings={() => setView(PAUSE_VIEW.SETTINGS)}
              onImageUpload={handleImageUpload}
              onImageDrop={handleImageDrop}
              onClipboardUpload={pasteScene}
              requestPointerLock={requestPointerLock}
              showPauseLockoutTimer={showPauseLockoutTimer}
              pauseLockoutSecondsText={pauseLockoutSecondsText}
              generateState={generateState}
              generateError={generateError}
              onGenerateScene={handleGenerateScene}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </FocusScope>
  )
}

export default PauseOverlay
