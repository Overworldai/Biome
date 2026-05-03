import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SettingsProvider } from './hooks/useSettings'
import { PortalProvider } from './context/PortalContext'
import { usePortal } from './context/portalContextValue'
import { StreamingProvider } from './context/StreamingContext'
import { useStreaming } from './context/streamingContextValue'
import { VortexProvider } from './context/VortexContext'
import { AudioProvider } from './context/AudioContext'
import { useAudio } from './context/audioContextValue'
import AudioController from './components/AudioController'
import { useAppStartup } from './hooks/useAppStartup'
import { invoke } from './bridge'
import type { AppUpdateInfo } from './types/ipc'
import VideoContainer from './components/VideoContainer'
import MenuSettingsView from './components/MenuSettingsView'
import BackgroundSlideshow from './components/BackgroundSlideshow'
import PortalPreview from './components/PortalPreview'
import VortexHost from './components/VortexHost'
import TerminalDisplay from './components/TerminalDisplay'
import SocialCtaRow from './components/SocialCtaRow'
import ViewLabel from './components/ui/ViewLabel'
import MenuButton from './components/ui/MenuButton'
import PauseOverlay from './components/PauseOverlay'
import SceneEditOverlay from './components/SceneEditOverlay'
import ConnectionLostOverlay from './components/ConnectionLostOverlay'
import WindowControls from './components/WindowControls'
import ConfirmModal from './components/ui/ConfirmModal'
import useBackgroundCycle from './hooks/useBackgroundCycle'
import usePortalGlowSample from './hooks/usePortalGlowSample'
import { usePortalAnimator } from './hooks/usePortalAnimator'
import {
  PORTAL_SPARKS_DEBUG,
  SCENE_EDIT_DEBUG_PREVIEW,
  SCENE_EDIT_PROMPT_TOAST_MS,
  SCENE_EDIT_PREVIEW_TOAST_MS,
  MENU_VIEW,
  type MenuViewKey
} from './constants'
import { viewFadeVariants } from './transitions'
import PortalSparksConfigurator from './components/PortalSparksConfigurator'
import PerformanceStatsOverlay from './components/PerformanceStatsOverlay'
import InputOverlay from './components/InputOverlay'
import FrameTimelineOverlay from './components/FrameTimelineOverlay'
import I18nSync from './components/I18nSync'
import DevLocaleCycler from './components/DevLocaleCycler'
import FocusReticle from './components/ui/FocusReticle'
import { useGamepadNavigation } from './hooks/useGamepadNavigation'
import { useTranslation } from 'react-i18next'

const LAUNCH_PRE_SHRINK_MS = 420

/**
 * The mutually-exclusive visual phases the app can be in while animating
 * between portal states (MAIN_MENU / LOADING / STREAMING). A single enum
 * replaces the four interacting booleans we used to juggle — any phase other
 * than `idle` means an animation is in flight.
 *
 *   idle             – settled on whatever portal state we're in
 *   launch-shrink    – portal preview is shrinking on the main menu (420ms)
 *   launch-reveal    – loading UI is covering via `portalBgReveal`
 *   return-to-menu   – loading UI is uncovering via `portalBgConceal`
 *   streaming-reveal – streaming content is revealing via `streamingCircularReveal`
 */
type TransitionPhase = 'idle' | 'launch-shrink' | 'launch-reveal' | 'return-to-menu' | 'streaming-reveal'

/** Phase-specific modifier class applied to the loading UI layer while it
 *  animates. Phases not listed here don't mount the loading layer at all. */
const LOADING_LAYER_PHASE_CLASS: Partial<Record<TransitionPhase, string>> = {
  'launch-reveal': 'launch-revealing',
  'return-to-menu': 'launch-concealing',
  'streaming-reveal': 'streaming-pullout'
}

