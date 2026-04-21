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
import { TranslatableError } from '../i18n'
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
import { invoke } from '../bridge'
import { createLogger } from '../utils/logger'
import type { StreamingContextValue } from './streamingContextTypes'
import { initialSceneEditState, sceneEditReducer } from './sceneEditMachine'

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
    frame,
    frameId,
    genTime,
    latentGenMs,
    temporalCompression,
    frameGenMsRef,
    frameTemporalCompressionRef,
    frameIdRef,
    connection,
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
  const [sceneEditState, dispatchSceneEdit] = useReducer(sceneEditReducer, initialSceneEditState)
  const sceneEditActive = sceneEditState.phase !== 'inactive'
  const [sceneEditGrace, setSceneEditGrace] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [mouseSensitivity, setMouseSensitivity] = useState(() => settings.mouse_sensitivity ?? 1.0)
  const [gamepadSensitivity, setGamepadSensitivity] = useState(() => settings.gamepad_sensitivity ?? 1.0)
  const [fps, setFps] = useState(0)
  const [connectionLost, setConnectionLost] = useState(false)
  const [engineError, setEngineError] = useState<TranslatableError | null>(null)
  const [endpointUrl, setEndpointUrl] = useState<string | null>(null)
  const [canvasReady, setCanvasReady] = useState(false)
  const [loadingConnectionJobSeq, setLoadingConnectionJobSeq] = useState(0)
  const [pointerLockBlockedSeq, setPointerLockBlockedSeq] = useState(0)
  const [preConnectionStage, setPreConnectionStage] = useState<StageId | null>(null)
  const [isFreshInstall, setIsFreshInstall] = useState(false)
  const [lifecycleState, dispatchLifecycle] = useReducer(streamingLifecycleReducer, initialStreamingLifecycleState)

  const [scrollActive, setScrollActive] = useState({ up: false, down: false })
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const prevEngineModeRef = useRef(engineMode)
  const frameCountRef = useRef(0)
  const lastFpsUpdateRef = useRef(performance.now())
  const inputLoopRef = useRef<number | null>(null)
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
  const canUnpause = pauseElapsedMs >= UNLOCK_DELAY_MS

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
      lastAppliedModelRef.current = settings.experimental?.scene_edit_enabled
        ? `${selectedModel}+scene_edit+${quant}`
        : `${selectedModel}+${quant}`

      const metrics = await sendInit({
        model: selectedModel,
        seed_image_data: imageData,
        seed_filename: seedFilename,
        scene_edit: settings.experimental?.scene_edit_enabled ?? false,
        action_logging: settings.debug_overlays?.action_logging ?? false,
        quant: quant !== 'none' ? quant : null,
        cap_inference_fps: settings.cap_inference_fps ?? true
      })
      applyInitResponse(metrics)
    }

    bootstrap().catch((err) => log.error('Bootstrap failed:', err))
  }, [
    state,
    states.LOADING,
    isConnected,
    settings?.engine_model,
    settings?.engine_quant,
    settings?.cap_inference_fps,
    settings.experimental?.scene_edit_enabled,
    settings.debug_overlays?.action_logging,
    sendInit,
    applyInitResponse,
    setPlaceholderFrame
  ])

  useEffect(() => {
    if (!isConnected) {
      warmBootstrapSentRef.current = false
      setPlaceholderFrame(null)
    }
  }, [isConnected, setPlaceholderFrame])

  // Live-toggle action logging during streaming without a full re-bootstrap
  useEffect(() => {
    if (!isStreaming || !isConnected) return
    sendInit({ action_logging: settings.debug_overlays?.action_logging ?? false }).catch((err) =>
      log.error('Failed to toggle action logging:', err)
    )
  }, [isStreaming, isConnected, settings.debug_overlays?.action_logging, sendInit])

  // Live-toggle inference FPS cap during streaming without a full re-bootstrap
  useEffect(() => {
    if (!isStreaming || !isConnected) return
    sendInit({ cap_inference_fps: settings.cap_inference_fps ?? true }).catch((err) =>
      log.error('Failed to toggle inference FPS cap:', err)
    )
  }, [isStreaming, isConnected, settings.cap_inference_fps, sendInit])

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

  const handleSceneEdit = useCallback(() => {
    exitPointerLock()
    dispatchSceneEdit({ type: 'OPEN' })
  }, [exitPointerLock])

  const { pressedKeys, mouseButtons, pressedGamepad, getInputState, isPointerLocked } = useGameInput(
    inputEnabled,
    containerRef,
    handleReset,
    settings.keybindings,
    settings.experimental?.scene_edit_enabled ? handleSceneEdit : null,
    exitPointerLock
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
        // Init is considered complete once applyInitResponse has set model.
        // Used to gate the LOADING → STREAMING transition so an error between
        // session.ready and the init response doesn't leak us into streaming.
        initCompleted: connection.model !== null,
        isPointerLocked,
        settingsOpen,
        isPaused,
        sceneEditActive: sceneEditGrace,
        sceneEditEnabled: settings.experimental?.scene_edit_enabled,
        engineQuant: settings.engine_quant
      })
    })
  }, [
    state,
    connectionState,
    error,
    settings?.engine_model,
    settings?.engine_quant,
    settings.experimental?.scene_edit_enabled,
    engineError,
    hasReceivedFrame,
    isReady,
    connection.model,
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
      onFreshInstall: (isFresh) => {
        if (!warmFlowCancelledRef.current) setIsFreshInstall(isFresh)
      },
      isCancelled: () => warmFlowCancelledRef.current,
      log
    }).catch((err) => {
      if (warmFlowCancelledRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      handleServerError(
        err instanceof TranslatableError ? err : new TranslatableError('app.server.fallbackError', { message })
      )
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

  const resume = useCallback(() => {
    setSettingsOpen(false)
    setIsPaused(false)
    setPausedAt(null)
    sendPause(false)
  }, [sendPause])

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
      sendPause,
      resume
    })

    runStreamingLifecycleEffects({ effects, handlers })
  }, [lifecycleState, transitionTo, states, disconnect, settings, exitPointerLock, sendPause, resume])

  // Render frames to canvas using createImageBitmap for off-main-thread decoding.
  // Decoded bitmaps are queued with a target displayAt timestamp so multiframe
  // bundles are spread evenly across the generation interval regardless of display
  // refresh rate (avoids front-loading 4 frames at 144 Hz then stalling).
  const bitmapQueueRef = useRef<{ bitmap: ImageBitmap; displayAt: number; frameId: number; genMs: number }[]>([])
  const lastScheduledAtRef = useRef<number>(0)
  // Batch-relative timeline for the frame timeline overlay.
  // slotDisplayAts[i] holds the actual scheduled displayAt for each frame in the
  // current 4-frame bundle. Updated when bitmaps are ready (not at effect time),
  // so values are always based on real decode completion times.
  const frameTimelineRef = useRef<{ currentIndex: number; slotDisplayAts: (number | null)[] }>({
    currentIndex: 0,
    slotDisplayAts: []
  })
  const drawRafRef = useRef<number | null>(null)

  // rAF draw loop: draws the next bitmap only once its scheduled time has arrived
  useEffect(() => {
    if (!canvasReady || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawTick = () => {
      const now = performance.now()
      // Defense-in-depth: if the queue has grown well beyond one batch worth
      // of lead (e.g. rAF was paused while the window was backgrounded), drop
      // the oldest bitmaps and snap the scheduling cursor back to now so new
      // frames display live instead of replaying stale history.
      const tc = frameTemporalCompressionRef.current
      const maxQueue = Math.max(tc * 2, 8)
      if (bitmapQueueRef.current.length > maxQueue) {
        const keep = Math.max(tc, 4)
        const dropCount = bitmapQueueRef.current.length - keep
        for (let i = 0; i < dropCount; i++) {
          bitmapQueueRef.current.shift()!.bitmap.close()
        }
        lastScheduledAtRef.current = 0
      }
      const item = bitmapQueueRef.current[0]
      if (item && now >= item.displayAt) {
        bitmapQueueRef.current.shift()
        frameTimelineRef.current.currentIndex = item.frameId % frameTemporalCompressionRef.current
        frameCountRef.current++
        if (now - lastFpsUpdateRef.current >= 1000) {
          setFps(frameCountRef.current)
          frameCountRef.current = 0
          lastFpsUpdateRef.current = now
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(item.bitmap, 0, 0, canvas.width, canvas.height)
        item.bitmap.close()
      }
      drawRafRef.current = requestAnimationFrame(drawTick)
    }
    drawRafRef.current = requestAnimationFrame(drawTick)

    return () => {
      if (drawRafRef.current !== null) cancelAnimationFrame(drawRafRef.current)
      for (const item of bitmapQueueRef.current) item.bitmap.close()
      bitmapQueueRef.current = []
      lastScheduledAtRef.current = 0
    }
  }, [canvasReady, frameTemporalCompressionRef])

  // Decode incoming frames off-thread and push to the draw queue.
  // displayAt is computed inside the .then() callback — i.e. once the bitmap is
  // actually ready — so that if all 4 decodes finish simultaneously the
  // lastScheduledAtRef chain still spaces them correctly, and no frame is
  // scheduled in the past just because decode was slow.
  useEffect(() => {
    if (!frame || !canvasReady) return

    const temporalCompression = frameTemporalCompressionRef.current
    const genMs = frameGenMsRef.current / temporalCompression
    const capturedFrameId = frameIdRef.current

    const source =
      frame instanceof Blob
        ? Promise.resolve(frame)
        : fetch(frame.startsWith('data:') ? frame : `data:image/jpeg;base64,${frame}`).then((r) => r.blob())

    source
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        const now = performance.now()
        // Display immediately when the queue is caught up (first frame of a new
        // batch), otherwise chain after the previously reserved slot.  The slot
        // reservation (lastScheduledAtRef) always advances by genMs so that
        // subsequent frames in the same batch are evenly spaced.
        //
        // Cap the forward lead: if the server bursts frames faster than the
        // reported genMs (warmup, model switch, backgrounded window) the cursor
        // can drift far into the future and latency accumulates without bound
        // (Overworldai/Biome#79).  Allow up to ~2 batches of lead, so intra-
        // batch spacing still works, but snap back if we overshoot.
        const batchMs = Math.max(temporalCompression * genMs, 16)
        const maxLeadMs = Math.max(2 * batchMs, 100)
        const cappedBase = Math.min(lastScheduledAtRef.current, now + maxLeadMs)
        const displayAt = Math.max(cappedBase, now)
        lastScheduledAtRef.current = displayAt + genMs

        const batchIndex = capturedFrameId % temporalCompression
        if (batchIndex === 0) {
          frameTimelineRef.current.slotDisplayAts = Array.from({ length: temporalCompression }, () => null)
        }
        frameTimelineRef.current.slotDisplayAts[batchIndex] = displayAt

        bitmapQueueRef.current.push({ bitmap, displayAt, frameId: capturedFrameId, genMs })
      })
      .catch(() => {})
  }, [frame, canvasReady, frameGenMsRef, frameIdRef, frameTemporalCompressionRef])

  // Input loop synced to requestAnimationFrame for minimal jitter
  useEffect(() => {
    if (!inputEnabled) {
      if (inputLoopRef.current) {
        cancelAnimationFrame(inputLoopRef.current)
        inputLoopRef.current = null
      }
      return
    }

    const tick = () => {
      const { buttons, mouse, gamepad } = getInputState()
      const scrollUp = buttons.includes('SCROLL_UP')
      const scrollDown = buttons.includes('SCROLL_DOWN')
      if (scrollUp || scrollDown) {
        setScrollActive({ up: scrollUp, down: scrollDown })
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = setTimeout(() => setScrollActive({ up: false, down: false }), 150)
      }
      const dx = mouse.dx * mouseSensitivity + gamepad.dx * gamepadSensitivity
      const dy = mouse.dy * mouseSensitivity + gamepad.dy * gamepadSensitivity
      sendControl(buttons, Math.round(dx), Math.round(dy))
      inputLoopRef.current = requestAnimationFrame(tick)
    }
    inputLoopRef.current = requestAnimationFrame(tick)

    return () => {
      if (inputLoopRef.current) {
        cancelAnimationFrame(inputLoopRef.current)
        inputLoopRef.current = null
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = null
      }
    }
  }, [inputEnabled, getInputState, sendControl, mouseSensitivity, gamepadSensitivity])

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

  const selectSeed = useCallback(
    async (filename: string) => {
      const result = await invoke('get-seed-image-base64', filename)
      if (!result) return
      lastSeedRef.current = { filename, imageData: result.base64 }
      const metrics = await sendInit({ seed_image_data: result.base64, seed_filename: filename })
      applyInitResponse(metrics)
    },
    [sendInit, applyInitResponse]
  )

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
    isUIActive: !inputEnabled,
    pausedAt,
    canUnpause,
    unlockDelayMs: UNLOCK_DELAY_MS,
    pauseElapsedMs,
    settingsOpen,
    sceneEditState,
    dispatchSceneEdit,
    statusStage: effectiveStatusStage,
    isFreshInstall,

    // Stats
    genTime,
    latentGenMs,
    temporalCompression,
    frameId,
    fps,
    stats: {
      gentime: genTime ?? 0,
      rtt: 0
    },
    showStats,
    setShowStats,
    connection,
    inputLatency,
    performanceStatsOverlay: settings.debug_overlays.performance_stats,
    inputOverlay: settings.debug_overlays.input,
    frameTimelineOverlay: settings.debug_overlays.frame_timeline,
    frameTimelineRef,

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
    selectSeed,

    // WS RPC
    wsRequest,
    wsLogs,
    wsAllLogs,
    clearWsLogs,

    // Settings
    mouseSensitivity,
    setMouseSensitivity,
    gamepadSensitivity,
    setGamepadSensitivity,

    // Input state
    pressedKeys,
    mouseButtons,
    pressedGamepad,
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
    resume,
    requestPointerLock,
    exitPointerLock,
    registerContainerRef,
    registerCanvasRef,
    handleContainerClick
  }

  return <StreamingContext.Provider value={value}>{children}</StreamingContext.Provider>
}

export default StreamingContext
