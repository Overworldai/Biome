import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useReducer,
  useMemo,
  type ReactNode
} from 'react'
import { usePortal } from './PortalContext'
import { runWarmConnectionFlow } from './streamingWarmConnection'
import type { StageId } from '../stages'
import { buildStreamingLifecycleSyncPayload } from './streamingLifecyclePayload'
import { createStreamingLifecycleEffectHandlers, runStreamingLifecycleEffects } from './streamingLifecycleEffects'
import {
  initialStreamingLifecycleState,
  streamingLifecycleReducer,
  STREAMING_LIFECYCLE_EVENT
} from './streamingLifecycleMachine'
import useWebSocket from '../hooks/useWebSocket'
import useGameInput from '../hooks/useGameInput'
import { useSettings } from '../hooks/useSettings'
import { ENGINE_MODES, DEFAULT_WORLD_ENGINE_MODEL } from '../types/settings'
import useEngine from '../hooks/useEngine'
import useSeeds from '../hooks/useSeeds'
import { createLogger } from '../utils/logger'
import type { StreamingContextValue } from './streamingContextTypes'

const log = createLogger('Streaming')

// Browsers require ~1s delay before pointer lock can be re-requested
const UNLOCK_DELAY_MS = 1250

export const StreamingContext = createContext<StreamingContextValue | null>(null)

export const useStreaming = () => {
  const context = useContext(StreamingContext)
  if (!context) {
    throw new Error('useStreaming must be used within a StreamingProvider')
  }
  return context
}

