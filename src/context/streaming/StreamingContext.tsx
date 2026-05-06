import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react'
import { usePortal } from '../portal/portalContextValue'
import { TranslatableError } from '../../i18n'
import useWebSocket, {
  isConnected as wsIsConnected,
  isReady as wsIsReady,
  connectionError as wsConnectionError
} from '../../hooks/engine/useWebSocket'
import { useSettings } from '../../hooks/settings/settingsContextValue'
import useEngineApi from '../../hooks/engine/useEngineApi'
import useSeedsDir from '../../hooks/seeds/useSeedsDir'
import { createLogger } from '../../utils/logger'
import { useConnectionActions } from '../../hooks/streaming/useConnectionActions'
import { useEngineRespawn } from '../../hooks/streaming/useEngineRespawn'
import { useFrameRenderer } from '../../hooks/streaming/useFrameRenderer'
import { useLoadingFailureCleanup } from '../../hooks/streaming/useLoadingFailureCleanup'
import { useInputLoop } from '../../hooks/streaming/useInputLoop'
import { usePauseState } from '../../hooks/streaming/usePauseState'
import { usePointerLock } from '../../hooks/streaming/usePointerLock'
import { useSceneEdit } from '../../hooks/streaming/useSceneEdit'
import { useSessionInit } from '../../hooks/streaming/useSessionInit'
import { useStreamingLifecycle } from '../../hooks/streaming/useStreamingLifecycle'
import { useWarmConnection } from '../../hooks/streaming/useWarmConnection'
import type { ConnectionContextValue } from './connection'
import type { EngineContextValue } from './engine'
import type { SessionContextValue } from './session'
import type { FramesContextValue } from './frames'
import type { InputContextValue } from './input'
import type { SeedsContextValue } from './seeds'
import type { WebsocketContextValue } from './websocket'
import type { SurfaceContextValue } from './surface'
import { StreamingProviders } from './StreamingProviders'

const log = createLogger('Streaming')

