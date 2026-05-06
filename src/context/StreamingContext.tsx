import { useState, useEffect, useRef, useCallback, useReducer, useMemo, type ReactNode } from 'react'
import { usePortal } from './portalContextValue'
import { runWarmConnectionFlow, toTranslatableError } from './streamingWarmConnection'
import { TranslatableError } from '../i18n'
import type { StageId } from '../stages'
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
import { ENGINE_MODES, DEFAULT_WORLD_ENGINE_MODEL } from '../types/settings'
import useEngineApi from '../hooks/useEngineApi'
import useSeedsDir from '../hooks/useSeedsDir'
import { invoke } from '../bridge'
import { createLogger } from '../utils/logger'
import { buildSessionConfig } from './streaming/sessionConfig'
import { useFrameRenderer } from '../hooks/streaming/useFrameRenderer'
import { useInputLoop } from '../hooks/streaming/useInputLoop'
import { usePauseState } from '../hooks/streaming/usePauseState'
import { usePointerLock } from '../hooks/streaming/usePointerLock'
import { ConnectionContext, type ConnectionContextValue } from './streaming/connection'
import { EngineContext, type EngineContextValue } from './streaming/engine'
import { SessionContext, type SessionContextValue } from './streaming/session'
import { FramesContext, type FramesContextValue } from './streaming/frames'
import { InputContext, type InputContextValue } from './streaming/input'
import { SeedsContext, type SeedsContextValue } from './streaming/seeds'
import { WebsocketContext, type WebsocketContextValue } from './streaming/websocket'
import { SurfaceContext, type SurfaceContextValue } from './streaming/surface'
import { initialSceneEditState, sceneEditReducer } from './sceneEditMachine'

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
  const [sceneEditState, dispatchSceneEdit] = useReducer(sceneEditReducer, initialSceneEditState)
  const sceneEditActive = sceneEditState.phase !== 'inactive'
  const [sceneEditGrace, setSceneEditGrace] = useState(false)
  const mouseSensitivity = settings.mouse_sensitivity
  const gamepadSensitivity = settings.gamepad_sensitivity
  const [connectionLost, setConnectionLost] = useState(false)
  const [engineError, setEngineError] = useState<TranslatableError | null>(null)
  const [loadingConnectionJobSeq, setLoadingConnectionJobSeq] = useState(0)
  const [preConnectionStage, setPreConnectionStage] = useState<StageId | null>(null)
  const [isFreshInstall, setIsFreshInstall] = useState(false)
  const [lifecycleState, dispatchLifecycle] = useReducer(streamingLifecycleReducer, initialStreamingLifecycleState)

  const prevEngineModeRef = useRef(engineMode)
  const prevOfflineModeRef = useRef(settings.offline_mode ?? false)
  const lastAppliedModelRef = useRef<string | null>(null)
  const lastSeedRef = useRef<{ filename: string; imageData: string } | null>(null)
  const warmBootstrapSentRef = useRef(false)
  const warmFlowCancelledRef = useRef(false)
  const loadingFailureStopHandledRef = useRef(false)

  // Once the WebSocket starts reporting its own stages, clear the pre-connection stage
  const effectiveStatusStage = useMemo(() => statusStage ?? preConnectionStage, [statusStage, preConnectionStage])
  useEffect(() => {
    if (statusStage) setPreConnectionStage(null)
  }, [statusStage])

  const hasReceivedFrame = frame !== null
  const isStreaming = state === states.STREAMING
  const inputEnabled = isStreaming && isReady && !isPaused && !settingsOpen && !connectionLost && !sceneEditActive

  // Time-based grace period after scene edit closes — suppresses pauseOnPointerUnlock
  // long enough for the delayed requestPointerLock() to succeed.
  useEffect(() => {
    if (sceneEditActive) {
      setSceneEditGrace(true)
    } else if (sceneEditGrace) {
      const timer = setTimeout(() => setSceneEditGrace(false), 500)
      return () => clearTimeout(timer)
    }
  }, [sceneEditActive]) // eslint-disable-line react-hooks/exhaustive-deps

  // Check engine status on mount (for standalone mode)
  useEffect(() => {
    if (isStandaloneMode) {
      checkEngineStatus()
    }
  }, [isStandaloneMode, checkEngineStatus])

  // Restart whenever a spawn-time setting changes: engine_mode (local-vs-remote
  // process) or offline_mode (env vars injected at spawn). The env only takes
  // effect when the Python process starts, so a mid-stream toggle needs a full
  // teardown-and-reconnect. Offline changes only matter in standalone mode.
  useEffect(() => {
    const prevMode = prevEngineModeRef.current
    const prevOffline = prevOfflineModeRef.current
    const nextOffline = settings.offline_mode ?? false
    prevEngineModeRef.current = engineMode
    prevOfflineModeRef.current = nextOffline

    const engineModeChanged = !!prevMode && prevMode !== engineMode
    const offlineChanged = prevOffline !== nextOffline && engineMode === ENGINE_MODES.STANDALONE

    if (!engineModeChanged && !offlineChanged) return
    if (state === states.MAIN_MENU) return

    log.info(`Respawn: engine_mode ${prevMode}->${engineMode}, offline ${prevOffline}->${nextOffline}`)

    disconnect()
    if (isServerRunning) {
      stopServer().catch((err) => log.error('Failed to stop server during respawn:', err))
    }
    setEngineError(null)
    transitionTo(states.LOADING)
  }, [
    engineMode,
    settings.offline_mode,
    state,
    states.MAIN_MENU,
    states.LOADING,
    disconnect,
    isServerRunning,
    stopServer,
    transitionTo
  ])

  // Resolve local seeds dir path on mount (does not require server availability)
  useEffect(() => {
    getSeedsDirPath().catch((err) => {
      log.error('Failed to resolve seeds directory path:', err)
    })
  }, [getSeedsDirPath])

  // Bootstrap each new LOADING websocket session deterministically:
  // send model + seed together so server applies model first and can load seed
  // immediately when model load completes.
  useEffect(() => {
    if (state !== states.LOADING) return
    if (!isConnected) return
    if (warmBootstrapSentRef.current) return
    warmBootstrapSentRef.current = true

    const selectedModel = settings?.engine_model || DEFAULT_WORLD_ENGINE_MODEL
    const seedFilename = lastSeedRef.current?.filename ?? 'default.jpg'
    log.info('Loading connected - bootstrapping session with model+seed:', selectedModel, seedFilename)

    const bootstrap = async () => {
      // Load seed image data via IPC (or reuse cached)
      let imageData = lastSeedRef.current?.imageData
      if (!imageData) {
        const result = await invoke('get-seed-image-base64', seedFilename)
        if (result) {
          imageData = result.base64
          lastSeedRef.current = { filename: seedFilename, imageData }
        }
      }

      // Use the seed image as placeholder frame
      if (imageData) {
        const binary = atob(imageData)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        setPlaceholderFrame(new Blob([bytes], { type: 'image/jpeg' }))
      }

      // Set lastAppliedModel before await to prevent the lifecycle machine from
      // seeing a model mismatch during the re-render triggered by applyInitResponse.
      const quant = settings.engine_quant ?? 'none'
      lastAppliedModelRef.current = settings.scene_authoring_enabled
        ? `${selectedModel}+scene_authoring+${quant}`
        : `${selectedModel}+${quant}`

      // App version — embedded into recording metadata so MP4s carry a
      // self-describing record of what Biome build produced them. Best-effort;
      // a fetch failure just omits the field from the metadata.
      const diag = await invoke('get-runtime-diagnostics-meta').catch(() => null)
      const biomeVersion = diag?.app_version

      const config = await buildSessionConfig(settings, isStandaloneMode)
      const metrics = await sendInit({
        model: selectedModel,
        config,
        seed_image_data: imageData,
        seed_filename: seedFilename,
        biome_version: biomeVersion
      })
      applyInitResponse(metrics)
    }

    bootstrap().catch((err) => log.error('Bootstrap failed:', err))
  }, [state, states.LOADING, isConnected, isStandaloneMode, settings, sendInit, applyInitResponse, setPlaceholderFrame])

  useEffect(() => {
    if (!isConnected) {
      warmBootstrapSentRef.current = false
      setPlaceholderFrame(null)
    }
  }, [isConnected, setPlaceholderFrame])

  // Live re-apply of the session config during streaming. Any change to
  // a live-toggleable SessionConfig field (action logging, video
  // recording, inference cap) re-sends the full config; the server diffs
  // against current state and applies whatever differs without tearing
  // the session down. Model / quant / scene-authoring changes can't be
  // hot-swapped — those trigger a full lifecycle reconnect instead, so
  // they're deliberately not in this dep list to avoid racing the
  // reconnect with a stale-state init send.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  useEffect(() => {
    if (!isStreaming || !isConnected) return
    const run = async () => {
      const current = settingsRef.current
      const config = await buildSessionConfig(current, isStandaloneMode)
      await sendInit({
        model: current.engine_model || DEFAULT_WORLD_ENGINE_MODEL,
        config
      })
    }
    run().catch((err) => log.error('Failed to re-apply session config:', err))
  }, [
    isStreaming,
    isConnected,
    isStandaloneMode,
    settings.debug_overlays?.action_logging,
    settings.recording?.enabled,
    settings.recording?.output_dir,
    settings.cap_inference_fps,
    sendInit
  ])

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
    dispatchSceneEdit({ type: 'OPEN' })
  }, [exitPointerLock])

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
        lastAppliedModel: lastAppliedModelRef.current,
        engineError,
        hasReceivedFrame,
        // Init is considered complete once applyInitResponse has set model.
        // Used to gate the LOADING → STREAMING transition so an error between
        // session.ready and the init response doesn't leak us into streaming.
        initCompleted: server.model !== null,
        isPointerLocked,
        settingsOpen,
        isPaused,
        sceneEditActive: sceneEditGrace,
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
    sceneEditGrace
  ])

  useEffect(() => {
    if (loadingConnectionJobSeq === 0) return

    warmFlowCancelledRef.current = false

    const handleServerError = (err: TranslatableError) => {
      if (warmFlowCancelledRef.current) return
      log.error('Server error:', err)
      setEngineError(err)
      // Don't transition to main menu immediately - wait for user to dismiss the error
    }

    // Clear WS logs before starting a new connection
    clearWsLogs()

    const offlineMode = settings.offline_mode ?? false

    runWarmConnectionFlow({
      currentServerPort: serverPort,
      isStandaloneMode,
      offlineMode,
      endpointUrl: null,
      serverUrl: settings.server_url,
      isServerRunning,
      checkServerReady,
      checkPortInUse,
      checkServerRunning,
      getLastServerExitTail,
      probeServerHealthViaMain: probeServerHealth,
      checkEngineStatus,
      startServer,
      setupEngine,
      connect,
      onServerError: handleServerError,
      onStage: (stageId) => {
        if (!warmFlowCancelledRef.current) setPreConnectionStage(stageId)
      },
      onFreshInstall: (isFresh) => {
        if (!warmFlowCancelledRef.current) setIsFreshInstall(isFresh)
      },
      isCancelled: () => warmFlowCancelledRef.current,
      log
    }).catch((err) => {
      if (warmFlowCancelledRef.current) return
      handleServerError(toTranslatableError(err, offlineMode))
    })

    return () => {
      warmFlowCancelledRef.current = true
      setPreConnectionStage(null)
      setIsFreshInstall(false)
    }
    // Only restart the warm-connection flow when a new job is requested; all other
    // referenced values are read latest-at-call-time on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingConnectionJobSeq])

  useEffect(() => {
    const loadingFailed =
      state === states.LOADING && (connectionStatus.kind === 'error' || connectionStatus.kind === 'idle')

    if (!loadingFailed || !engineError) {
      loadingFailureStopHandledRef.current = false
      return
    }
    if (!isStandaloneMode || !isServerRunning) return
    if (loadingFailureStopHandledRef.current) return

    loadingFailureStopHandledRef.current = true
    ;(async () => {
      log.info('Loading failure detected - stopping standalone server')
      try {
        await stopServer()
      } catch (stopErr) {
        log.error('Failed to stop standalone server after loading failure:', stopErr)
      }
    })()
  }, [
    state,
    states.LOADING,
    connectionStatus,
    engineError,
    isStandaloneMode,
    isServerRunning,
    stopServer,
    checkEngineStatus
  ])

  const resume = useCallback(() => {
    setSettingsOpen(false)
    resumeSession()
    sendPause(false)
  }, [sendPause, resumeSession])

  useEffect(() => {
    const { effects } = lifecycleState
    const handlers = createStreamingLifecycleEffectHandlers({
      log,
      lifecycleState,
      settings,
      setEngineError,
      setWarmConnectionJobSeq: setLoadingConnectionJobSeq,
      warmBootstrapSentRef,
      warmFlowCancelledRef,
      setConnectionLost,
      setSettingsOpen,
      pauseSession,
      resumeSession,
      disconnect,
      transitionTo,
      states,
      lastAppliedModelRef,
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
    resumeSession
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
    warmFlowCancelledRef.current = true
    exitPointerLock()
    disconnect()
    setEngineError(null)
    setSettingsOpen(false)
    resumeSession()
  }, [exitPointerLock, disconnect, resumeSession])

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
    warmBootstrapSentRef.current = false
    transitionTo(states.LOADING)
  }, [cleanupState, transitionTo, states.LOADING])

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

  const selectSeed = useCallback(
    async (filename: string) => {
      const result = await invoke('get-seed-image-base64', filename)
      if (!result) return
      lastSeedRef.current = { filename, imageData: result.base64 }
      const config = await buildSessionConfig(settingsRef.current, isStandaloneMode)
      const metrics = await sendInit({
        model: settingsRef.current.engine_model || DEFAULT_WORLD_ENGINE_MODEL,
        config,
        seed_image_data: result.base64,
        seed_filename: filename
      })
      applyInitResponse(metrics)
    },
    [sendInit, applyInitResponse, isStandaloneMode]
  )

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
      sceneEdit: { state: sceneEditState, dispatch: dispatchSceneEdit }
    }),
    [pauseState, settingsOpen, sceneEditState, dispatchSceneEdit]
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
