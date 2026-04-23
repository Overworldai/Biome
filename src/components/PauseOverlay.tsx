import { useEffect, useMemo, useState } from 'react'
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
import { useSceneGeneration } from '../hooks/useSceneGeneration'
import type { SeedRecord } from '../types/app'
import { useSettings } from '../hooks/settingsContextValue'
import { FocusScope } from '../context/FocusScopeContext'

const PauseOverlayContent = () => {
  const { requestPointerLock, wsRequest } = useStreaming()
  const { settings } = useSettings()
  const pauseMenuCode = settings.keybindings.pauseMenu
  const [view, setView] = useState<PauseViewKey>(PAUSE_VIEW.MAIN)
  const { selectCooldown } = usePointerLockFeedback(true)

  const {
    seeds,
    seedsLoaded,
    thumbnails,
    uploadingImage,
    uploadError,
    removeScene: removeSceneFile,
    refreshSeeds,
    handleImageUpload,
    handleImageDrop,
    handleClipboardUpload
  } = useSeedManager({
    wsRequest,
    isActive: true,
    onPinnedSceneRemoved: (filename: string) => removeScene(filename)
  })

  const { sceneIds, removeScene, moveScene } = useSceneOrder({
    seeds,
    isLoaded: seedsLoaded
  })

  const scenes = useMemo(() => {
    const byFilename = new Map(seeds.map((s) => [s.filename, s]))
    return sceneIds.map((id) => byFilename.get(id)).filter((s): s is SeedRecord => s !== undefined)
  }, [seeds, sceneIds])

  const { selectScene } = useSceneActions(handleClipboardUpload, view !== PAUSE_VIEW.SETTINGS)

  const { generateError, isGenerating, lastGeneratedFilename, generate } = useSceneGeneration({
    refreshSeeds,
    isActive: true
  })

  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      // Escape is always a safety-escape; the user's configured pauseMenu key also re-locks.
      if (e.key !== 'Escape' && e.code !== pauseMenuCode) return
      // Settings view handles its own Escape (to save draft settings before navigating)
      if (view === PAUSE_VIEW.SETTINGS) return
      if (isGenerating) return
      requestPointerLock()
    }

    window.addEventListener('keyup', handleKeyUp)
    return () => window.removeEventListener('keyup', handleKeyUp)
  }, [view, isGenerating, requestPointerLock, pauseMenuCode])

  return (
    <FocusScope
      active={view !== PAUSE_VIEW.SETTINGS}
      autoFocus
      onCancel={requestPointerLock}
      className="pointer-events-auto absolute inset-0 z-45 bg-black/34 backdrop-blur-[1.94cqh]"
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
            <MenuSettingsView onBack={() => setView(PAUSE_VIEW.MAIN)} />
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
              scenes={scenes}
              thumbnails={thumbnails}
              selectCooldown={selectCooldown}
              uploadingImage={uploadingImage}
              uploadError={uploadError}
              onSceneSelect={selectScene}
              onRemoveScene={removeSceneFile}
              onMoveScene={moveScene}
              onNavigateSettings={() => setView(PAUSE_VIEW.SETTINGS)}
              onImageUpload={handleImageUpload}
              onImageDrop={handleImageDrop}
              requestPointerLock={requestPointerLock}
              isGenerating={isGenerating}
              generateError={generateError}
              lastGeneratedFilename={lastGeneratedFilename}
              onGenerateScene={generate}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </FocusScope>
  )
}

/** The pause menu: shown whenever the user is paused mid-stream. Doubles as
 *  the first-entry screen (right after LOADING→STREAMING). Self-mounts via
 *  AnimatePresence so App.tsx just drops `<PauseOverlay />` in and the overlay
 *  never lingers in the DOM while inactive. */
const PauseOverlay = () => {
  const { isPaused, sceneEditState } = useStreaming()
  const visible = isPaused && sceneEditState.phase === 'inactive'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="pause-overlay"
          className="absolute inset-0 z-45"
          variants={viewFadeVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <PauseOverlayContent />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default PauseOverlay
