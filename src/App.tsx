import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { resolveStage } from './stages'
import { SettingsProvider } from './hooks/useSettings'
import { PortalProvider, usePortal } from './context/PortalContext'
import { StreamingProvider, useStreaming } from './context/StreamingContext'
import { VortexProvider } from './context/VortexContext'
import { AudioProvider } from './context/AudioContext'
import { useAudio } from './context/AudioContext'
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
import useSceneGlowColor from './hooks/useSceneGlowColor'
import usePortalGlowSample from './hooks/usePortalGlowSample'
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
import FocusReticle from './components/ui/FocusReticle'
import { useGamepadNavigation } from './hooks/useGamepadNavigation'
import { useTranslation } from 'react-i18next'

const LAUNCH_PRE_SHRINK_MS = 420

const AppShell = () => {
  const { t } = useTranslation()
  const [isPortalHovered, setIsPortalHovered] = useState(false)
  const { play, startLoop, stopLoop, fadeOutLoop } = useAudio()
  const [isLaunchShrinking, setIsLaunchShrinking] = useState(false)
  const [isEnteringLoading, setIsEnteringLoading] = useState(false)
  const [isReturningToMenu, setIsReturningToMenu] = useState(false)
  const [isStreamingReveal, setIsStreamingReveal] = useState(false)
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(null)
  const [editPromptVisible, setEditPromptVisible] = useState(false)
  const [editPreviewVisible, setEditPreviewVisible] = useState(false)
  const editPromptKeyRef = useRef(0)
  const prevStreamingUiRef = useRef(false)
  const {
    state: portalState,
    states: portalStates,
    isConnected,
    isSettingsOpen,
    toggleSettings,
    transitionTo
  } = usePortal()
  const {
    isStreaming,
    isPaused,
    isUIActive,
    connectionState,
    connectionLost,
    statusStage,
    prepareReturnToMainMenu,
    sceneEditState
  } = useStreaming()
  useGamepadNavigation(isUIActive)
  const {
    getVideoElement,
    currentIndex,
    nextIndex,
    isTransitioning,
    isPortalShrinking,
    transitionKey,
    portalVisible,
    isPortalEntering,
    triggerPortalEnter,
    completePortalShrink,
    completeTransition
  } = useBackgroundCycle(
    isPortalHovered ||
      (!isConnected && isSettingsOpen) ||
      isLaunchShrinking ||
      isEnteringLoading ||
      isReturningToMenu ||
      portalState === portalStates.LOADING ||
      portalState === portalStates.STREAMING
  )

  const nextVideoElement = getVideoElement(nextIndex)
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
  const isLaunchTransition = isEnteringLoading
  const isStreamingUi = portalState === portalStates.STREAMING && isStreaming
  const isLoadingUi = !isLaunchTransition && portalState === portalStates.LOADING
  const isMainUi = !isLaunchTransition && !isLoadingUi && !isStreamingUi
  const useMainBackground = !isStreamingUi
  const backgroundBlurCqh = isMainUi ? (isSettingsOpen ? 1.94 : 0.14) : 0
  const portalGlowRgb = usePortalGlowSample(portalVisible, nextVideoElement)
  const showMenuHome = isMainUi && !isConnected && !isSettingsOpen
  const showMenuSettings = isMainUi && !isConnected && isSettingsOpen
  const activeMenuView: MenuViewKey | null = useMemo(
    () => (showMenuHome ? MENU_VIEW.HOME : showMenuSettings ? MENU_VIEW.SETTINGS : null),
    [showMenuHome, showMenuSettings]
  )
  const resolvedStage = statusStage ? resolveStage(statusStage) : null
  const loadingProgressPercent = Math.max(0, Math.min(100, Math.round(resolvedStage?.percent ?? 0)))
  const loadingLayerStyle = {
    '--vortex-progress-percent': loadingProgressPercent.toString()
  } as CSSProperties

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

  useEffect(() => {
    if (isStreamingUi && !prevStreamingUiRef.current) {
      setIsStreamingReveal(true)
    }
    prevStreamingUiRef.current = isStreamingUi
  }, [isStreamingUi])

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

  // Play swoosh on background cycle transitions
  useEffect(() => {
    if (isPortalShrinking && !isLaunchShrinking) {
      play('portal_swoosh')
    }
  }, [isPortalShrinking, isLaunchShrinking, play])

  useEffect(() => {
    if (!isLoadingUi && portalState === portalStates.MAIN_MENU) {
      setIsEnteringLoading(false)
      setIsLaunchShrinking(false)
      setIsReturningToMenu(false)
      setIsPortalHovered(false)
    }
  }, [isLoadingUi, portalState, portalStates.MAIN_MENU])

  useEffect(() => {
    if (!isLaunchShrinking) return

    const timer = window.setTimeout(() => {
      setIsLaunchShrinking(false)
      setIsEnteringLoading(true)
    }, LAUNCH_PRE_SHRINK_MS)

    return () => window.clearTimeout(timer)
  }, [isLaunchShrinking])

  const handleLaunch = () => {
    if (
      portalState === portalStates.MAIN_MENU &&
      connectionState !== 'connecting' &&
      !isSettingsOpen &&
      !isEnteringLoading &&
      !isLaunchShrinking
    ) {
      play('portal_swoosh_long')
      fadeOutLoop('portal_hum', 0.15)
      setIsLaunchShrinking(true)
    }
  }

  const handleCancelLoading = () => {
    if (isReturningToMenu || portalState !== portalStates.LOADING) return
    play('portal_swoosh_long')
    setIsReturningToMenu(true)
    setIsPortalHovered(false)
    void prepareReturnToMainMenu()
  }

  return (
    <div
      className={`app-shell relative flex h-full w-full items-center justify-center ${isConnected && !isStreamingUi ? 'overflow-y-visible' : ''} ${isStreamingUi ? '' : ''}`}
    >
      <WindowControls />
      <div
        className={`app-shell-inner relative z-0 overflow-visible transition-transform duration-300 ease-in-out ${isStreamingUi ? 'w-[100cqw] h-[100cqh] !aspect-auto bg-black' : ''}`}
      >
        {useMainBackground && (
          <BackgroundSlideshow
            getVideoElement={getVideoElement}
            currentIndex={currentIndex}
            nextIndex={nextIndex}
            blurCqh={backgroundBlurCqh}
            isTransitioning={isTransitioning}
            transitionKey={transitionKey}
            onTransitionComplete={completeTransition}
            onInitialReady={handleBackgroundReady}
          />
        )}
        {isMainUi && !isConnected && !isEnteringLoading && (
          <div
            className={`absolute top-1/2 z-8 w-[42.67cqh] cursor-pointer transition-[transform,left] duration-[180ms] ease-out ${!isConnected && isSettingsOpen ? 'left-[var(--portal-settings-right)] pointer-events-none' : 'left-[49%] pointer-events-auto'}`}
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
                isShrinking={isPortalShrinking || isLaunchShrinking}
                isEntering={isPortalEntering}
                isSettingsOpen={!isConnected && isSettingsOpen}
                glowRgb={portalGlowRgb}
                portalSceneGlowRgb={portalGlowRgb}
                sparkGlowRgb={portalGlowRgb}
                onShrinkComplete={completePortalShrink}
                onInitialPreviewReady={handleInitialPreviewReady}
                onMediaReady={triggerPortalEnter}
              />
            </div>
          </div>
        )}
        <AnimatePresence mode="wait">
          {activeMenuView === MENU_VIEW.HOME && (
            <motion.div
              key={MENU_VIEW.HOME}
              className="absolute inset-0 z-[9] pointer-events-none"
              variants={viewFadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <SocialCtaRow />

              <ViewLabel>{t('app.name')}</ViewLabel>

              <MenuButton
                variant="secondary"
                label="app.buttons.settings"
                className="absolute z-[1] right-[var(--edge-right)] bottom-[var(--edge-bottom)] min-w-[132px] m-0 p-[0.9cqh_2.67cqh] box-border appearance-none text-[3.91cqh] tracking-tight pointer-events-auto"
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
            className={`content-area absolute z-[5] inset-0 w-full h-full bg-black opacity-100 ${isStreamingReveal ? 'streaming-reveal' : ''}`}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.animationName !== 'streamingCircularReveal') return
              setIsStreamingReveal(false)
            }}
          >
            <VideoContainer />
            <PerformanceStatsOverlay />
            <InputOverlay />
            <FrameTimelineOverlay />
            <div className="absolute z-[2] pointer-events-none" id="logo-container"></div>
            <PauseOverlay isActive={isPaused && sceneEditState.phase === 'inactive'} />
            <SceneEditOverlay />
            {SCENE_EDIT_DEBUG_PREVIEW &&
              editPromptVisible &&
              sceneEditState.lastEditPrompt &&
              sceneEditState.phase === 'inactive' && (
                <div
                  key={editPromptKeyRef.current}
                  className="absolute bottom-[3.2cqh] left-1/2 -translate-x-1/2 z-[180] pointer-events-none max-w-[80cqw]"
                >
                  <div
                    className="border border-white/20 bg-black/70 text-white/90 px-[2.1cqh] py-[0.9cqh] font-serif text-[2cqh] tracking-[0.01em] shadow-lg backdrop-blur-sm text-center"
                    style={{ animation: `streamingWarningToast ${SCENE_EDIT_PROMPT_TOAST_MS}ms ease forwards` }}
                  >
                    {sceneEditState.lastEditPrompt}
                  </div>
                </div>
              )}
            {SCENE_EDIT_DEBUG_PREVIEW && editPreviewVisible && sceneEditState.lastPreview && (
              <div
                className="absolute bottom-[2cqh] right-[2cqw] z-40 pointer-events-none flex flex-col gap-[0.5cqh]"
                style={{ animation: `streamingWarningToast ${SCENE_EDIT_PREVIEW_TOAST_MS}ms ease forwards` }}
              >
                <div className="flex flex-col items-end">
                  <span className="font-serif text-[1.6cqh] text-white/70 mb-[0.3cqh]">Before</span>
                  <img
                    src={`data:image/jpeg;base64,${sceneEditState.lastPreview.originalB64}`}
                    alt="Before inpainting"
                    className="h-[18cqh] border border-white/30 shadow-lg"
                  />
                </div>
                <div className="flex flex-col items-end">
                  <span className="font-serif text-[1.6cqh] text-white/70 mb-[0.3cqh]">After</span>
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
        {(isLoadingUi || isEnteringLoading || isReturningToMenu || isStreamingReveal) && (
          <div
            className={`loading-ui-layer absolute inset-0 ${isStreamingReveal ? 'z-[4]' : 'z-20'} ${isEnteringLoading ? 'launch-revealing' : ''} ${isReturningToMenu ? 'launch-concealing' : ''} ${isStreamingReveal ? 'streaming-pullout' : ''}`}
            style={loadingLayerStyle}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.animationName !== 'portalBgReveal' && event.animationName !== 'portalBgConceal') return
              if (isEnteringLoading) {
                setIsEnteringLoading(false)
                void transitionTo(portalStates.LOADING)
                return
              }
              if (isReturningToMenu) {
                triggerPortalEnter()
                setIsReturningToMenu(false)
                void transitionTo(portalStates.MAIN_MENU)
              }
            }}
          >
            <div className="loading-vortex-layer absolute inset-0 z-[7] pointer-events-none" aria-hidden="true">
              <VortexHost mode="loading" />
            </div>
            {(isLoadingUi || isEnteringLoading || isStreamingReveal) && !isReturningToMenu && (
              <>
                <TerminalDisplay onCancel={handleCancelLoading} />
              </>
            )}
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
