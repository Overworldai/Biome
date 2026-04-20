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
import { useSceneActions } from '../hooks/useSceneActions'
import { useSettings } from '../hooks/useSettings'
import { FocusScope } from '../context/FocusScopeContext'

const PauseOverlay = ({ isActive }: { isActive: boolean }) => {
  const { requestPointerLock, reset, wsRequest } = useStreaming()
  const { settings } = useSettings()
  const pauseMenuCode = settings.keybindings.pauseMenu
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

  const pinnedScenes = useMemo(() => seeds.filter((s) => pinnedSceneIds.includes(s.filename)), [seeds, pinnedSceneIds])

  const { selectScene, pasteScene } = useSceneActions(handleClipboardUpload, isActive && view !== PAUSE_VIEW.SETTINGS)

  useEffect(() => {
    if (!isActive) {
      setView(PAUSE_VIEW.MAIN)
      return
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      // Escape is always a safety-escape; the user's configured pauseMenu key also re-locks.
      if (e.key !== 'Escape' && e.code !== pauseMenuCode) return
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
  }, [isActive, view, requestPointerLock, pauseMenuCode])

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