export const StreamingProvider = ({ children }: { children: ReactNode }) => {
  const { state, states, transitionTo, shutdown } = usePortal()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

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
    checkPortInUse,
    probeServerHealth,
    serverLogPath,
    setupEngine,
    nukeAndReinstallEngine,
    abortEngineInstall,
    setupProgress,
    isLoading: engineSetupInProgress,
    error: engineSetupError
  } = useEngine()
  const {
    connectionState,
    statusStage,
    error,
    warning,
    frame,
    hasRealFrame,
    frameId,
    genTime,
    serverMetrics,
    inputLatency,
    logs: wsLogs,
    allLogs: wsAllLogs,
    connect,
    disconnect,
    sendControl,
    sendPause,
    sendPrompt,
    sendPromptWithSeed,
    sendInitialSeed,
    sendModel,
    setPlaceholderFrame,
    reset,
    request: wsRequest,
    clearLogs: clearWsLogs,
    isConnected,
    isReady,
    isLoading
  } = useWebSocket()
  const { getSeedsDirPath, openSeedsDir, seedsDir } = useSeeds()

  const [isPaused, setIsPaused] = useState(false)
  const [pausedAt, setPausedAt] = useState<number | null>(null)
  const [pauseElapsedMs, setPauseElapsedMs] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [mouseSensitivity, setMouseSensitivity] = useState(() => settings.mouse_sensitivity ?? 1.0)
  const [fps, setFps] = useState(0)
  const [connectionLost, setConnectionLost] = useState(false)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [endpointUrl, setEndpointUrl] = useState<string | null>(null)
  const [canvasReady, setCanvasReady] = useState(false)
  const [loadingConnectionJobSeq, setLoadingConnectionJobSeq] = useState(0)
  const [pointerLockBlockedSeq, setPointerLockBlockedSeq] = useState(0)
  const [preConnectionStage, setPreConnectionStage] = useState<StageId | null>(null)
  const [lifecycleState, dispatchLifecycle] = useReducer(streamingLifecycleReducer, initialStreamingLifecycleState)

  const [scrollActive, setScrollActive] = useState({ up: false, down: false })
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const prevEngineModeRef = useRef(engineMode)
  const frameCountRef = useRef(0)
  const lastFpsUpdateRef = useRef(performance.now())
  const inputLoopRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastAppliedModelRef = useRef<string | null>(null)
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
  const inputEnabled = isStreaming && isReady && !isPaused && !settingsOpen && !connectionLost
  const canUnpause = pauseElapsedMs >= UNLOCK_DELAY_MS

  // Track elapsed time since pause for unlock delay
  useEffect(() => {
    if (!isPaused || !pausedAt) {
      setPauseElapsedMs(0)
      return
    }

    // Update elapsed time every 50ms for smooth countdown
    const interval = setInterval(() => {
      setPauseElapsedMs(Date.now() - pausedAt)
    }, 50)

    return () => clearInterval(interval)
  }, [isPaused, pausedAt])

  // Check engine status on mount (for standalone mode)
  useEffect(() => {
    if (isStandaloneMode) {
      checkEngineStatus()
    }
  }, [isStandaloneMode, checkEngineStatus])

  // Handle engine mode switching without app restart
  useEffect(() => {
    const prevMode = prevEngineModeRef.current
    prevEngineModeRef.current = engineMode

    // Skip if mode hasn't actually changed, or if we're in MAIN_MENU state (nothing to tear down)
    if (prevMode === engineMode || !prevMode || state === states.MAIN_MENU) return

    log.info(`Engine mode changed: ${prevMode} -> ${engineMode}, performing teardown-and-reconnect`)

    // Disconnect existing WebSocket
    disconnect()

    // If the OLD mode was standalone and the server is running, stop it
    if (prevMode === ENGINE_MODES.STANDALONE && isServerRunning) {
      stopServer().catch((err) => log.error('Failed to stop server during mode switch:', err))
    }

    // Clear any existing error and transition to LOADING to re-trigger connection
    setEngineError(null)
    transitionTo(states.LOADING)
  }, [engineMode, state, states.MAIN_MENU, states.LOADING, disconnect, isServerRunning, stopServer, transitionTo])

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

    const selectedModel = settings?.engine_model || DEFAULT_WORLD_ENGINE_MODEL
    log.info('Loading connected - bootstrapping session with model+seed:', selectedModel)
    // Use the default seed image as the immediate placeholder frame so transition
    // to streaming never shows a blank frame while waiting for server output.
    wsRequest<{ image_base64: string }>('seeds_image', { filename: 'default.png' })
      .then((result) => {
        if (!result?.image_base64) return
        setPlaceholderFrame(`data:image/png;base64,${result.image_base64}`)
      })
      .catch(() => null)
    sendModel(selectedModel, 'default.png')
    lastAppliedModelRef.current = selectedModel
    warmBootstrapSentRef.current = true
  }, [state, states.LOADING, isConnected, settings?.engine_model, sendModel, setPlaceholderFrame, wsRequest])

  useEffect(() => {
    if (!isConnected) {
      warmBootstrapSentRef.current = false
      setPlaceholderFrame(null)
    }
  }, [isConnected, setPlaceholderFrame])

  // Pointer lock controls
  const requestPointerLock = useCallback(() => {
    if (connectionLost) {
      return false
    }

    // https://github.com/electron/electron/issues/33587 seems like there's no way around the pointerLock cooldown
    // Enforce browser pointer-lock cooldown after an unlock to avoid dropped lock requests.
    if (isPaused && !canUnpause) {
      const remainingMs = Math.max(0, UNLOCK_DELAY_MS - pauseElapsedMs)
      log.info(`Pointer lock request blocked by cooldown (${remainingMs}ms remaining)`)
      setPointerLockBlockedSeq((seq) => seq + 1)
      return false
    }

    containerRef.current?.requestPointerLock()
    return true
  }, [connectionLost, isPaused, canUnpause, pauseElapsedMs])

  const exitPointerLock = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
  }, [])

  const handleReset = useCallback(() => {
    reset()
    requestPointerLock()
  }, [reset, requestPointerLock])

  const { pressedKeys, mouseButtons, getInputState, isPointerLocked } = useGameInput(
    inputEnabled,
    containerRef,
    handleReset,
    settings.keybindings
  )

  useEffect(() => {
    dispatchLifecycle({
      type: STREAMING_LIFECYCLE_EVENT.SYNC,
      payload: buildStreamingLifecycleSyncPayload({
        portalState: state,
        connectionState,
        transportError: error,
        engineModel: settings?.engine_model,
        lastAppliedModel: lastAppliedModelRef.current,
        engineError,
        hasReceivedFrame,
        socketReady: isReady,
        isPointerLocked,
        settingsOpen,
        isPaused
      })
    })
  }, [
    state,
    connectionState,
    error,
    settings?.engine_model,
    engineError,
    hasReceivedFrame,
    isReady,
    isPointerLocked,
    settingsOpen,
    isPaused
  ])

  useEffect(() => {
    if (loadingConnectionJobSeq === 0) return

    warmFlowCancelledRef.current = false

    const handleServerError = (err: unknown) => {
      if (warmFlowCancelledRef.current) return
      const errorMsg = err instanceof Error ? err.message : String(err)
      log.error('Server error:', errorMsg)
      setEngineError(errorMsg)
      // Don't transition to main menu immediately - wait for user to dismiss the error
    }

    // Clear WS logs before starting a new connection
    clearWsLogs()

    runWarmConnectionFlow({
      currentServerPort: serverPort,
      isStandaloneMode,
      endpointUrl,
      serverUrl: settings.server_url,
      isServerRunning,
      checkServerReady,
      checkPortInUse,
      probeServerHealthViaMain: probeServerHealth,
      checkEngineStatus,
      startServer,
      setupEngine,
      connect,
      onServerError: handleServerError,
      onStage: (stageId) => {
        if (!warmFlowCancelledRef.current) setPreConnectionStage(stageId)
      },
      isCancelled: () => warmFlowCancelledRef.current,
      log
    }).catch((err) => {
      if (warmFlowCancelledRef.current) return
      handleServerError(err)
    })

    return () => {
      warmFlowCancelledRef.current = true
      setPreConnectionStage(null)
    }
  }, [loadingConnectionJobSeq])

  useEffect(() => {
    const loadingFailed =
      state === states.LOADING && (connectionState === 'error' || connectionState === 'disconnected')

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
    connectionState,
    engineError,
    isStandaloneMode,
    isServerRunning,
    stopServer,
    checkEngineStatus
  ])

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
      setIsPaused,
      setPausedAt,
      disconnect,
      transitionTo,
      states,
      lastAppliedModelRef,
      exitPointerLock,
      sendPause
    })

    runStreamingLifecycleEffects({ effects, handlers })
  }, [
    lifecycleState,
    transitionTo,
    states.MAIN_MENU,
    states.LOADING,
    states.STREAMING,
    disconnect,
    settings?.engine_model,
    exitPointerLock,
    sendPause
  ])

  // Render frames to canvas
  useEffect(() => {
    if (!frame || !canvasRef.current || !canvasReady) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    frameCountRef.current++
    const now = performance.now()
    if (now - lastFpsUpdateRef.current >= 1000) {
      setFps(frameCountRef.current)
      frameCountRef.current = 0
      lastFpsUpdateRef.current = now
    }

    const img = new Image()
    img.onload = () => {
      const targetW = canvas.width
      const targetH = canvas.height
      ctx.clearRect(0, 0, targetW, targetH)
      ctx.drawImage(img, 0, 0, targetW, targetH)
    }
    img.src = frame.startsWith('data:') ? frame : `data:image/jpeg;base64,${frame}`
  }, [frame, canvasReady])

  // Input loop at 60hz
  useEffect(() => {
    if (!inputEnabled) {
      if (inputLoopRef.current) {
        clearInterval(inputLoopRef.current)
        inputLoopRef.current = null
      }
      return
    }

    inputLoopRef.current = setInterval(() => {
      const { buttons, mouseDx, mouseDy } = getInputState()
      const scrollUp = buttons.includes('SCROLL_UP')
      const scrollDown = buttons.includes('SCROLL_DOWN')
      if (scrollUp || scrollDown) {
        setScrollActive({ up: scrollUp, down: scrollDown })
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = setTimeout(() => setScrollActive({ up: false, down: false }), 150)
      }
      sendControl(buttons, Math.round(mouseDx * mouseSensitivity), Math.round(mouseDy * mouseSensitivity))
    }, 16)

    return () => {
      if (inputLoopRef.current) {
        clearInterval(inputLoopRef.current)
        inputLoopRef.current = null
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = null
      }
    }
  }, [inputEnabled, getInputState, sendControl, mouseSensitivity])

  // Ref registration callbacks
  const registerContainerRef = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element
  }, [])
  const registerCanvasRef = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element
    setCanvasReady(!!element)
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
    setIsPaused(false)
    setPausedAt(null)
  }, [exitPointerLock, disconnect])

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

  const logout = useCallback(async () => {
    log.info('Logout initiated')
    cleanupState()
    await stopServerIfRunning()
    await shutdown()
    log.info('Logout complete')
  }, [cleanupState, stopServerIfRunning, shutdown])

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

  const value: StreamingContextValue = {
    // Connection state
    connectionState,
    connectionLost,
    error,
    warning,
    isConnected,
    isVideoReady: hasReceivedFrame && canvasReady,
    isReady,
    isLoading,
    isStreaming,
    isPaused,
    pausedAt,
    canUnpause,
    unlockDelayMs: UNLOCK_DELAY_MS,
    pauseElapsedMs,
    settingsOpen,
    statusStage: effectiveStatusStage,

    // Stats
    genTime,
    frameId,
    fps,
    stats: {
      gentime: genTime ?? 0,
      rtt: 0
    },
    showStats,
    setShowStats,
    serverMetrics,
    inputLatency,
    debugMetrics: settings.debug_metrics ?? false,

    endpointUrl,
    setEndpointUrl,

    // Standalone engine state
    isServerRunning,
    engineReady,
    engineError,
    clearEngineError: () => setEngineError(null),
    serverLogPath,
    // Engine setup/status (shared state for all components)
    engineStatus,
    checkEngineStatus,
    setupEngine,
    nukeAndReinstallEngine,
    abortEngineSetup: abortEngineInstall,
    engineSetupInProgress,
    setupProgress,
    engineSetupError,

    // Seeds
    openSeedsDir,
    seedsDir,

    // WS RPC
    wsRequest,
    wsLogs,
    wsAllLogs,
    clearWsLogs,

    // Settings
    mouseSensitivity,
    setMouseSensitivity,

    // Input state
    pressedKeys,
    mouseButtons,
    scrollActive,
    isPointerLocked,
    pointerLockBlockedSeq,

    // Actions
    connect,
    disconnect,
    logout,
    dismissConnectionLost,
    reconnectAfterConnectionLost,
    cancelConnection,
    prepareReturnToMainMenu,
    reset,
    sendPrompt,
    sendPromptWithSeed,
    sendInitialSeed,
    requestPointerLock,
    exitPointerLock,
    registerContainerRef,
    registerCanvasRef,
    handleContainerClick
  }

  return <StreamingContext.Provider value={value}>{children}</StreamingContext.Provider>
}

export default StreamingContext
