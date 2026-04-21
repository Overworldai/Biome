import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { useStreaming } from '../context/StreamingContext'
import MenuSettingsView from './MenuSettingsView'
import PauseMainView from './PauseMainView'
import PauseScenesView from './PauseScenesView'
import { PAUSE_VIEW, type PauseViewKey } from '../constants'
import { viewFadeVariants } from '../transitions'
import { useSeedManager } from '../hooks/useSeedManager'
import { usePinnedScenes } from '../hooks/usePinnedScenes'
import { usePointerLockFeedback } from '../hooks/usePointerLockFeedback'
import { useSceneActions } from '../hooks/useSceneActions'
import { RpcError } from '../lib/wsRpc'
import type { GenerateSceneResponse } from '../types/ws'
import { useSettings } from '../hooks/useSettings'
import { FocusScope } from '../context/FocusScopeContext'

const PauseOverlay = ({ isActive }: { isActive: boolean }) => {
  const { t } = useTranslation()
  const { requestPointerLock, reset, wsRequest } = useStreaming()
  const { settings } = useSettings()
  const pauseMenuCode = settings.keybindings.pauseMenu
  const [view, setView] = useState<PauseViewKey>(PAUSE_VIEW.MAIN)
  const [generateState, setGenerateState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [generateError, setGenerateError] = useState<string | null>(null)
  const { showUnlockHint, showPauseLockoutTimer, pauseLockoutSecondsText, selectCooldown } =
    usePointerLockFeedback(isActive)

  const { pinnedSceneIds, togglePinnedScene, removePinnedScene } = usePinnedScenes()

  const {
    seeds,
    thumbnails,
    uploadingImage,
    uploadError,
    removeScene,
    handleImageUpload,
    handleImageDrop,
    handleClipboardUpload
  } = useSeedManager({
    wsRequest,
    isActive,
    onPinnedSceneRemoved: removePinnedScene
  })

  const pinnedScenes = useMemo(() => seeds.filter((s) => pinnedSceneIds.includes(s.filename)), [seeds, pinnedSceneIds])

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
      if (view === PAUSE_VIEW.SCENES) {
        setView(PAUSE_VIEW.MAIN)
      } else {
        requestPointerLock()
      }
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
      onCancel={() => {
        if (view === PAUSE_VIEW.SCENES) setView(PAUSE_VIEW.MAIN)
        else requestPointerLock()
      }}
      className={`absolute inset-0 z-45 transition-opacity duration-[240ms] ease-in-out bg-black/[0.34] backdrop-blur-[1.94cqh] ${isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
    >
      <div className="overlay-darken absolute inset-0 pointer-events-none" />
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
        ) : view === PAUSE_VIEW.MAIN ? (
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
              thumbnails={thumbnails}
              selectCooldown={selectCooldown}
              onSceneSelect={selectScene}
              onTogglePin={togglePinnedScene}
              onRemoveScene={removeScene}
              onResetAndResume={handleResetAndResume}
              onNavigate={(v) => setView(v === 'scenes' ? PAUSE_VIEW.SCENES : PAUSE_VIEW.SETTINGS)}
              requestPointerLock={requestPointerLock}
              showPauseLockoutTimer={showPauseLockoutTimer}
              pauseLockoutSecondsText={pauseLockoutSecondsText}
              showUnlockHint={showUnlockHint}
              generateState={generateState}
              generateError={generateError}
              onGenerateScene={handleGenerateScene}
            />
          </motion.div>
        ) : (
          <motion.div
            key={PAUSE_VIEW.SCENES}
            className="absolute inset-0"
            variants={viewFadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <PauseScenesView
              seeds={seeds}
              thumbnails={thumbnails}
              pinnedSceneIds={pinnedSceneIds}
              selectCooldown={selectCooldown}
              uploadingImage={uploadingImage}
              uploadError={uploadError}
              onSceneSelect={selectScene}
              onTogglePin={togglePinnedScene}
              onRemoveScene={removeScene}
              onImageUpload={handleImageUpload}
              onImageDrop={handleImageDrop}
              onClipboardUpload={pasteScene}
              onBack={() => setView(PAUSE_VIEW.MAIN)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </FocusScope>
  )
}

export default PauseOverlay
