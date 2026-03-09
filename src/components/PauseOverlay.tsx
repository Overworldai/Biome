import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStreaming } from '../context/StreamingContext'
import MenuSettingsView from './MenuSettingsView'
import PauseMainView from './PauseMainView'
import PauseScenesView from './PauseScenesView'
import { PAUSE_VIEW, PAUSE_OVERLAY_CRT, type PauseViewKey } from '../constants'
import { viewFadeVariants } from '../transitions'
import { useSeedManager } from '../hooks/useSeedManager'
import { usePinnedScenes } from '../hooks/usePinnedScenes'

const PauseOverlay = ({ isActive }: { isActive: boolean }) => {
  const {
    canUnpause,
    unlockDelayMs,
    pauseElapsedMs,
    pointerLockBlockedSeq,
    requestPointerLock,
    reset,
    sendPromptWithSeed,
    wsRequest
  } = useStreaming()
  const [view, setView] = useState<PauseViewKey>(PAUSE_VIEW.MAIN)
  const [showUnlockHint, setShowUnlockHint] = useState(false)
  const lastPointerLockBlockedSeqRef = useRef(0)

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

  useEffect(() => {
    if (!isActive) {
      setView(PAUSE_VIEW.MAIN)
      setShowUnlockHint(false)
      return
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Settings view handles its own Escape (to save draft settings before navigating)
      if (view === PAUSE_VIEW.SETTINGS) return
      if (view === PAUSE_VIEW.SCENES) {
        setView(PAUSE_VIEW.MAIN)
      } else {
        requestPointerLock()
      }
    }

    window.addEventListener('keyup', handleKeyUp)
    return () => window.removeEventListener('keyup', handleKeyUp)
  }, [isActive, view, requestPointerLock])

  useEffect(() => {
    if (!showUnlockHint) return
    const timer = window.setTimeout(() => setShowUnlockHint(false), 1200)
    return () => window.clearTimeout(timer)
  }, [showUnlockHint])

  useEffect(() => {
    if (canUnpause) {
      setShowUnlockHint(false)
    }
  }, [canUnpause])

  useEffect(() => {
    if (!isActive) return
    if (pointerLockBlockedSeq <= 0) return
    if (pointerLockBlockedSeq === lastPointerLockBlockedSeqRef.current) return
    lastPointerLockBlockedSeqRef.current = pointerLockBlockedSeq
    setShowUnlockHint(true)
  }, [isActive, pointerLockBlockedSeq])

  const pinnedScenes = useMemo(() => seeds.filter((s) => pinnedSceneIds.includes(s.filename)), [seeds, pinnedSceneIds])
  const pauseLockoutRemainingMs = Math.max(0, unlockDelayMs - pauseElapsedMs)
  const showPauseLockoutTimer = isActive && !canUnpause && pauseLockoutRemainingMs > 0 && showUnlockHint
  const pauseLockoutSecondsText = (pauseLockoutRemainingMs / 1000).toFixed(1)

  const handleSceneSelect = (filename: string) => {
    sendPromptWithSeed(filename)
    requestPointerLock()
  }

  const handleResetAndResume = () => {
    reset()
    requestPointerLock()
  }

  return (
    <div
      className={`absolute inset-0 z-45 transition-opacity duration-[240ms] ease-in-out bg-black/[0.34] ${PAUSE_OVERLAY_CRT ? 'backdrop-blur-[7px]' : 'backdrop-blur-[14px]'} ${isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      id="pause-overlay"
    >
      {PAUSE_OVERLAY_CRT && (
        <div className="absolute inset-0 pointer-events-none [background:repeating-linear-gradient(0deg,transparent_0px,transparent_2px,rgba(255,255,255,0.04)_2px,rgba(255,255,255,0.04)_4px)]" />
      )}
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
            <MenuSettingsView onBack={() => setView(PAUSE_VIEW.MAIN)} />
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
              onSceneSelect={handleSceneSelect}
              onTogglePin={togglePinnedScene}
              onRemoveScene={removeScene}
              onResetAndResume={handleResetAndResume}
              onNavigate={(v) => setView(v === 'scenes' ? PAUSE_VIEW.SCENES : PAUSE_VIEW.SETTINGS)}
              requestPointerLock={requestPointerLock}
              showPauseLockoutTimer={showPauseLockoutTimer}
              pauseLockoutSecondsText={pauseLockoutSecondsText}
              showUnlockHint={showUnlockHint}
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
              uploadingImage={uploadingImage}
              uploadError={uploadError}
              onSceneSelect={handleSceneSelect}
              onTogglePin={togglePinnedScene}
              onRemoveScene={removeScene}
              onImageUpload={handleImageUpload}
              onImageDrop={handleImageDrop}
              onClipboardUpload={handleClipboardUpload}
              onBack={() => setView(PAUSE_VIEW.MAIN)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default PauseOverlay
