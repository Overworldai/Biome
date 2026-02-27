import { createContext, useContext, useState, useEffect, useRef, useCallback, useReducer, type ReactNode } from 'react'
import { invoke, listen } from '../bridge'
import { usePortal } from './PortalContext'
import { runWarmConnectionFlow } from './streamingWarmConnection'
import { buildStreamingLifecycleSyncPayload } from './streamingLifecyclePayload'
import { createStreamingLifecycleEffectHandlers, runStreamingLifecycleEffects } from './streamingLifecycleEffects'
import {
  initialStreamingLifecycleState,
  streamingLifecycleReducer,
  STREAMING_LIFECYCLE_EVENT
} from './streamingLifecycleMachine'
import useWebSocket from '../hooks/useWebSocket'
import useGameInput from '../hooks/useGameInput'
import { useConfig, STANDALONE_PORT, ENGINE_MODES, DEFAULT_WORLD_ENGINE_MODEL } from '../hooks/useConfig'
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

  const { config, isStandaloneMode, engineMode } = useConfig()
  const {
    status: engineStatus,
    startServer,
    stopServer,
    isServerRunning,
    isReady: engineReady,
    checkStatus: checkEngineStatus,
    checkServerReady,
    checkPortInUse,
    serverLogPath,
    setupEngine,
    setupProgress,
    isLoading: engineSetupInProgress,
    error: engineSetupError
  } = useEngine()
  const {
    connectionState,
    statusCode,
    error,
    frame,
    hasRealFrame,
    frameId,
    genTime,
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
    isConnected,
    isReady,
    isLoading
  } = useWebSocket()
  const { initializeSeeds, openSeedsDir, seedsDir } = useSeeds()

  const [isPaused, setIsPaused] = useState(false)
  const [pausedAt, setPausedAt] = useState<number | null>(null)
  const [pauseElapsedMs, setPauseElapsedMs] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [mouseSensitivity, setMouseSensitivity] = useState(1.0)
  const [fps, setFps] = useState(0)
  const [connectionLost, setConnectionLost] = useState(false)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [endpointUrl, setEndpointUrl] = useState<string | null>(null)
  const [canvasReady, setCanvasReady] = useState(false)
  const [loadingConnectionJobSeq, setLoadingConnectionJobSeq] = useState(0)
  const [lifecycleState, dispatchLifecycle] = useReducer(streamingLifecycleReducer, initialStreamingLifecycleState)

  const prevEngineModeRef = useRef(engineMode)
  const frameCountRef = useRef(0)
  const lastFpsUpdateRef = useRef(performance.now())
  const inputLoopRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastAppliedModelRef = useRef<string | null>(null)
  const warmBootstrapSentRef = useRef(false)

  const hasReceivedFrame = frame !== null
  const isStreaming = state === states.STREAMING
  const inputEnabled = isStreaming && isReady && !isPaused && !settingsOpen
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

  // Initialize seeds on mount
  useEffect(() => {
    initializeSeeds().catch((err) => {
      log.error('Failed to initialize seeds:', err)
    })
  }, [initializeSeeds])

  // Bootstrap each new LOADING websocket session deterministically:
  // send model + seed together so server applies model first and can load seed
  // immediately when model load completes.
  useEffect(() => {
    if (state !== states.LOADING) return
    if (!isConnected) return
    if (warmBootstrapSentRef.current) return

    const selectedModel = config?.features?.world_engine_model || DEFAULT_WORLD_ENGINE_MODEL
    log.info('Loading connected - bootstrapping session with model+seed:', selectedModel)
    // Use the default seed image as the immediate placeholder frame so transition
    // to streaming never shows a blank frame while waiting for server output.
    invoke('read-seed-as-base64', 'default.png')
      .then((seedB64) => {
        if (!seedB64) return
        setPlaceholderFrame(`data:image/png;base64,${seedB64}`)
      })
      .catch(() => null)
    sendModel(selectedModel, 'default.png')
    lastAppliedModelRef.current = selectedModel
    warmBootstrapSentRef.current = true
  }, [state, states.LOADING, isConnected, config?.features?.world_engine_model, sendModel, setPlaceholderFrame])

  useEffect(() => {
    if (!isConnected) {
      warmBootstrapSentRef.current = false
      setPlaceholderFrame(null)
    }
  }, [isConnected, setPlaceholderFrame])

  // Pointer lock controls
  const requestPointerLock = useCallback(() => {
    // Enforce browser pointer-lock cooldown after an unlock to avoid dropped lock requests.
    if (isPaused && !canUnpause) {
      const remainingMs = Math.max(0, UNLOCK_DELAY_MS - pauseElapsedMs)
      log.info(`Pointer lock request blocked by cooldown (${remainingMs}ms remaining)`)
      return false
    }

    containerRef.current?.requestPointerLock()
    return true
  }, [isPaused, canUnpause, pauseElapsedMs])

  const exitPointerLock = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
  }, [])

  const togglePointerLock = useCallback(() => {
    if (!isStreaming || !isReady) return
    if (document.pointerLockElement) {
      document.exitPointerLock()
      return
    }
    requestPointerLock()
  }, [isStreaming, isReady, requestPointerLock])

  const handleReset = useCallback(() => {
    reset()
    requestPointerLock()
  }, [reset, requestPointerLock])

  const { pressedKeys, getInputState, isPointerLocked } = useGameInput(
    inputEnabled,
    containerRef,
    handleReset,
    togglePointerLock
  )

  useEffect(() => {
    dispatchLifecycle({
      type: STREAMING_LIFECYCLE_EVENT.SYNC,
      payload: buildStreamingLifecycleSyncPayload({
        portalState: state,
        connectionState,
        transportError: error,
        configWorldEngineModel: config?.features?.world_engine_model,
        lastAppliedModel: lastAppliedModelRef.current,
        engineError,
        statusCode,
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
    config?.features?.world_engine_model,
    engineError,
    statusCode,
    hasReceivedFrame,
    isReady,
    isPointerLocked,
    settingsOpen,
    isPaused
  ])

  useEffect(() => {
    if (loadingConnectionJobSeq === 0) return

    let cancelled = false
    let unlisten: (() => void) | null = null

    const handleServerError = (err: unknown) => {
      const errorMsg = err instanceof Error ? err.message : String(err)
      log.error('Server error:', errorMsg)
      setEngineError(errorMsg)
      // Don't transition to cold immediately - wait for user to dismiss the error
    }

    runWarmConnectionFlow({
      standalonePort: STANDALONE_PORT,
      isStandaloneMode,
      endpointUrl,
      gpuServer: config.gpu_server,
      isServerRunning,
      checkServerReady,
      checkPortInUse,
      checkEngineStatus,
      startServer,
      connect,
      setUnlisten: (fn: () => void) => {
        unlisten = fn
      },
      listenForServerReady: (onReady) => Promise.resolve(listen('server-ready', () => onReady())),
      onServerError: handleServerError,
      isCancelled: () => cancelled,
      log
    }).catch((err) => {
      if (cancelled) return
      handleServerError(err)
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [loadingConnectionJobSeq])

  useEffect(() => {
    const { effects } = lifecycleState
    const handlers = createStreamingLifecycleEffectHandlers({
      log,
      lifecycleState,
      config,
      setEngineError,
      setWarmConnectionJobSeq: setLoadingConnectionJobSeq,
      warmBootstrapSentRef,
      setConnectionLost,
      setSettingsOpen,
      setIsPaused,
      setPausedAt,
      disconnect,
      transitionTo,
      states,
      lastAppliedModelRef,
      exitPointerLock,
      requestPointerLock,
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
    config?.features?.world_engine_model,
    exitPointerLock,
    requestPointerLock,
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
      sendControl(buttons, Math.round(mouseDx * mouseSensitivity), Math.round(mouseDy * mouseSensitivity))
    }, 16)

    return () => {
      if (inputLoopRef.current) {
        clearInterval(inputLoopRef.current)
        inputLoopRef.current = null
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
    if (isStreaming && isReady) requestPointerLock()
  }, [isStreaming, isReady, requestPointerLock])

  // Cleanup helper for logout/dismiss
  const cleanupState = useCallback(() => {
    exitPointerLock()
    disconnect()
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
    log.info('Dismissing connection lost overlay')
    setConnectionLost(false)
    cleanupState()
    await stopServerIfRunning()
    await shutdown()
  }, [cleanupState, stopServerIfRunning, shutdown])

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
    statusCode,

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

    // Local mode - no session management
    sessionRemaining: null,
    sessionExpired: false,
    sessionTimeDisplay: null,
    gpuAssignment: null,
    setGpuAssignment: () => {},
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
    engineSetupInProgress,
    setupProgress,
    engineSetupError,

    // Seeds
    openSeedsDir,
    seedsDir,

    // Settings
    mouseSensitivity,
    setMouseSensitivity,

    // Input state
    pressedKeys,
    isPointerLocked,

    // Actions
    connect,
    disconnect,
    logout,
    dismissConnectionLost,
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
    registerVideoRef: () => {},
    handleContainerClick
  }

  return <StreamingContext.Provider value={value}>{children}</StreamingContext.Provider>
}

export default StreamingContext
