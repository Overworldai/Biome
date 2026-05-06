import { useState, useEffect, useRef, useCallback, useReducer, useMemo, type ReactNode } from 'react'
import { usePortal } from './portalContextValue'
import { TranslatableError } from '../i18n'
import { buildStreamingLifecycleSyncPayload } from './streamingLifecyclePayload'
import { createStreamingLifecycleEffectHandlers, runStreamingLifecycleEffects } from './streamingLifecycleEffects'
import {
  initialStreamingLifecycleState,
  streamingLifecycleReducer,
  STREAMING_LIFECYCLE_EVENT
} from './streamingLifecycleMachine'
import useWebSocket, {
  isConnected as wsIsConnected,
  isReady as wsIsReady,
  connectionError as wsConnectionError
} from '../hooks/useWebSocket'
import { useSettings } from '../hooks/settingsContextValue'
import useEngineApi from '../hooks/useEngineApi'
import useSeedsDir from '../hooks/useSeedsDir'
import { createLogger } from '../utils/logger'
import { useEngineRespawn } from '../hooks/streaming/useEngineRespawn'
import { useFrameRenderer } from '../hooks/streaming/useFrameRenderer'
import { useLoadingFailureCleanup } from '../hooks/streaming/useLoadingFailureCleanup'
import { useInputLoop } from '../hooks/streaming/useInputLoop'
import { usePauseState } from '../hooks/streaming/usePauseState'
import { usePointerLock } from '../hooks/streaming/usePointerLock'
import { useSceneEdit } from '../hooks/streaming/useSceneEdit'
import { useSessionInit } from '../hooks/streaming/useSessionInit'
import { useWarmConnection } from '../hooks/streaming/useWarmConnection'
import { ConnectionContext, type ConnectionContextValue } from './streaming/connection'
import { EngineContext, type EngineContextValue } from './streaming/engine'
import { SessionContext, type SessionContextValue } from './streaming/session'
import { FramesContext, type FramesContextValue } from './streaming/frames'
import { InputContext, type InputContextValue } from './streaming/input'
import { SeedsContext, type SeedsContextValue } from './streaming/seeds'
import { WebsocketContext, type WebsocketContextValue } from './streaming/websocket'
import { SurfaceContext, type SurfaceContextValue } from './streaming/surface'

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
  const isConnected = wsIsConnected(connectionStatus)
  const isReady = wsIsReady(connectionStatus)
  const transportError = wsConnectionError(connectionStatus)
  const { getSeedsDirPath, openSeedsDir, seedsDir } = useSeedsDir()

  const { state: pauseState, pause: pauseSession, resume: resumeSession } = usePauseState()
  const isPaused = pauseState.kind === 'paused'
  const [settingsOpen, setSettingsOpen] = useState(false)
  const sceneEdit = useSceneEdit()
  const mouseSensitivity = settings.mouse_sensitivity
  const gamepadSensitivity = settings.gamepad_sensitivity
  const [connectionLost, setConnectionLost] = useState(false)
  const [engineError, setEngineError] = useState<TranslatableError | null>(null)
  const [lifecycleState, dispatchLifecycle] = useReducer(streamingLifecycleReducer, initialStreamingLifecycleState)

  const {
    preConnectionStage,
    isFreshInstall,
    cancel: cancelWarmFlow,
    isCancelled: isWarmFlowCancelled
  } = useWarmConnection({
    requestSeq: lifecycleState.loadingConnectionRequestSeq,
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
    isConnected,
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
    mouseSensitivity,
    gamepadSensitivity,
    sendControl,
    onReset: handleReset,
    onSceneEdit: settings.scene_authoring_enabled ? handleSceneEdit : null,
    onExitPointerLock: exitPointerLock
  })

  useEffect(() => {
    dispatchLifecycle({
      type: STREAMING_LIFECYCLE_EVENT.SYNC,
      payload: buildStreamingLifecycleSyncPayload({
        portalState: state,
        connectionStatus,
        engineModel: settings?.engine_model,
        lastAppliedModel,
        engineError,
        hasReceivedFrame,
        // Init is considered complete once applyInitResponse has set model.
        // Used to gate the LOADING → STREAMING transition so an error between
        // session.ready and the init response doesn't leak us into streaming.
        initCompleted: server.model !== null,
        isPointerLocked,
        settingsOpen,
        isPaused,
        sceneEditActive: sceneEdit.graceActive,
        sceneAuthoringEnabled: settings.scene_authoring_enabled,
        engineQuant: settings.engine_quant
      })
    })
  }, [
    state,
    connectionStatus,
    settings?.engine_model,
    settings?.engine_quant,
    settings.scene_authoring_enabled,
    engineError,
    hasReceivedFrame,
    server.model,
    isPointerLocked,
    settingsOpen,
    isPaused,
    sceneEdit.graceActive,
    lastAppliedModel
  ])

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

  useEffect(() => {
    const { effects } = lifecycleState
    const handlers = createStreamingLifecycleEffectHandlers({
      log,
      settings,
      setEngineError,
      resetSession,
      isWarmFlowCancelled,
      setConnectionLost,
      setSettingsOpen,
      pauseSession,
      resumeSession,
      disconnect,
      transitionTo,
      states,
      exitPointerLock,
      sendPause,
      resume
    })

    runStreamingLifecycleEffects({ effects, handlers })
  }, [
    lifecycleState,
    transitionTo,
    states,
    disconnect,
    settings,
    exitPointerLock,
    sendPause,
    resume,
    pauseSession,
    resumeSession,
    resetSession,
    isWarmFlowCancelled
  ])

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

  // Cleanup helper for logout/dismiss
  const cleanupState = useCallback(() => {
    cancelWarmFlow()
    exitPointerLock()
    disconnect()
    setEngineError(null)
    setSettingsOpen(false)
    resumeSession()
  }, [cancelWarmFlow, exitPointerLock, disconnect, resumeSession])

  const stopServerIfRunning = useCallback(async () => {
    if (isStandaloneMode && isServerRunning) {
      log.info('Stopping standalone server...')
      try {
        await stopServer()
        log.info('Server stopped')
      } catch (err) {
        log.error('Failed to stop server:', err)
      }
    }
  }, [isStandaloneMode, isServerRunning, stopServer])

  const dismissConnectionLost = useCallback(async () => {
    log.info('Acknowledging connection lost overlay')
    setConnectionLost(false)
  }, [])

  const reconnectAfterConnectionLost = useCallback(async () => {
    log.info('Reconnecting after connection lost')
    setConnectionLost(false)
    cleanupState()
    resetSession()
    transitionTo(states.LOADING)
  }, [cleanupState, resetSession, transitionTo, states.LOADING])

  const cancelConnection = useCallback(async () => {
    log.info('Cancelling connection')
    cleanupState()
    await stopServerIfRunning()
    transitionTo(states.MAIN_MENU)
  }, [cleanupState, stopServerIfRunning, transitionTo, states.MAIN_MENU])

  const prepareReturnToMainMenu = useCallback(async () => {
    log.info('Preparing return to main menu')
    cleanupState()
    await stopServerIfRunning()
  }, [cleanupState, stopServerIfRunning])

  const error = engineError ?? transportError

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

  // The provider stack has no functional ordering — the order below is
  // chosen so each context's intended audience reads naturally
  // (connection at the outside, surface at the inside next to its
  // VideoContainer consumer).
  return (
    <ConnectionContext.Provider value={connectionValue}>
      <EngineContext.Provider value={engineValue}>
        <SessionContext.Provider value={sessionValue}>
          <SeedsContext.Provider value={seedsValue}>
            <WebsocketContext.Provider value={websocketValue}>
              <InputContext.Provider value={inputValue}>
                <FramesContext.Provider value={framesValue}>
                  <SurfaceContext.Provider value={surfaceValue}>{children}</SurfaceContext.Provider>
                </FramesContext.Provider>
              </InputContext.Provider>
            </WebsocketContext.Provider>
          </SeedsContext.Provider>
        </SessionContext.Provider>
      </EngineContext.Provider>
    </ConnectionContext.Provider>
  )
}