export const StreamingProvider = ({ children }: { children: ReactNode }) => {
  const { state, states, transitionTo } = usePortal()
  const containerRef = useRef<HTMLDivElement | null>(null)

  const { settings, isStandaloneMode, engineMode } = useSettings()
  const {
    status: engineStatus,
    startServer,
    stopServer,
    isServerRunning,
    serverPort,
    isReady: engineReady,
    checkStatus: checkEngineStatus,
    checkServerReady,
    checkServerRunning,
    checkPortInUse,
    probeServerHealth,
    getLastServerExitTail,
    serverLogPath,
    setupEngine,
    nukeAndReinstallEngine,
    abortEngineInstall,
    setupProgress,
    isLoading: engineSetupInProgress,
    error: engineSetupError
  } = useEngineApi()
  const {
    status: connectionStatus,
    statusStage,
    frame,
    frameId,
    latentGenMs,
    temporalCompression,
    frameGenMsRef,
    frameTemporalCompressionRef,
    frameIdRef,
    server,
    inputLatency,
    logs: wsLogs,
    allLogs: wsAllLogs,
    connect,
    disconnect,
    sendControl,
    sendPause,
    sendInit,
    applyInitResponse,
    setPlaceholderFrame,
    resetScene,
    request: wsRequest,
    clearLogs: clearWsLogs
  } = useWebSocket()
  const isReady = wsIsReady(connectionStatus)
  const { getSeedsDirPath, openSeedsDir, seedsDir } = useSeedsDir()

  const { state: pauseState, pause: pauseSession, resume: resumeSession } = usePauseState()
  const isPaused = pauseState.kind === 'paused'
  const [settingsOpen, setSettingsOpen] = useState(false)
  const sceneEdit = useSceneEdit()
  const [connectionLost, setConnectionLost] = useState(false)
  const [engineError, setEngineError] = useState<TranslatableError | null>(null)

  const {
    preConnectionStage,
    isFreshInstall,
    run: runWarmConnection,
    cancel: cancelWarmFlow,
    isCancelled: isWarmFlowCancelled
  } = useWarmConnection({
    statusStage,
    isStandaloneMode,
    offlineMode: settings.offline_mode ?? false,
    serverUrl: settings.server_url,
    engine: {
      serverPort,
      isServerRunning,
      startServer,
      checkServerReady,
      checkServerRunning,
      checkPortInUse,
      probeServerHealth,
      getLastServerExitTail,
      checkStatus: checkEngineStatus,
      setupEngine
    },
    connect,
    clearWsLogs,
    onServerError: setEngineError
  })

  const effectiveStatusStage = useMemo(() => statusStage ?? preConnectionStage, [statusStage, preConnectionStage])

  const hasReceivedFrame = frame !== null
  const isStreaming = state === states.STREAMING
  const inputEnabled = isStreaming && isReady && !isPaused && !settingsOpen && !connectionLost && !sceneEdit.isActive

  // Check engine status on mount (for standalone mode)
  useEffect(() => {
    if (isStandaloneMode) {
      checkEngineStatus()
    }
  }, [isStandaloneMode, checkEngineStatus])

  useEngineRespawn({
    engineMode,
    offlineMode: settings.offline_mode ?? false,
    portalState: state,
    mainMenuState: states.MAIN_MENU,
    loadingState: states.LOADING,
    isServerRunning,
    disconnect,
    stopServer,
    setEngineError,
    transitionTo
  })

  // Resolve local seeds dir path on mount (does not require server availability)
  useEffect(() => {
    getSeedsDirPath().catch((err) => {
      log.error('Failed to resolve seeds directory path:', err)
    })
  }, [getSeedsDirPath])

  const { selectSeed, lastAppliedModel, resetSession } = useSessionInit({
    portalState: state,
    loadingState: states.LOADING,
    isConnected: wsIsConnected(connectionStatus),
    isStreaming,
    isStandaloneMode,
    settings,
    sendInit,
    applyInitResponse,
    setPlaceholderFrame
  })

  const {
    blockedSeq: pointerLockBlockedSeq,
    request: requestPointerLock,
    exit: exitPointerLock
  } = usePointerLock({ containerRef, pauseState, connectionLost })

  const handleReset = useCallback(() => {
    resetScene()
    requestPointerLock()
  }, [resetScene, requestPointerLock])

  const handleSceneEdit = useCallback(() => {
    exitPointerLock()
    sceneEdit.dispatch({ type: 'OPEN' })
  }, [exitPointerLock, sceneEdit])

  const { pressedKeys, mouseButtons, pressedGamepad, scrollActive, isPointerLocked } = useInputLoop({
    enabled: inputEnabled,
    containerRef,
    keybindings: settings.keybindings,
    mouseSensitivity: settings.mouse_sensitivity,
    gamepadSensitivity: settings.gamepad_sensitivity,
    sendControl,
    onReset: handleReset,
    onSceneEdit: settings.scene_authoring_enabled ? handleSceneEdit : null,
    onExitPointerLock: exitPointerLock
  })

  useLoadingFailureCleanup({
    portalState: state,
    loadingState: states.LOADING,
    connectionStatus,
    engineError,
    isStandaloneMode,
    isServerRunning,
    stopServer
  })

  const resume = useCallback(() => {
    setSettingsOpen(false)
    resumeSession()
    sendPause(false)
  }, [sendPause, resumeSession])

  useStreamingLifecycle({
    portalState: state,
    connectionStatus,
    engineModel: settings?.engine_model,
    engineQuant: settings.engine_quant,
    sceneAuthoringEnabled: settings.scene_authoring_enabled,
    lastAppliedModel,
    engineError,
    hasReceivedFrame,
    // Init is considered complete once applyInitResponse has set the
    // server model. Gates LOADING → STREAMING so an error between
    // session.ready and the init response doesn't leak us into streaming.
    initCompleted: server.model !== null,
    isPointerLocked,
    settingsOpen,
    isPaused,
    sceneEditActive: sceneEdit.graceActive,
    states,
    settings,
    setEngineError,
    resetSession,
    runWarmConnection,
    isWarmFlowCancelled,
    setConnectionLost,
    setSettingsOpen,
    pauseSession,
    resumeSession,
    disconnect,
    transitionTo,
    exitPointerLock,
    sendPause,
    resume
  })

  const { registerCanvas, canvasReady, frameTimelineRef } = useFrameRenderer({
    frame,
    refs: { gen: frameGenMsRef, compression: frameTemporalCompressionRef, id: frameIdRef }
  })

  const registerContainerRef = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element
  }, [])

  const handleContainerClick = useCallback(() => {
    if (isStreaming && isReady && !connectionLost) requestPointerLock()
  }, [isStreaming, isReady, connectionLost, requestPointerLock])

  const { dismissConnectionLost, reconnectAfterConnectionLost, cancelConnection, prepareReturnToMainMenu } =
    useConnectionActions({
      isStandaloneMode,
      isServerRunning,
      cancelWarmFlow,
      disconnect,
      exitPointerLock,
      stopServer,
      transitionTo,
      loadingState: states.LOADING,
      mainMenuState: states.MAIN_MENU,
      resetSession,
      resumeSession,
      setEngineError,
      setSettingsOpen,
      setConnectionLost
    })

  const error = engineError ?? wsConnectionError(connectionStatus)

  const connectionValue = useMemo<ConnectionContextValue>(
    () => ({
      status: connectionStatus,
      error,
      connectionLost,
      statusStage: effectiveStatusStage,
      isStreaming,
      isVideoReady: hasReceivedFrame && canvasReady,
      isUIActive: !inputEnabled,
      isFreshInstall,
      server,
      dismissConnectionLost,
      reconnectAfterConnectionLost,
      cancelConnection,
      prepareReturnToMainMenu
    }),
    [
      connectionStatus,
      error,
      connectionLost,
      effectiveStatusStage,
      isStreaming,
      hasReceivedFrame,
      canvasReady,
      inputEnabled,
      isFreshInstall,
      server,
      dismissConnectionLost,
      reconnectAfterConnectionLost,
      cancelConnection,
      prepareReturnToMainMenu
    ]
  )

  const sessionValue = useMemo<SessionContextValue>(
    () => ({
      pause: pauseState,
      settingsOpen,
      sceneEdit: { state: sceneEdit.state, dispatch: sceneEdit.dispatch }
    }),
    [pauseState, settingsOpen, sceneEdit]
  )

  const framesValue = useMemo<FramesContextValue>(
    () => ({
      id: frameId,
      latentGenMs,
      temporalCompression,
      inputLatency,
      timelineRef: frameTimelineRef
    }),
    [frameId, latentGenMs, temporalCompression, inputLatency, frameTimelineRef]
  )

  const engineValue = useMemo<EngineContextValue>(
    () => ({
      status: engineStatus,
      isReady: engineReady,
      isRunning: isServerRunning,
      serverLogPath,
      check: checkEngineStatus,
      setup: {
        inProgress: engineSetupInProgress,
        progress: setupProgress,
        error: engineSetupError,
        run: setupEngine,
        nukeAndReinstall: nukeAndReinstallEngine,
        abort: abortEngineInstall
      }
    }),
    [
      engineStatus,
      engineReady,
      isServerRunning,
      serverLogPath,
      checkEngineStatus,
      engineSetupInProgress,
      setupProgress,
      engineSetupError,
      setupEngine,
      nukeAndReinstallEngine,
      abortEngineInstall
    ]
  )

  const seedsValue = useMemo<SeedsContextValue>(
    () => ({
      dir: seedsDir,
      openDir: openSeedsDir,
      select: selectSeed
    }),
    [seedsDir, openSeedsDir, selectSeed]
  )

  const websocketValue = useMemo<WebsocketContextValue>(
    () => ({
      request: wsRequest,
      logs: wsLogs,
      allLogs: wsAllLogs,
      clearLogs: clearWsLogs
    }),
    [wsRequest, wsLogs, wsAllLogs, clearWsLogs]
  )

  const inputValue = useMemo<InputContextValue>(
    () => ({
      pressedKeys,
      mouseButtons,
      pressedGamepad,
      scrollActive,
      pointerLock: {
        isLocked: isPointerLocked,
        blockedSeq: pointerLockBlockedSeq,
        request: requestPointerLock,
        exit: exitPointerLock
      }
    }),
    [
      pressedKeys,
      mouseButtons,
      pressedGamepad,
      scrollActive,
      isPointerLocked,
      pointerLockBlockedSeq,
      requestPointerLock,
      exitPointerLock
    ]
  )

  const surfaceValue = useMemo<SurfaceContextValue>(
    () => ({
      registerContainer: registerContainerRef,
      registerCanvas,
      handleContainerClick
    }),
    [registerContainerRef, registerCanvas, handleContainerClick]
  )

  return (
    <StreamingProviders
      values={{
        connection: connectionValue,
        engine: engineValue,
        session: sessionValue,
        frames: framesValue,
        input: inputValue,
        seeds: seedsValue,
        websocket: websocketValue,
        surface: surfaceValue
      }}
    >
      {children}
    </StreamingProviders>
  )
}
