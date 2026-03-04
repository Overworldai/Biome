import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { ConfigProvider } from './hooks/useConfig'
import { PortalProvider, usePortal } from './context/PortalContext'
import { StreamingProvider, useStreaming } from './context/StreamingContext'
import { VortexProvider } from './context/VortexContext'
import { useAppStartup } from './hooks/useAppStartup'
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
import ConnectionLostOverlay from './components/ConnectionLostOverlay'
import ShutdownOverlay from './components/ShutdownOverlay'
import WindowControls from './components/WindowControls'
import ServerLogDisplay from './components/ServerLogDisplay'
import useBackgroundCycle from './hooks/useBackgroundCycle'
import useSceneGlowColor from './hooks/useSceneGlowColor'
import { PORTAL_SPARKS_DEBUG } from './constants'
import PortalSparksConfigurator from './components/PortalSparksConfigurator'

const LAUNCH_PRE_SHRINK_MS = 420

const AppShell = () => {
  const [isPortalHovered, setIsPortalHovered] = useState(false)
  const [showInstallLog, setShowInstallLog] = useState(false)
  const [isLaunchShrinking, setIsLaunchShrinking] = useState(false)
  const [isEnteringLoading, setIsEnteringLoading] = useState(false)
  const [isReturningToMenu, setIsReturningToMenu] = useState(false)
  const [isStreamingReveal, setIsStreamingReveal] = useState(false)
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
    connectionState,
    warning,
    connectionLost,
    statusStage,
    setupProgress,
    engineSetupError,
    engineSetupInProgress,
    prepareReturnToMainMenu
  } = useStreaming()
  const {
    images,
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
      showInstallLog ||
      isLaunchShrinking ||
      isEnteringLoading ||
      isReturningToMenu ||
      portalState === portalStates.LOADING ||
      portalState === portalStates.STREAMING
  )

  const nextScenePreview = images[nextIndex] ?? null
  const isLaunchTransition = isEnteringLoading
  const isStreamingUi = portalState === portalStates.STREAMING && isStreaming
  const isLoadingUi = !isLaunchTransition && portalState === portalStates.LOADING
  const isMainUi = !isLaunchTransition && !isLoadingUi && !isStreamingUi
  const useMainBackground = !isStreamingUi
  const backgroundBlurPx = isMainUi ? (isSettingsOpen ? 14 : 2) : 0
  const portalGlowRgb = useSceneGlowColor(images, currentIndex)
  const nextSceneGlowRgb = useSceneGlowColor(images, nextIndex)
  const showMenuHome = isMainUi && !isConnected && !isSettingsOpen && !showInstallLog
  const showMenuSettings = isMainUi && !isConnected && isSettingsOpen
  const showInstallLogView = isMainUi && !isConnected && showInstallLog
  const loadingProgressPercent = Math.max(0, Math.min(100, Math.round(statusStage?.percent ?? 0)))
  const loadingLayerStyle = {
    '--vortex-progress-percent': loadingProgressPercent.toString()
  } as CSSProperties

  useEffect(() => {
    if (isStreamingUi && !prevStreamingUiRef.current) {
      setIsStreamingReveal(true)
    }
    prevStreamingUiRef.current = isStreamingUi
  }, [isStreamingUi])

  useEffect(() => {
    if (!portalVisible) {
      setIsPortalHovered(false)
    }
  }, [portalVisible])

  useEffect(() => {
    if (!isLoadingUi && portalState === portalStates.MAIN_MENU) {
      setIsEnteringLoading(false)
      setIsLaunchShrinking(false)
      setIsReturningToMenu(false)
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
      !showInstallLog &&
      !isEnteringLoading &&
      !isLaunchShrinking
    ) {
      setIsLaunchShrinking(true)
    }
  }

  const handleCancelLoading = () => {
    if (isReturningToMenu || portalState !== portalStates.LOADING) return
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
            images={images}
            currentIndex={currentIndex}
            nextIndex={nextIndex}
            blurPx={backgroundBlurPx}
            isTransitioning={isTransitioning}
            transitionKey={transitionKey}
            onTransitionComplete={completeTransition}
          />
        )}
        {isMainUi && !isConnected && !isEnteringLoading && (
          <div
            className={`absolute top-1/2 z-8 w-[42.67cqh] cursor-pointer transition-[transform,left] duration-[180ms] ease-out ${!isConnected && isSettingsOpen ? 'left-[var(--portal-settings-left)] pointer-events-none' : 'left-[49%] pointer-events-auto'}`}
            style={{ transform: `translate(-50%, -50%) scale(${isPortalHovered ? 1.05 : 1})` }}
            onMouseEnter={() => setIsPortalHovered(true)}
            onMouseLeave={() => setIsPortalHovered(false)}
            onClick={handleLaunch}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleLaunch()
              }
            }}
          >
            <div className="relative w-full" style={{ paddingBottom: '123%' }}>
              <PortalPreview
                image={nextScenePreview}
                hoverContent={nextScenePreview ? <VortexHost mode="portal" /> : undefined}
                isHovered={isPortalHovered}
                visible={portalVisible}
                isShrinking={isPortalShrinking || isLaunchShrinking}
                isEntering={isPortalEntering}
                isSettingsOpen={!isConnected && isSettingsOpen}
                glowRgb={portalGlowRgb}
                portalSceneGlowRgb={nextSceneGlowRgb}
                onShrinkComplete={completePortalShrink}
              />
            </div>
          </div>
        )}
        {showMenuHome && (
          <div className="absolute inset-0 z-[9] pointer-events-none">
            <SocialCtaRow />

            <ViewLabel>Biome</ViewLabel>

            <MenuButton
              variant="ghost"
              className="absolute z-[1] right-[var(--edge-right)] bottom-[var(--edge-bottom)] min-w-[132px] m-0 p-[0.9cqh_2.67cqh] box-border appearance-none text-[3.91cqh] tracking-tight pointer-events-auto"
              onClick={toggleSettings}
            >
              Settings
            </MenuButton>
          </div>
        )}
        {showMenuSettings && (
          <MenuSettingsView
            onBack={toggleSettings}
            onFixEngine={() => {
              setShowInstallLog(true)
            }}
          />
        )}
        {showInstallLogView && (
          <div className="absolute inset-0 z-[12] pointer-events-none flex items-center justify-center bg-[rgba(2,6,16,0.62)] backdrop-blur-sm">
            <div className="w-[135.11cqh] max-w-[92vw] pointer-events-auto">
              <ServerLogDisplay
                variant="loading-inline"
                title="WORLD ENGINE INSTALL"
                showProgress={engineSetupInProgress}
                progressMessage={
                  engineSetupInProgress
                    ? setupProgress || 'Installing World Engine...'
                    : engineSetupError
                      ? 'World Engine installation failed.'
                      : 'World Engine installation complete.'
                }
                errorMessage={engineSetupError}
                showDismiss={false}
                headerAction={
                  !engineSetupInProgress ? (
                    <button
                      type="button"
                      className="loading-inline-logs-close"
                      onClick={() => setShowInstallLog(false)}
                      aria-label="Close install logs"
                    >
                      Close
                    </button>
                  ) : null
                }
              />
            </div>
          </div>
        )}

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
            <div className="absolute z-[2] pointer-events-none" id="logo-container"></div>
            <PauseOverlay isActive={isPaused} />
            {warning && !connectionLost && (
              <div
                key={warning}
                className="absolute top-[3.2cqh] left-1/2 -translate-x-1/2 z-[180] pointer-events-none"
              >
                <div className="animate-[streamingWarningToast_3500ms_ease_forwards] border border-[rgba(255,210,132,0.82)] bg-[rgba(36,22,0,0.82)] text-[rgba(255,233,188,0.98)] px-[2.1cqh] py-[0.9cqh] font-serif text-[2.2cqh] tracking-[0.01em] shadow-[0_0_14px_rgba(255,180,64,0.22)]">
                  {warning}
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
        <ShutdownOverlay />
      </div>
      {PORTAL_SPARKS_DEBUG && <PortalSparksConfigurator />}
    </div>
  )
}

const App = () => {
  // Run startup tasks (unpack server files, etc.)
  useAppStartup()

  return (
    <ConfigProvider>
      <PortalProvider>
        <StreamingProvider>
          <VortexProvider>
            <AppShell />
          </VortexProvider>
        </StreamingProvider>
      </PortalProvider>
    </ConfigProvider>
  )
}

export default App