const AppShell = () => {
  const { t } = useTranslation()
  const [isPortalHovered, setIsPortalHovered] = useState(false)
  const { play, startLoop, fadeOutLoop } = useAudio()
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>('idle')
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(null)
  const [editPromptVisible, setEditPromptVisible] = useState(false)
  const [editPreviewVisible, setEditPreviewVisible] = useState(false)
  const editPromptKeyRef = useRef(0)
  const [prevStreamingUi, setPrevStreamingUi] = useState(false)
  // Externally-drivable portal animator. Settings opening calls `close()` to
  // shrink + hide; settings closing calls `respawn()` to unhide (the normal
  // enter animation then fires via PortalPreview's media-ready flow).
  const portalAnimator = usePortalAnimator()
  const [prevSettingsOpen, setPrevSettingsOpen] = useState(false)

  const {
    state: portalState,
    states: portalStates,
    isConnected,
    isSettingsOpen,
    toggleSettings,
    transitionTo
  } = usePortal()
  const { isStreaming, isUIActive, connectionState, prepareReturnToMainMenu, sceneEditState } = useStreaming()
  useGamepadNavigation(isUIActive)
  const {
    getBackgroundVideoElement,
    getPortalVideoElement,
    currentIndex,
    nextIndex,
    portalIndex,
    isTransitioning,
    isPortalShrinking,
    transitionKey,
    portalVisible,
    isPortalEntering,
    triggerPortalEnter,
    completePortalShrink,
    completeTransition
  } = useBackgroundCycle(
    // Any time the portal isn't sitting idle on the main menu — hovered,
    // settings open, animating, or already inside a session.
    isPortalHovered ||
      (!isConnected && isSettingsOpen) ||
      transitionPhase !== 'idle' ||
      portalState === portalStates.LOADING ||
      portalState === portalStates.STREAMING
  )

  const nextVideoElement = getPortalVideoElement(portalIndex)
  const rendererReadySentRef = useRef(false)
  const portalReadyRef = useRef(false)
  const backgroundReadyRef = useRef(false)

  const showWindowIfReady = useCallback(() => {
    if (!portalReadyRef.current || !backgroundReadyRef.current) return
    if (rendererReadySentRef.current) return
    rendererReadySentRef.current = true
    invoke('renderer-ready')
  }, [])

  const handleInitialPreviewReady = useCallback(() => {
    portalReadyRef.current = true
    showWindowIfReady()
  }, [showWindowIfReady])

  const handleBackgroundReady = useCallback(() => {
    backgroundReadyRef.current = true
    showWindowIfReady()
  }, [showWindowIfReady])
  const isStreamingUi = portalState === portalStates.STREAMING && isStreaming
  // During `launch-reveal`, portalState is still MAIN_MENU (the transition to
  // LOADING only fires on animation end), so `isLoadingUi` is naturally false.
  // `isMainUi` needs the explicit guard — we're still on MAIN_MENU state but
  // visually the loading layer is covering the portal.
  const isLoadingUi = portalState === portalStates.LOADING
  const isMainUi = !isLoadingUi && !isStreamingUi && transitionPhase !== 'launch-reveal'
  const useMainBackground = !isStreamingUi
  const backgroundBlurCqh = isMainUi ? (isSettingsOpen ? 1.94 : 0.14) : 0
  const portalGlowRgb = usePortalGlowSample(portalVisible, nextVideoElement)
  const showMenuHome = isMainUi && !isConnected && !isSettingsOpen
  const showMenuSettings = isMainUi && !isConnected && isSettingsOpen
  const activeMenuView: MenuViewKey | null = useMemo(
    () => (showMenuHome ? MENU_VIEW.HOME : showMenuSettings ? MENU_VIEW.SETTINGS : null),
    [showMenuHome, showMenuSettings]
  )
  useEffect(() => {
    let cancelled = false

    const checkForUpdate = async () => {
      try {
        const result = await invoke('check-for-app-update')
        if (cancelled) return
        if (result.update_available) {
          setAvailableUpdate(result)
        }
      } catch (error) {
        console.warn('[UPDATES] Failed to check for update:', error)
      }
    }

    void checkForUpdate()

    return () => {
      cancelled = true
    }
  }, [])

  // Arm the streaming-reveal phase synchronously when isStreamingUi flips on,
  // so the loading layer's rendering condition (which depends on the phase)
  // doesn't see a one-render gap between `isLoadingUi` going false and the
  // phase flipping to `'streaming-reveal'`. A useEffect would lag by a frame
  // and the vortex canvas would briefly unmount, causing a particle reset
  // mid-transition. React restarts the render with the new state before
  // committing to the DOM.
  if (isStreamingUi !== prevStreamingUi) {
    setPrevStreamingUi(isStreamingUi)
    if (isStreamingUi) setTransitionPhase('streaming-reveal')
  }

  if (isSettingsOpen !== prevSettingsOpen) {
    setPrevSettingsOpen(isSettingsOpen)
    if (isSettingsOpen) portalAnimator.close()
    else portalAnimator.respawn()
  }

  const handlePortalShrinkComplete = () => {
    if (portalAnimator.isShrinking) portalAnimator.markShrinkComplete()
    else completePortalShrink()
  }

  // Show edit prompt + preview toasts when a scene edit completes, then auto-hide
  useEffect(() => {
    if (!sceneEditState.lastEditPrompt) return
    editPromptKeyRef.current += 1
    setEditPromptVisible(true)
    setEditPreviewVisible(true)
    const promptTimer = setTimeout(() => setEditPromptVisible(false), SCENE_EDIT_PROMPT_TOAST_MS)
    const previewTimer = setTimeout(() => setEditPreviewVisible(false), SCENE_EDIT_PREVIEW_TOAST_MS)
    return () => {
      clearTimeout(promptTimer)
      clearTimeout(previewTimer)
    }
  }, [sceneEditState.lastEditPrompt])

  useEffect(() => {
    if (!portalVisible) {
      setIsPortalHovered(false)
    }
  }, [portalVisible])

  // Play swoosh on background cycle transitions, but not during the launch
  // pre-shrink — `portal_swoosh_long` is already playing there.
  useEffect(() => {
    if (isPortalShrinking && transitionPhase !== 'launch-shrink') {
      play('portal_swoosh')
    }
  }, [isPortalShrinking, transitionPhase, play])

  useEffect(() => {
    if (!isLoadingUi && portalState === portalStates.MAIN_MENU) {
      setTransitionPhase('idle')
      setIsPortalHovered(false)
    }
  }, [isLoadingUi, portalState, portalStates.MAIN_MENU])

  useEffect(() => {
    if (transitionPhase !== 'launch-shrink') return

    const timer = window.setTimeout(() => {
      setTransitionPhase('launch-reveal')
    }, LAUNCH_PRE_SHRINK_MS)

    return () => window.clearTimeout(timer)
  }, [transitionPhase])

  const handleLaunch = () => {
    if (
      portalState === portalStates.MAIN_MENU &&
      connectionState !== 'connecting' &&
      !isSettingsOpen &&
      transitionPhase === 'idle'
    ) {
      play('portal_swoosh_long')
      fadeOutLoop('portal_hum', 0.15)
      setTransitionPhase('launch-shrink')
    }
  }

  const handleCancelLoading = () => {
    if (transitionPhase === 'return-to-menu' || portalState !== portalStates.LOADING) return
    play('portal_swoosh_long')
    setTransitionPhase('return-to-menu')
    setIsPortalHovered(false)
    void prepareReturnToMainMenu()
  }

  return (
    <div
      className={`
        app-shell relative flex size-full items-center justify-center
        ${isConnected && !isStreamingUi ? 'overflow-y-visible' : ''}
        ${isStreamingUi ? '' : ''}
      `}
    >
      <WindowControls />
      <div
        className={`
          app-shell-inner relative z-0 overflow-visible transition-transform duration-300 ease-in-out
          ${isStreamingUi ? 'aspect-auto! h-[100cqh] w-[100cqw] bg-black' : ''}
        `}
      >
        {useMainBackground && (
          <BackgroundSlideshow
            getVideoElement={getBackgroundVideoElement}
            currentIndex={currentIndex}
            nextIndex={nextIndex}
            blurCqh={backgroundBlurCqh}
            isTransitioning={isTransitioning}
            transitionKey={transitionKey}
            onTransitionComplete={completeTransition}
            onInitialReady={handleBackgroundReady}
          />
        )}
        {isMainUi && !isConnected && !portalAnimator.isHidden && (
          <div
            className={`
              absolute top-1/2 left-[49%] z-8 w-[42.67cqh] cursor-pointer transition-transform duration-180 ease-out
              ${isSettingsOpen ? 'pointer-events-none' : 'pointer-events-auto'}
            `}
            style={{ transform: `translate(-50%, -50%) scale(${isPortalHovered ? 1.05 : 1})` }}
            onMouseEnter={() => {
              setIsPortalHovered(true)
              startLoop('portal_hum', 1, 0.3)
            }}
            onMouseLeave={() => {
              setIsPortalHovered(false)
              fadeOutLoop('portal_hum', 0.3)
            }}
            onClick={() => {
              fadeOutLoop('portal_hum', 0.15)
              handleLaunch()
            }}
            role="button"
            tabIndex={0}
            data-focus-shape="round"
            data-focus-target=".portal-preview-core"
            data-default-focus
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleLaunch()
              }
            }}
          >
            <div className="relative w-full" style={{ paddingBottom: '123%' }}>
              <PortalPreview
                videoElement={nextVideoElement}
                hoverContent={nextVideoElement ? <VortexHost mode="portal" /> : undefined}
                isHovered={isPortalHovered}
                visible={portalVisible}
                isShrinking={isPortalShrinking || portalAnimator.isShrinking || transitionPhase === 'launch-shrink'}
                shrinkDurationMs={portalAnimator.isShrinking ? portalAnimator.shrinkDurationMs : undefined}
                isEntering={isPortalEntering}
                glowRgb={portalGlowRgb}
                portalSceneGlowRgb={portalGlowRgb}
                sparkGlowRgb={portalGlowRgb}
                onShrinkComplete={handlePortalShrinkComplete}
                onInitialPreviewReady={handleInitialPreviewReady}
                // The cycle's enter animation is kicked off by completePortalShrink
                // in parallel with the bg reveal. We don't want to re-trigger enter
                // when the video element swap lands at the end of the reveal.
                onMediaReady={() => {}}
              />
            </div>
          </div>
        )}
        <AnimatePresence mode="wait">
          {activeMenuView === MENU_VIEW.HOME && (
            <motion.div
              key={MENU_VIEW.HOME}
              className="pointer-events-none absolute inset-0 z-9"
              variants={viewFadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <SocialCtaRow />

              <ViewLabel>{t('app.name')}</ViewLabel>

              <MenuButton
                variant="secondary"
                size="lg"
                label="app.buttons.settings"
                className="
                  pointer-events-auto absolute right-(--edge-right) bottom-(--edge-bottom) z-1 m-0 box-border
                  min-w-[132px] appearance-none p-[0.9cqh_2.67cqh] tracking-tight
                "
                onClick={toggleSettings}
              />
            </motion.div>
          )}
          {activeMenuView === MENU_VIEW.SETTINGS && (
            <motion.div
              key={MENU_VIEW.SETTINGS}
              className="absolute inset-0"
              variants={viewFadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <MenuSettingsView onBack={toggleSettings} />
            </motion.div>
          )}
        </AnimatePresence>

        {isStreamingUi && (
          <main
            className={`
              content-area absolute inset-0 z-5 size-full bg-black opacity-100
              ${transitionPhase === 'streaming-reveal' ? 'streaming-reveal' : ''}
            `}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.animationName !== 'streamingCircularReveal') return
              setTransitionPhase('idle')
            }}
          >
            <VideoContainer />
            <PerformanceStatsOverlay />
            <InputOverlay />
            <FrameTimelineOverlay />
            <div className="pointer-events-none absolute z-2" id="logo-container"></div>
            <PauseOverlay />
            <SceneEditOverlay />
            {SCENE_EDIT_DEBUG_PREVIEW &&
              editPromptVisible &&
              sceneEditState.lastEditPrompt &&
              sceneEditState.phase === 'inactive' && (
                <div
                  key={editPromptKeyRef.current}
                  className="pointer-events-none absolute bottom-[3.2cqh] left-1/2 z-180 max-w-[80cqw] -translate-x-1/2"
                >
                  <div
                    className="
                      border border-white/20 bg-black/70 px-[2.1cqh] py-[0.9cqh] text-center font-serif text-[2cqh]
                      tracking-[0.01em] text-white/90 shadow-lg backdrop-blur-sm
                    "
                    style={{ animation: `streamingWarningToast ${SCENE_EDIT_PROMPT_TOAST_MS}ms ease forwards` }}
                  >
                    {sceneEditState.lastEditPrompt}
                  </div>
                </div>
              )}
            {SCENE_EDIT_DEBUG_PREVIEW && editPreviewVisible && sceneEditState.lastPreview && (
              <div
                className="pointer-events-none absolute right-[2cqw] bottom-[2cqh] z-40 flex flex-col gap-[0.5cqh]"
                style={{ animation: `streamingWarningToast ${SCENE_EDIT_PREVIEW_TOAST_MS}ms ease forwards` }}
              >
                <div className="flex flex-col items-end">
                  <span className="mb-[0.3cqh] font-serif text-[1.6cqh] text-white/70">Before</span>
                  <img
                    src={`data:image/jpeg;base64,${sceneEditState.lastPreview.originalB64}`}
                    alt="Before inpainting"
                    className="h-[18cqh] border border-white/30 shadow-lg"
                  />
                </div>
                <div className="flex flex-col items-end">
                  <span className="mb-[0.3cqh] font-serif text-[1.6cqh] text-white/70">After</span>
                  <img
                    src={`data:image/jpeg;base64,${sceneEditState.lastPreview.inpaintedB64}`}
                    alt="After inpainting"
                    className="h-[18cqh] border border-white/30 shadow-lg"
                  />
                </div>
              </div>
            )}
            <ConnectionLostOverlay />
          </main>
        )}
        {(isLoadingUi || LOADING_LAYER_PHASE_CLASS[transitionPhase]) && (
          <div
            className={`
              loading-ui-layer absolute inset-0
              ${transitionPhase === 'streaming-reveal' ? 'z-4' : 'z-20'}
              ${LOADING_LAYER_PHASE_CLASS[transitionPhase] ?? ''}
            `}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.animationName !== 'portalBgReveal' && event.animationName !== 'portalBgConceal') return
              if (transitionPhase === 'launch-reveal') {
                setTransitionPhase('idle')
                void transitionTo(portalStates.LOADING)
                return
              }
              if (transitionPhase === 'return-to-menu') {
                triggerPortalEnter()
                setTransitionPhase('idle')
                void transitionTo(portalStates.MAIN_MENU)
              }
            }}
          >
            <div className="pointer-events-none absolute inset-0 z-7" aria-hidden="true">
              <VortexHost mode="loading" />
            </div>
            {transitionPhase !== 'return-to-menu' && <TerminalDisplay onCancel={handleCancelLoading} />}
          </div>
        )}
      </div>
      {PORTAL_SPARKS_DEBUG && <PortalSparksConfigurator />}
      <FocusReticle />
      {availableUpdate && (
        <ConfirmModal
          title="app.dialogs.updateAvailable.title"
          description="app.dialogs.updateAvailable.description"
          descriptionParams={{
            latestVersion: availableUpdate.latest_version,
            currentVersion: availableUpdate.current_version
          }}
          onCancel={() => setAvailableUpdate(null)}
          onConfirm={() => {
            const releaseUrl = availableUpdate.release_url
            if (releaseUrl) {
              window.open(releaseUrl, '_blank', 'noopener,noreferrer')
            }
            setAvailableUpdate(null)
          }}
          confirmLabel="app.buttons.upgrade"
          cancelLabel="app.buttons.later"
        />
      )}
    </div>
  )
}

const App = () => {
  // Run startup tasks (unpack server files, etc.)
  useAppStartup()

  return (
    <SettingsProvider>
      <AudioProvider>
        <PortalProvider>
          <StreamingProvider>
            <VortexProvider>
              <I18nSync />
              {import.meta.env.DEV && <DevLocaleCycler />}
              <AudioController />
              <AppShell />
            </VortexProvider>
          </StreamingProvider>
        </PortalProvider>
      </AudioProvider>
    </SettingsProvider>
  )
}

export default App
