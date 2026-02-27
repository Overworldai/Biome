import { useState, useEffect, useRef } from 'react'
import { invoke } from './bridge'
import { ConfigProvider } from './hooks/useConfig'
import { PortalProvider, usePortal } from './context/PortalContext'
import { StreamingProvider, useStreaming } from './context/StreamingContext'
import { useFitWindowToContent } from './hooks/useWindow'
import { useAppStartup } from './hooks/useAppStartup'
import { useConfig, ENGINE_MODES } from './hooks/useConfig'
import VideoContainer from './components/VideoContainer'
import SettingsPanel from './components/SettingsPanel'
import BackgroundSlideshow from './components/BackgroundSlideshow'
import PortalPreview from './components/PortalPreview'
import LoadingTunnelCanvas from './components/LoadingTunnelCanvas'
import TerminalDisplay from './components/TerminalDisplay'
import SocialCtaRow from './components/SocialCtaRow'
import PauseOverlay from './components/PauseOverlay'
import ConnectionLostOverlay from './components/ConnectionLostOverlay'
import ShutdownOverlay from './components/ShutdownOverlay'
import WindowControls from './components/WindowControls'
import ServerLogDisplay from './components/ServerLogDisplay'
import useBackgroundCycle from './hooks/useBackgroundCycle'
import useSceneGlowColor from './hooks/useSceneGlowColor'

const LAUNCH_PRE_SHRINK_MS = 420
const LOADING_TUNNEL_FALLBACK_MIME = 'image/png'

type MenuModelOption = {
  id: string
  isLocal: boolean
}

