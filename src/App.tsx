import { useState, useEffect, useRef } from 'react'
import { invoke } from './bridge'
import { ConfigProvider } from './hooks/useConfig'
import { PortalProvider, usePortal } from './context/PortalContext'
import { StreamingProvider, useStreaming } from './context/StreamingContext'
import { useFitWindowToContent } from './hooks/useWindow'
import { useAppStartup } from './hooks/useAppStartup'
import VideoContainer from './components/VideoContainer'
import MenuSettingsView from './components/MenuSettingsView'
import BackgroundSlideshow from './components/BackgroundSlideshow'
import PortalPreview from './components/PortalPreview'
import LoadingTunnelCanvas from './components/LoadingTunnelCanvas'
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

const LAUNCH_PRE_SHRINK_MS = 420
const LOADING_TUNNEL_FALLBACK_MIME = 'image/png'

const HoloFrame = () => {
  const [isPortalHovered, setIsPortalHovered] = useState(false)
  const [showInstallLog, setShowInstallLog] = useState(false)
  const [isLaunchShrinking, setIsLaunchShrinking] = useState(false)
  const [isEnteringLoading, setIsEnteringLoading] = useState(false)
  const [isReturningToMenu, setIsReturningToMenu] = useState(false)
  const [isReplayingPortalEnter, setIsReplayingPortalEnter] = useState(false)
  const [isStreamingReveal, setIsStreamingReveal] = useState(false)
  const [loadingTunnelImage, setLoadingTunnelImage] = useState<string | null>(null)
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
  const showMenuHome = isMainUi && !isConnected && !isSettingsOpen && !showInstallLog
  const showMenuSettings = isMainUi && !isConnected && isSettingsOpen && !showInstallLog
  const showInstallLogView = isMainUi && !isConnected && showInstallLog

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
    if (!isReplayingPortalEnter) return
    const timer = window.setTimeout(() => setIsReplayingPortalEnter(false), 760)
    return () => window.clearTimeout(timer)
  }, [isReplayingPortalEnter])

  useEffect(() => {
    if (!isLaunchShrinking) return

    const timer = window.setTimeout(() => {
      setIsLaunchShrinking(false)
      setIsEnteringLoading(true)
    }, LAUNCH_PRE_SHRINK_MS)

    return () => window.clearTimeout(timer)
  }, [isLaunchShrinking])

  useEffect(() => {
    let cancelled = false

    invoke('read-loading-tunnel-as-base64')
      .then((base64) => {
        if (cancelled || !base64) return
        setLoadingTunnelImage(`data:${LOADING_TUNNEL_FALLBACK_MIME};base64,${base64}`)
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingTunnelImage(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleCancelLoading = () => {
    if (isReturningToMenu || portalState !== portalStates.LOADING) return
    setIsReturningToMenu(true)
    setIsPortalHovered(false)
    void prepareReturnToMainMenu()
  }

  return (
    <div
      className={`holo-frame relative flex h-full w-full items-center justify-center ${isConnected && !isStreamingUi ? 'overflow-y-visible' : ''} ${isStreamingUi ? '' : ''}`}
    >
      <WindowControls />
      <div
        className={`holo-frame-inner relative z-0 overflow-visible transition-transform duration-300 ease-in-out ${isStreamingUi ? 'w-[100cqw] h-[100cqh] !aspect-auto bg-black' : ''}`}
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
        <PortalPreview
          image={nextScenePreview}
          hoverImage={loadingTunnelImage}
          isHovered={isPortalHovered}
          visible={isMainUi && !isConnected && portalVisible && !isEnteringLoading}
          isShrinking={isPortalShrinking || isLaunchShrinking}
          isEntering={isPortalEntering || isReplayingPortalEnter}
          isSettingsOpen={!isConnected && isSettingsOpen}
          glowRgb={portalGlowRgb}
          onHoverChange={setIsPortalHovered}
          onClick={() => {
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
          }}
          onShrinkComplete={completePortalShrink}
        />
        {showMenuHome && (
          <div className="absolute inset-0 z-[9] pointer-events-none">
            <SocialCtaRow />

            <ViewLabel>Biome</ViewLabel>

            <MenuButton
              variant="ghost"
              className="absolute z-[1] right-[var(--menu-right-edge)] bottom-[4.1%] min-w-[132px] m-0 p-[0.9cqh_1.5cqw] box-border appearance-none text-[clamp(19px,2.2cqw,30px)] tracking-tight pointer-events-auto"
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
              if (isSettingsOpen) toggleSettings()
              setShowInstallLog(true)
            }}
          />
        )}
        {showInstallLogView && (
          <div className="absolute inset-0 z-[9] pointer-events-auto">
            <ServerLogDisplay
              showProgress={true}
              progressMessage={setupProgress || 'Installing World Engine...'}
              errorMessage={engineSetupError}
              showDismiss={!engineSetupInProgress}
              onDismiss={() => setShowInstallLog(false)}
            />
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
            <ConnectionLostOverlay />
          </main>
        )}
        {(isLoadingUi || isEnteringLoading || isReturningToMenu) && (
          <div
            className={`loading-ui-layer absolute inset-0 z-20 ${isEnteringLoading ? 'launch-revealing' : ''} ${isReturningToMenu ? 'launch-concealing' : ''}`}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.animationName !== 'portalBgReveal' && event.animationName !== 'portalBgConceal') return
              if (isEnteringLoading) {
                setIsEnteringLoading(false)
                void transitionTo(portalStates.LOADING)
                return
              }
              if (isReturningToMenu) {
                setIsReturningToMenu(false)
                setIsReplayingPortalEnter(true)
                void transitionTo(portalStates.MAIN_MENU)
              }
            }}
          >
            <LoadingTunnelCanvas
              intensity={1}
              qualityMode="auto"
              mouseReactive={true}
              baseImageSrc={loadingTunnelImage}
            />
            {isLoadingUi && !isReturningToMenu && (
              <>
                <TerminalDisplay onCancel={handleCancelLoading} />
              </>
            )}
          </div>
        )}
        <ShutdownOverlay />
      </div>
    </div>
  )
}

const App = () => {
  // Run startup tasks (unpack server files, etc.)
  useAppStartup()

  // Snap window to fit content after resize stops
  useFitWindowToContent()

  return (
    <ConfigProvider>
      <PortalProvider>
        <StreamingProvider>
          <HoloFrame />
        </StreamingProvider>
      </PortalProvider>
    </ConfigProvider>
  )
}

export default App
