import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { useStreaming } from '../context/streamingContextValue'
import { useSeedManager } from '../hooks/useSeedManager'
import SceneCard from './SceneCard'
import MenuButton from './ui/MenuButton'
import { FocusScope } from '../context/FocusScopeContext'
import { HEADING_BASE } from '../styles'
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
      <div className="relative flex max-h-[75cqh] w-[80%] max-w-[160cqh] flex-col items-center px-[2cqh]">
        <h1
          className={`
            ${HEADING_BASE}
            mb-[1.5cqh] text-center text-[11.73cqh] text-text-primary
          `}
        >
          {t('app.ready.heading')}
        </h1>
        <p className="m-0 mb-[2cqh] text-center font-serif text-[3.5cqh] text-text-muted">{t('app.ready.subtitle')}</p>

        <div className="styled-scrollbar min-h-0 w-full flex-1 overflow-y-auto pr-[0.8cqh]">
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

        <div className="mt-[1.5cqh] flex w-full justify-end">
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