const HoloFrame = () => {
  const [isPortalHovered, setIsPortalHovered] = useState(false)
  const [menuEngineMode, setMenuEngineMode] = useState<'server' | 'standalone'>('standalone')
  const [menuWorldModel, setMenuWorldModel] = useState('Overworld/Waypoint-1-Small')
  const [menuMouseSensitivity, setMenuMouseSensitivity] = useState(60)
  const [menuModelOptions, setMenuModelOptions] = useState<MenuModelOption[]>([
    { id: 'Overworld/Waypoint-1-Small', isLocal: false }
  ])
  const [menuModelsLoading, setMenuModelsLoading] = useState(false)
  const [menuModelsError, setMenuModelsError] = useState<string | null>(null)
  const [engineDirPath, setEngineDirPath] = useState<string | null>(null)
  const [showFixModal, setShowFixModal] = useState(false)
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
    bottomPanelHidden,
    setBottomPanelHidden,
    engineStatus,
    setupEngine,
    setupProgress,
    engineSetupError,
    engineSetupInProgress,
    checkEngineStatus,
    prepareReturnToMainMenu
  } = useStreaming()
  const { engineMode, config } = useConfig()
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
  const serverUrl = `${config.gpu_server.use_ssl ? 'https' : 'http'}://${config.gpu_server.host}:${config.gpu_server.port}`
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
    if (engineMode === ENGINE_MODES.SERVER) {
      setMenuEngineMode('server')
    } else if (engineMode === ENGINE_MODES.STANDALONE) {
      setMenuEngineMode('standalone')
    }
  }, [engineMode])

  useEffect(() => {
    invoke('get-engine-dir-path')
      .then(setEngineDirPath)
      .catch(() => setEngineDirPath(null))
  }, [])

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

  useEffect(() => {
    if (!isConnected && isSettingsOpen && menuEngineMode === 'standalone') {
      checkEngineStatus().catch(() => null)
    }
  }, [isConnected, isSettingsOpen, menuEngineMode, checkEngineStatus])

  useEffect(() => {
    if (isConnected || !isSettingsOpen) return

    let cancelled = false

    const loadMenuModels = async () => {
      setMenuModelsLoading(true)
      setMenuModelsError(null)
      try {
        const remoteModels = await invoke('list-waypoint-models')
        if (cancelled) return

        const ids = [...new Set([menuWorldModel, ...(Array.isArray(remoteModels) ? remoteModels : [])])]
          .map((id) => id.trim())
          .filter((id) => id.length > 0)

        const availability = await invoke('list-model-availability', ids)
        if (cancelled) return

        const availabilityMap = new Map((availability || []).map((entry) => [entry.id, !!entry.is_local]))
        setMenuModelOptions(ids.map((id) => ({ id, isLocal: availabilityMap.get(id) ?? false })))
      } catch (err) {
        if (cancelled) return
        setMenuModelsError('Could not load model list')
      } finally {
        if (!cancelled) {
          setMenuModelsLoading(false)
        }
      }
    }

    loadMenuModels()

    return () => {
      cancelled = true
    }
  }, [isConnected, isSettingsOpen, menuWorldModel])

  const standaloneStatusText = (() => {
    if (!engineStatus) return 'Status unavailable'
    const isReady = engineStatus.uv_installed && engineStatus.repo_cloned && engineStatus.dependencies_synced
    if (isReady) return 'World Engine: Ready'
    if (engineStatus.uv_installed || engineStatus.repo_cloned || engineStatus.dependencies_synced) {
      return 'World Engine: Needs repair'
    }
    return 'World Engine: Not installed'
  })()

  const handleConfirmFixEngine = async () => {
    setShowFixModal(false)
    if (isSettingsOpen) {
      toggleSettings()
    }
    setShowInstallLog(true)
    try {
      await setupEngine()
      await checkEngineStatus()
    } catch {
      // Error is surfaced by engineSetupError and server logs.
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
      className={`holo-frame relative flex h-full w-full items-center justify-center ${isConnected && !isStreamingUi ? 'overflow-y-visible' : ''} ${isStreamingUi ? '' : ''}`}
    >
      <WindowControls />
      <div
        className={`holo-frame-inner relative z-0 overflow-visible transition-transform duration-300 ease-in-out ${isStreamingUi ? 'w-[100cqw] h-[100cqh] !aspect-auto bg-black' : ''} ${isConnected && !isStreamingUi && !bottomPanelHidden ? 'scale-[0.8] -translate-y-[12%] origin-center' : ''}`}
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

            <div className="absolute z-[1] left-[4.3%] bottom-[4.1%] font-serif text-[clamp(30px,4.2cqw,52px)] text-[rgba(248,248,245,0.92)] leading-none tracking-wider pointer-events-none [text-shadow:0_0_18px_rgba(0,0,0,0.38),0_0_4px_rgba(255,255,255,0.16)]">
              Biome
            </div>

            <button
              type="button"
              className="absolute z-[1] right-[var(--menu-right-edge)] bottom-[4.1%] min-w-[132px] m-0 p-[0.9cqh_1.5cqw] box-border appearance-none cursor-pointer font-serif text-[clamp(19px,2.2cqw,30px)] text-[rgba(245,249,255,0.95)] leading-none tracking-tight bg-[rgba(8,12,20,0.28)] border border-[rgba(245,251,255,0.8)] pointer-events-auto transition-all duration-[160ms] hover:bg-[rgba(245,251,255,0.9)] hover:text-[rgba(15,20,32,0.95)] hover:-translate-y-px"
              onClick={toggleSettings}
            >
              Settings
            </button>
          </div>
        )}
        {showMenuSettings && (
          <div className="menu-settings-view absolute inset-0 z-[9] pointer-events-auto">
            <div className="menu-settings-panel absolute flex flex-col z-[1] top-[8%] left-[39%] right-[4%] w-auto max-w-[760px] max-h-[78%] gap-[2.3cqh] pr-[0.4cqw] overflow-y-auto overflow-x-hidden [scrollbar-width:none]">
              <div className="">
                <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[clamp(34px,4.2cqw,52px)] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
                  Engine Mode
                </h2>
                <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
                  how will you run the model? as part of Biome, or elsewhere?
                </p>
                <div className="flex border border-[rgba(245,251,255,0.75)]">
                  <button
                    type="button"
                    className={`flex-1 cursor-pointer font-serif p-[0.55cqh_0.8cqw] text-[clamp(18px,1.7cqw,28px)] border-r border-r-[rgba(245,251,255,0.5)] ${menuEngineMode === 'server' ? 'bg-[rgba(245,251,255,0.9)] text-[rgba(15,20,32,0.95)]' : 'bg-[rgba(8,12,20,0.28)] text-[rgba(245,249,255,0.92)]'}`}
                    onClick={() => setMenuEngineMode('server')}
                  >
                    Server
                  </button>
                  <button
                    type="button"
                    className={`flex-1 cursor-pointer font-serif p-[0.55cqh_0.8cqw] text-[clamp(18px,1.7cqw,28px)] border-r-0 ${menuEngineMode === 'standalone' ? 'bg-[rgba(245,251,255,0.9)] text-[rgba(15,20,32,0.95)]' : 'bg-[rgba(8,12,20,0.28)] text-[rgba(245,249,255,0.92)]'}`}
                    onClick={() => setMenuEngineMode('standalone')}
                  >
                    Standalone
                  </button>
                </div>
              </div>

              {menuEngineMode === 'server' && (
                <div className="">
                  <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[clamp(34px,4.2cqw,52px)] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
                    Server Options
                  </h2>
                  <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
                    Install Dir: {engineDirPath || 'Loading...'}
                  </p>
                  <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
                    Server URL: {serverUrl}
                  </p>
                </div>
              )}

              {menuEngineMode === 'standalone' && (
                <div className="">
                  <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[clamp(34px,4.2cqw,52px)] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
                    Standalone Options
                  </h2>
                  <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
                    {standaloneStatusText}
                  </p>
                  <button
                    type="button"
                    className="block ml-auto w-fit cursor-pointer border-none bg-transparent font-serif text-right text-[rgba(246,249,255,0.95)] mt-[0.6cqh] p-0 text-[clamp(20px,1.8cqw,28px)] hover:bg-[rgba(245,251,255,0.95)] hover:text-[rgba(10,14,24,0.96)]"
                    onClick={() => setShowFixModal(true)}
                  >
                    Fix World Engine
                  </button>
                </div>
              )}

              <div className="">
                <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[clamp(34px,4.2cqw,52px)] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
                  World Model
                </h2>
                <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
                  which Overworld model will simulate your world?
                </p>
                <div className="menu-select-wrap border border-[rgba(245,251,255,0.75)] bg-[rgba(8,12,20,0.28)]">
                  <select
                    className="w-full cursor-pointer border-none bg-transparent font-serif text-[rgba(245,249,255,0.92)] outline-none appearance-none p-[0.55cqh_0.8cqw] text-[clamp(18px,1.5cqw,24px)]"
                    value={menuWorldModel}
                    onChange={(event) => setMenuWorldModel(event.target.value)}
                    disabled={menuModelsLoading}
                  >
                    {menuModelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.id} {model.isLocal ? '- Local' : '- Download'}
                      </option>
                    ))}
                  </select>
                </div>
                {menuModelsError && (
                  <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
                    {menuModelsError}
                  </p>
                )}
              </div>

              <div className="">
                <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[clamp(34px,4.2cqw,52px)] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
                  Mouse Sensitivity
                </h2>
                <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
                  how much should the camera move when you move your mouse?
                </p>
                <div className="flex flex-col items-end gap-[0.4cqh]">
                  <input
                    className="menu-range-slider w-full m-0 cursor-pointer outline-none appearance-none h-[0.8cqh] rounded-full bg-[rgba(245,251,255,0.42)]"
                    type="range"
                    min={10}
                    max={100}
                    value={menuMouseSensitivity}
                    onChange={(event) => setMenuMouseSensitivity(Number(event.target.value))}
                  />
                  <span className="font-serif text-[rgba(240,245,252,0.85)] text-[clamp(16px,1.35cqw,22px)]">
                    {menuMouseSensitivity}%
                  </span>
                </div>
              </div>
            </div>

            <div className="absolute z-[1] left-[4.3%] bottom-[4.1%] font-serif text-[clamp(30px,4.2cqw,52px)] text-[rgba(248,248,245,0.92)] leading-none tracking-wider pointer-events-none [text-shadow:0_0_18px_rgba(0,0,0,0.38),0_0_4px_rgba(255,255,255,0.16)]">
              Settings
            </div>

            <button
              type="button"
              className="absolute z-[1] right-[var(--menu-right-edge)] bottom-[4.1%] min-w-[132px] m-0 p-[0.9cqh_1.5cqw] box-border appearance-none cursor-pointer font-serif text-[clamp(19px,2.2cqw,30px)] text-[rgba(245,249,255,0.95)] leading-none tracking-tight bg-[rgba(8,12,20,0.28)] border border-[rgba(245,251,255,0.8)] pointer-events-auto transition-all duration-[160ms] hover:bg-[rgba(245,251,255,0.9)] hover:text-[rgba(15,20,32,0.95)] hover:-translate-y-px"
              onClick={toggleSettings}
            >
              Back
            </button>

            {showFixModal && (
              <div
                className="absolute inset-0 z-[3] flex items-center justify-center bg-[rgba(2,6,16,0.55)] backdrop-blur-sm"
                role="dialog"
                aria-modal="true"
              >
                <div className="border border-[rgba(245,251,255,0.66)] bg-[rgba(8,12,20,0.92)] text-[rgba(246,249,255,0.95)] w-[min(420px,76cqw)] p-[1.8cqh_1.6cqw]">
                  <h3 className="m-0 mb-[0.6cqh] font-serif font-medium text-[clamp(26px,2.2cqw,34px)]">
                    Fix World Engine?
                  </h3>
                  <p className="m-0 font-serif text-[rgba(233,242,255,0.82)] text-[clamp(16px,1.35cqw,21px)]">
                    This will run repair/setup and open the installation log screen.
                  </p>
                  <div className="flex justify-end mt-[1.4cqh] gap-[0.8cqw]">
                    <button
                      type="button"
                      className="cursor-pointer font-serif border border-[rgba(245,251,255,0.7)] bg-[rgba(8,12,20,0.18)] text-[rgba(245,251,255,0.95)] p-[0.5cqh_1cqw] text-[clamp(17px,1.4cqw,22px)]"
                      onClick={() => setShowFixModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="cursor-pointer font-serif bg-[rgba(245,251,255,0.9)] text-[rgba(15,20,32,0.95)] p-[0.5cqh_1cqw] text-[clamp(17px,1.4cqw,22px)]"
                      onClick={handleConfirmFixEngine}
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
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
            <SettingsPanel />
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
