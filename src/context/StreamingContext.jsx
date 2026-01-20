import { useState, useEffect, useRef, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { StreamingContext, useStreaming } from './StreamingContextShared'
import { usePortal } from './PortalContext'
import useWebSocket from '../hooks/useWebSocket'
import useGameInput from '../hooks/useGameInput'
import { useConfig, STANDALONE_PORT, ENGINE_MODES } from '../hooks/useConfig'
import useEngine from '../hooks/useEngine'
import useSeeds from '../hooks/useSeeds'
import { createLogger } from '../utils/logger'

const log = createLogger('Streaming')

// Browsers require ~1s delay before pointer lock can be re-requested
const UNLOCK_DELAY_MS = 1250

export { useStreaming }

export const StreamingProvider = ({ children }) => {
  const { state, states, transitionTo, shutdown, isConnected: portalConnected } = usePortal()
  const containerRef = useRef(null)
  const canvasRef = useRef(null)

  const {
    config,
    isLoaded: configLoaded,
    reloadConfig,
    saveConfig,
    hasOpenAiKey,
    hasFalKey,
    engineMode,
    isStandaloneMode,
    isServerMode
  } = useConfig()
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
    frameId,
    genTime,
    connect,
    disconnect,
    sendControl,
    sendPause,
    sendPrompt,
    sendPromptWithSeed,
    sendInitialSeed,
    reset,
    isConnected,
    isReady,
    isLoading
  } = useWebSocket()
  const {
    initializeSeeds,
    getRandomSeedBase64,
    openSeedsDir,
    seedsDir
  } = useSeeds()

  const [isPaused, setIsPaused] = useState(false)
  const [pausedAt, setPausedAt] = useState(null)
  const [pauseElapsedMs, setPauseElapsedMs] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [mouseSensitivity, setMouseSensitivity] = useState(1.0)
  const [fps, setFps] = useState(0)
  const [connectionLost, setConnectionLost] = useState(false)
  const [engineError, setEngineError] = useState(null)
  const [endpointUrl, setEndpointUrl] = useState(null)
  const [canvasReady, setCanvasReady] = useState(false)

  const wasConnectingOrConnectedRef = useRef(false)
  const hadErrorRef = useRef(false)
  const frameCountRef = useRef(0)
  const lastFpsUpdateRef = useRef(performance.now())
  const inputLoopRef = useRef(null)

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

  // Bottom panel visibility (persisted in config)
  const bottomPanelHidden = config?.ui?.bottom_panel_hidden ?? false
  const setBottomPanelHidden = useCallback(
    async (hidden) => {
      await saveConfig({ ...config, ui: { ...config.ui, bottom_panel_hidden: hidden } })
    },
    [config, saveConfig]
  )

  // Check engine status on mount (for standalone mode)
  useEffect(() => {
    if (isStandaloneMode) {
      checkEngineStatus()
    }
  }, [isStandaloneMode, checkEngineStatus])

  // Initialize seeds on mount
  useEffect(() => {
    initializeSeeds().catch((err) => {
      log.error('Failed to initialize seeds:', err)
    })
  }, [initializeSeeds])

  // Send initial seed when server is waiting for it
  useEffect(() => {
    if (statusCode === 'waiting_for_seed' && isConnected) {
      log.info('Server waiting for seed, sending random seed...')
      getRandomSeedBase64()
        .then((seedBase64) => {
          if (seedBase64) {
            sendInitialSeed(seedBase64)
            log.info('Initial seed sent to server')
          } else {
            log.error('No seeds available to send')
            setEngineError('No seed images available. Please add images to the seeds folder.')
          }
        })
        .catch((err) => {
          log.error('Failed to get random seed:', err)
          setEngineError('Failed to load seed image: ' + (err.message || err))
        })
    }
  }, [statusCode, isConnected, getRandomSeedBase64, sendInitialSeed])

  // Pointer lock controls
  const requestPointerLock = useCallback(() => {
    containerRef.current?.requestPointerLock()
  }, [])

  const exitPointerLock = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
  }, [])

  const togglePointerLock = useCallback(() => {
    if (!isStreaming || !isReady) return
    document.pointerLockElement ? document.exitPointerLock() : containerRef.current?.requestPointerLock()
  }, [isStreaming, isReady])

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

  // Sync settings/pause state with pointer lock
  useEffect(() => {
    if (!isStreaming || !isReady) return

    if (isPointerLocked && (settingsOpen || isPaused)) {
      setSettingsOpen(false)
      setIsPaused(false)
      setPausedAt(null)
      sendPause(false)
      log.info('Pointer locked - settings closed, resumed')
    } else if (!isPointerLocked && !settingsOpen && !isPaused) {
      setSettingsOpen(true)
      setIsPaused(true)
      setPausedAt(Date.now())
      sendPause(true)
      log.info('Pointer unlocked - settings opened, paused')
    }
  }, [isPointerLocked, isStreaming, isReady, settingsOpen, isPaused, sendPause])

  // Connect when entering WARM state
  useEffect(() => {
    if (state !== states.WARM) return

    let cancelled = false
    let unlisten = null

    const connectToServer = async () => {
      const standaloneUrl = `localhost:${STANDALONE_PORT}`

      setEngineError(null)

      // When standalone engine is on, always use localhost:STANDALONE_PORT
      const wsUrl = isStandaloneMode
        ? standaloneUrl
        : endpointUrl || `${config.gpu_server.host}:${config.gpu_server.port}`

      if (isStandaloneMode) {
        log.info('Standalone mode enabled, checking server state...')

        const serverAlreadyReady = await checkServerReady()
        if (serverAlreadyReady) {
          log.info('Server already running and ready')
        } else {
          const portInUse = await checkPortInUse(STANDALONE_PORT)
          if (portInUse) {
            log.info(`Port ${STANDALONE_PORT} already in use - assuming server is ready`)
          } else if (isServerRunning) {
            // Wait for running server to become ready
            log.info('Server running but not ready - waiting...')
            try {
              await waitForServerReady(
                () => cancelled,
                (fn) => {
                  unlisten = fn
                }
              )
              if (cancelled) return
            } catch (err) {
              if (cancelled) return
              handleServerError(err)
              return
            }
          } else {
            // Start new server
            log.info('Starting server on port', STANDALONE_PORT)
            const status = await checkEngineStatus()
            if (!status?.uv_installed || !status?.repo_cloned || !status?.dependencies_synced) {
              const missing = []
              if (!status?.uv_installed) missing.push('uv package manager')
              if (!status?.repo_cloned) missing.push('engine files')
              if (!status?.dependencies_synced) missing.push('dependencies')
              const missingStr = missing.join(', ')
              handleServerError(new Error(`Engine not ready: missing ${missingStr}. Please reinstall in Settings.`))
              return
            }

            try {
              const readyPromise = waitForServerReady(
                () => cancelled,
                (fn) => {
                  unlisten = fn
                }
              )
              await startServer(STANDALONE_PORT)
              log.info('Server started, waiting for ready signal...')
              await readyPromise
              if (cancelled) return
            } catch (err) {
              if (cancelled) return
              handleServerError(err)
              return
            }
          }
        }
      }

      if (cancelled) return
      log.info('Connecting to WebSocket endpoint:', wsUrl)
      connect(wsUrl)
    }

    const waitForServerReady = (_isCancelled, setUnlisten) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Server startup timeout - check logs for errors'))
        }, 120000)

        listen('server-ready', () => {
          clearTimeout(timeout)
          log.info('Server ready signal received!')
          resolve()
        }).then(setUnlisten)
      })
    }

    const handleServerError = (err) => {
      const errorMsg = err?.message || String(err)
      log.error('Server error:', errorMsg)
      setEngineError(errorMsg)
      // Don't transition to cold immediately - wait for user to dismiss the error
    }

    connectToServer()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [
    state,
    states.WARM,
    states.COLD,
    endpointUrl,
    config.gpu_server,
    isStandaloneMode,
    connect,
    isServerRunning,
    startServer,
    checkEngineStatus,
    checkServerReady,
    checkPortInUse,
    transitionTo
  ])

  // State transitions
  useEffect(() => {
    if (state === states.WARM && hasReceivedFrame && canvasReady) {
      log.info('First frame received - transitioning to HOT')
      transitionTo(states.HOT)
    }
  }, [state, states.WARM, states.HOT, hasReceivedFrame, canvasReady, transitionTo])

  useEffect(() => {
    if (state === states.HOT && portalConnected && isReady) {
      log.info('Fully ready - transitioning to STREAMING')
      transitionTo(states.STREAMING)
    }
  }, [state, states.HOT, states.STREAMING, portalConnected, isReady, transitionTo])

  useEffect(() => {
    if (state === states.STREAMING && isReady && containerRef.current) {
      log.info('Auto-requesting pointer lock on stream start')
      containerRef.current.requestPointerLock()
    }
  }, [state, states.STREAMING, isReady])

  // Disconnect when leaving streaming states
  useEffect(() => {
    if (state !== states.WARM && state !== states.HOT && state !== states.STREAMING) {
      disconnect()
      exitPointerLock()
      setSettingsOpen(false)
      setIsPaused(false)
      setPausedAt(null)
    }
  }, [state, states.WARM, states.HOT, states.STREAMING, disconnect, exitPointerLock])

  // Handle connection errors during WARM state
  useEffect(() => {
    if (state === states.WARM && connectionState === 'connecting') {
      wasConnectingOrConnectedRef.current = true
    }

    if (state === states.WARM && wasConnectingOrConnectedRef.current) {
      if (connectionState === 'error' || connectionState === 'disconnected') {
        const isError = connectionState === 'error'
        log.error(isError ? 'Connection error during WARM state' : 'Connection lost during WARM state')
        setEngineError(
          error ||
            (isError ? 'Connection failed - server may have crashed' : 'Connection lost - server may have crashed')
        )
        wasConnectingOrConnectedRef.current = false
        // Don't transition to cold immediately - wait for user to dismiss the error
      }
    }
  }, [state, states.WARM, connectionState, error])

  // Transition to cold when user dismisses error
  useEffect(() => {
    if (engineError) {
      hadErrorRef.current = true
    } else if (hadErrorRef.current) {
      // Error was just cleared (dismissed) - now transition to cold
      hadErrorRef.current = false
      log.info('Error dismissed - transitioning to COLD')
      transitionTo(states.COLD)
    }
  }, [engineError, states.COLD, transitionTo])

  // Detect connection loss during HOT/STREAMING
  useEffect(() => {
    const isInConnectionState = state === states.HOT || state === states.STREAMING

    if (isInConnectionState && (connectionState === 'connecting' || connectionState === 'connected')) {
      wasConnectingOrConnectedRef.current = true
    }

    if (
      wasConnectingOrConnectedRef.current &&
      isInConnectionState &&
      (connectionState === 'disconnected' || connectionState === 'error')
    ) {
      log.info('Connection lost detected')
      setConnectionLost(true)
    }

    if (state === states.COLD) {
      wasConnectingOrConnectedRef.current = false
      setConnectionLost(false)
    }
  }, [connectionState, state, states.HOT, states.STREAMING, states.COLD])

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
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width
        canvas.height = img.height
      }
      ctx.drawImage(img, 0, 0)
    }
    img.src = `data:image/jpeg;base64,${frame}`
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
  const registerContainerRef = useCallback((element) => {
    containerRef.current = element
  }, [])
  const registerCanvasRef = useCallback((element) => {
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
    wasConnectingOrConnectedRef.current = false
    cleanupState()
    await stopServerIfRunning()
    await shutdown()
  }, [cleanupState, stopServerIfRunning, shutdown])

  const cancelConnection = useCallback(async () => {
    log.info('Cancelling connection')
    wasConnectingOrConnectedRef.current = false
    cleanupState()
    await stopServerIfRunning()
    transitionTo(states.COLD)
  }, [cleanupState, stopServerIfRunning, transitionTo, states.COLD])

  // Handle mode choice from the choice dialog (when user selects Standalone or Server)
  const handleModeChoice = useCallback(
    async (chosenMode) => {
      log.info('Mode choice made:', chosenMode)
      if (chosenMode === ENGINE_MODES.STANDALONE) {
        // Start installation immediately
        try {
          await setupEngine()
          log.info('Engine setup complete after mode choice')
          // Config was already saved by EngineModeChoice, just refresh
          await reloadConfig()
          // Auto-start session after successful installation
          log.info('Auto-starting session after engine setup')
          transitionTo(states.WARM)
        } catch (err) {
          log.error('Engine setup failed:', err)
          setEngineError(err.message || String(err))
        }
      }
      // For server mode, nothing special needed - config was already saved
    },
    [setupEngine, reloadConfig, transitionTo, states.WARM]
  )

  const value = {
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
    handleModeChoice,

    // Seeds
    openSeedsDir,
    seedsDir,

    // Settings
    mouseSensitivity,
    setMouseSensitivity,
    bottomPanelHidden,
    setBottomPanelHidden,

    // Input state
    pressedKeys,
    isPointerLocked,

    // Actions
    connect,
    disconnect,
    logout,
    dismissConnectionLost,
    cancelConnection,
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
