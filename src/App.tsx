import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ConfigProvider } from './hooks/useConfig'
import { PortalProvider, usePortal } from './context/PortalContext'
import { StreamingProvider, useStreaming } from './context/StreamingContext'
import { useFitWindowToContent } from './hooks/useTauri'
import { useAppStartup } from './hooks/useAppStartup'
import { useConfig, ENGINE_MODES } from './hooks/useConfig'
import VideoContainer from './components/VideoContainer'
import BottomPanel from './components/BottomPanel'
import SettingsPanel from './components/SettingsPanel'
import BackgroundSlideshow from './components/BackgroundSlideshow'
import PortalPreview from './components/PortalPreview'
import LoadingTunnelCanvas from './components/LoadingTunnelCanvas'
import TerminalDisplay from './components/TerminalDisplay'
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
  const [loadingTunnelImage, setLoadingTunnelImage] = useState<string | null>(null)
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
      className={`holo-frame ${isReady ? 'animate' : ''} ${isConnected ? 'keyboard-open' : ''} ${bottomPanelHidden ? 'panel-hidden' : ''}`}
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
            <div className="menu-cta-row">
              <a
                href="https://over.world/"
                target="_blank"
                rel="noopener noreferrer"
                className="menu-cta-btn"
                aria-label="Overworld website"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                </svg>
              </a>
              <a
                href="https://x.com/overworld_ai"
                target="_blank"
                rel="noopener noreferrer"
                className="menu-cta-btn"
                aria-label="Overworld on X"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href="https://discord.gg/overworld"
                target="_blank"
                rel="noopener noreferrer"
                className="menu-cta-btn"
                aria-label="Overworld Discord"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              </a>
              <a
                href="https://github.com/Overworldai"
                target="_blank"
                rel="noopener noreferrer"
                className="menu-cta-btn"
                aria-label="Overworld GitHub"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
              </a>
            </div>

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
          <main className="content-area">
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

        {/* Bottom panel - always visible when streaming connected */}
        {isStreamingUi && (
          <BottomPanel
            isOpen={true}
            isHidden={bottomPanelHidden}
            onToggleHidden={() => setBottomPanelHidden(!bottomPanelHidden)}
          />
        )}
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
