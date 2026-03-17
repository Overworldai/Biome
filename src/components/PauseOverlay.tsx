import { useEffect, useMemo, useState } from 'react'
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

const PauseOverlay = ({ isActive }: { isActive: boolean }) => {
  const { requestPointerLock, reset, sendPromptWithSeed, wsRequest } = useStreaming()
  const [view, setView] = useState<PauseViewKey>(PAUSE_VIEW.MAIN)
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

  useEffect(() => {
    if (!isActive) {
      setView(PAUSE_VIEW.MAIN)
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

  const pinnedScenes = useMemo(() => seeds.filter((s) => pinnedSceneIds.includes(s.filename)), [seeds, pinnedSceneIds])

  const handleSceneSelect = (filename: string) => {
    sendPromptWithSeed(filename)
    requestPointerLock()
  }

  const handleClipboardUploadAndSelect = async () => {
    const uploaded = await handleClipboardUpload()
    if (uploaded.length === 1) {
      handleSceneSelect(uploaded[0])
    }
  }

  const handleResetAndResume = () => {
    reset()
    requestPointerLock()
  }

  return (
    <div
      className={`absolute inset-0 z-45 transition-opacity duration-[240ms] ease-in-out bg-black/[0.34] backdrop-blur-[1.94cqh] ${isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      id="pause-overlay"
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
              selectCooldown={selectCooldown}
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
              selectCooldown={selectCooldown}
              uploadingImage={uploadingImage}
              uploadError={uploadError}
              onSceneSelect={handleSceneSelect}
              onTogglePin={togglePinnedScene}
              onRemoveScene={removeScene}
              onImageUpload={handleImageUpload}
              onImageDrop={handleImageDrop}
              onClipboardUpload={handleClipboardUploadAndSelect}
              onBack={() => setView(PAUSE_VIEW.MAIN)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default PauseOverlay
