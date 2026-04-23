import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { useStreaming } from '../context/streamingContextValue'
import { useSeedManager } from '../hooks/useSeedManager'
import SceneCard from './SceneCard'
import MenuButton from './ui/MenuButton'
import { FocusScope } from '../context/FocusScopeContext'
import { viewFadeVariants } from '../transitions'

function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const ReadyOverlayContent = () => {
  const { t } = useTranslation()
  const { wsRequest, canUnpause, selectSeed, requestPointerLock, cancelConnection } = useStreaming()

  const { seeds, seedsLoaded, thumbnails } = useSeedManager({
    wsRequest,
    isActive: true,
    // Ready overlay never renders a delete affordance, but the hook requires the callback.
    onPinnedSceneRemoved: () => {}
  })

  const selectScene = useCallback(
    async (filename: string) => {
      await selectSeed(filename)
      requestPointerLock()
    },
    [selectSeed, requestPointerLock]
  )

  // Freeze a random ordering of all seeds on first load. We shuffle once and
  // keep that order for the overlay's lifetime so late-arriving thumbnails /
  // re-renders don't reshuffle the grid underneath the user.
  const [shuffledFilenames, setShuffledFilenames] = useState<string[] | null>(null)
  useEffect(() => {
    if (shuffledFilenames !== null) return
    if (!seedsLoaded || seeds.length === 0) return
    setShuffledFilenames(shuffle(seeds).map((s) => s.filename))
  }, [seedsLoaded, seeds, shuffledFilenames])

  const shuffledScenes = useMemo(() => {
    if (!shuffledFilenames) return []
    const byFilename = new Map(seeds.map((s) => [s.filename, s]))
    return shuffledFilenames.map((f) => byFilename.get(f)).filter((s): s is (typeof seeds)[number] => s !== undefined)
  }, [seeds, shuffledFilenames])

  return (
    <FocusScope
      active
      autoFocus
      className="pointer-events-auto absolute inset-0 z-45 grid place-items-center bg-black/34 backdrop-blur-[1.94cqh]"
    >
      <div className="overlay-darken pointer-events-none absolute inset-0" />
      {/* Outer wrapper is `relative` but not a scroll container. Its height
          collapses to the grid's scroll container, so `place-items-center` on
          the FocusScope centers the grid block exactly on the viewport. The
          heading and button are absolutely anchored above/below this wrapper,
          outside any overflow clipping. */}
      <div className="relative w-[80%] max-w-[160cqh]">
        <p className="absolute inset-x-0 bottom-full mb-[2cqh] font-serif text-[7cqh] leading-none text-text-primary">
          {t('app.ready.cta')}
        </p>

        <div className="styled-scrollbar max-h-[60cqh] overflow-y-auto pr-[0.8cqh]">
          <div className="grid w-full grid-cols-5 gap-[1.28cqh]">
            {shuffledScenes.map((scene) => (
              <div key={scene.filename} className="w-full">
                <SceneCard
                  seed={scene}
                  thumbnailSrc={thumbnails[scene.filename]}
                  selectCooldown={!canUnpause}
                  onSelect={selectScene}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="absolute top-full right-0 mt-[1cqh]">
          <MenuButton
            variant="primary"
            size="sm"
            label="app.buttons.returnToMainMenu"
            onClick={() => void cancelConnection()}
          />
        </div>
      </div>
    </FocusScope>
  )
}

/** The ready-to-play screen: shown once per session between loading and first
 *  gameplay, replacing the pause menu on first entry. Self-mounts via
 *  AnimatePresence so App.tsx just drops `<ReadyOverlay />` into the streaming
 *  tree without any conditional wiring. */
const ReadyOverlay = () => {
  const { isPaused, hasEnteredGameplay, sceneEditState } = useStreaming()
  const visible = !hasEnteredGameplay && isPaused && sceneEditState.phase === 'inactive'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="ready-overlay"
          className="absolute inset-0 z-45"
          variants={viewFadeVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <ReadyOverlayContent />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default ReadyOverlay
