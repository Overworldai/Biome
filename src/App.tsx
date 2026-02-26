import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ConfigProvider } from './hooks/useConfig'
import { PortalProvider, usePortal } from './context/PortalContext'
import { StreamingProvider, useStreaming } from './context/StreamingContext'
import { useFitWindowToContent } from './hooks/useTauri'
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
import useBackgroundCycle from './hooks/useBackgroundCycle'
import useSceneGlowColor from './hooks/useSceneGlowColor'

const LAUNCH_PRE_SHRINK_MS = 420
const LOADING_TUNNEL_FALLBACK_MIME = 'image/png'

type MenuModelOption = {
  id: string
  isLocal: boolean
}

const HoloFrame = () => {
  const [isReady, setIsReady] = useState(false)
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
  const backgroundBlurPx = isMainUi ? (isSettingsOpen ? 8 : 2) : 0
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
    invoke<string>('get_engine_dir_path')
      .then(setEngineDirPath)
      .catch(() => setEngineDirPath(null))
  }, [])

  useEffect(() => {
    let cancelled = false

    invoke<string>('read_loading_tunnel_as_base64')
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
        const remoteModels = await invoke<string[]>('list_waypoint_models')
        if (cancelled) return

        const ids = [...new Set([menuWorldModel, ...(Array.isArray(remoteModels) ? remoteModels : [])])]
          .map((id) => id.trim())
          .filter((id) => id.length > 0)

        const availability = await invoke<Array<{ id: string; is_local: boolean }>>('list_model_availability', {
          modelIds: ids
        })
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

  // Force animation replay on mount by briefly removing the animated class
  useEffect(() => {
    // Small delay to ensure DOM is ready, then trigger animations
    const timer = requestAnimationFrame(() => {
      setIsReady(true)
    })
    return () => cancelAnimationFrame(timer)
  }, [])

  return (
    <div
      className={`holo-frame ${isReady ? 'animate' : ''} ${isConnected && !isStreamingUi ? 'keyboard-open' : ''} ${bottomPanelHidden ? 'panel-hidden' : ''} ${isStreamingUi ? 'streaming-fullscreen' : ''}`}
    >
      <div className={`holo-frame-inner ${!isConnected && isSettingsOpen ? 'menu-settings-open' : ''}`}>
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
          <div className="menu-chrome">
            <SocialCtaRow />

            <div className="menu-title">Biome</div>

            <button type="button" className="menu-settings-btn" onClick={toggleSettings}>
              Settings
            </button>
          </div>
        )}
        {showMenuSettings && (
          <div className="menu-chrome menu-settings-view">
            <div className="menu-settings-panel">
              <div className="menu-settings-group">
                <h2>Engine Mode</h2>
                <p>how will you run the model? as part of Biome, or elsewhere?</p>
                <div className="menu-segmented">
                  <button
                    type="button"
                    className={menuEngineMode === 'server' ? 'active' : ''}
                    onClick={() => setMenuEngineMode('server')}
                  >
                    Server
                  </button>
                  <button
                    type="button"
                    className={menuEngineMode === 'standalone' ? 'active' : ''}
                    onClick={() => setMenuEngineMode('standalone')}
                  >
                    Standalone
                  </button>
                </div>
              </div>

              {menuEngineMode === 'server' && (
                <div className="menu-settings-group">
                  <h2>Server Options</h2>
                  <p>Install Dir: {engineDirPath || 'Loading...'}</p>
                  <p>Server URL: {serverUrl}</p>
                </div>
              )}

              {menuEngineMode === 'standalone' && (
                <div className="menu-settings-group">
                  <h2>Standalone Options</h2>
                  <p>{standaloneStatusText}</p>
                  <button type="button" className="menu-fix-btn" onClick={() => setShowFixModal(true)}>
                    Fix World Engine
                  </button>
                </div>
              )}

              <div className="menu-settings-group">
                <h2>World Model</h2>
                <p>which Overworld model will simulate your world?</p>
                <div className="menu-select-wrap">
                  <select
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
                {menuModelsError && <p>{menuModelsError}</p>}
              </div>

              <div className="menu-settings-group">
                <h2>Mouse Sensitivity</h2>
                <p>how much should the camera move when you move your mouse?</p>
                <div className="menu-range-wrap">
                  <input
                    className="menu-range-slider"
                    type="range"
                    min={10}
                    max={100}
                    value={menuMouseSensitivity}
                    onChange={(event) => setMenuMouseSensitivity(Number(event.target.value))}
                  />
                  <span>{menuMouseSensitivity}%</span>
                </div>
              </div>
            </div>

            <div className="menu-title">Settings</div>

            <button type="button" className="menu-settings-btn" onClick={toggleSettings}>
              Back
            </button>

            {showFixModal && (
              <div className="menu-fix-modal-overlay" role="dialog" aria-modal="true">
                <div className="menu-fix-modal">
                  <h3>Fix World Engine?</h3>
                  <p>This will run repair/setup and open the installation log screen.</p>
                  <div className="menu-fix-modal-actions">
                    <button type="button" onClick={() => setShowFixModal(false)}>
                      Cancel
                    </button>
                    <button type="button" className="confirm" onClick={handleConfirmFixEngine}>
                      Confirm
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {showInstallLogView && (
          <div className="menu-chrome menu-install-log-view">
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
            className={`content-area ${isStreamingReveal ? 'streaming-reveal' : ''}`}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.animationName !== 'streamingCircularReveal') return
              setIsStreamingReveal(false)
            }}
          >
            <VideoContainer />
            <div className="logo-container" id="logo-container"></div>
            <SettingsPanel />
            <PauseOverlay isActive={isPaused} />
            <ConnectionLostOverlay />
          </main>
        )}
        {(isLoadingUi || isEnteringLoading || isReturningToMenu) && (
          <div
            className={`loading-ui-layer ${isEnteringLoading ? 'launch-revealing' : ''} ${isReturningToMenu ? 'launch-concealing' : ''}`}
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
