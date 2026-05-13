import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react'
import { usePortal } from '../portal/portalContextValue'
import { TranslatableError } from '../../i18n'
import useWebSocket, {
  isConnected as wsIsConnected,
  isReady as wsIsReady,
  connectionError as wsConnectionError
} from '../../hooks/engine/useWebSocket'
import { useSettings } from '../../hooks/settings/settingsContextValue'
import { useEngineLifecycle } from '../engineLifecycle/engineLifecycleContextValue'
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
import { useClampedSettings } from '../../hooks/streaming/useClampedSettings'
import { useSessionInit } from '../../hooks/streaming/useSessionInit'
import { useStreamingLifecycle } from '../../hooks/streaming/useStreamingLifecycle'
import { useWarmConnection } from '../../hooks/streaming/useWarmConnection'
import { getSessionSignature } from '../../utils/settingsClassifier'
import type { ServerCapabilities } from '../../types/ipc'
import type { ConnectionContextValue } from './connection'
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

  const { settings: rawSettings, isStandaloneMode, saveSettings } = useSettings()
  const lifecycle = useEngineLifecycle()
  const { check: checkEngineStatus, probeServerHealth, restartServer } = lifecycle
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
  // Server-reported capability matrix. Populated by the URL-validation
  // probe in the settings panel and by the warm-flow probe before each
  // session starts, so the backend / quant dropdowns filter against
  // what the active server can actually run. Null until the first
  // probe completes — dropdowns disable themselves in that window.
  const [serverCapabilities, setServerCapabilities] = useState<ServerCapabilities | null>(null)

  // Saved settings clamped against the server's matrix. Every consumer
  // inside this provider reads `settings` (the effective view) rather
  // than `rawSettings` so the wire config, the lifecycle signatures,
  // and the persisted-on-disk values all see the same `engine_backend`
  // / `engine_quant`. The hook also writes the clamped values back to
  // disk on first divergence so menu opens don't keep surfacing the
  // delta as a no-op restart prompt.
  const settings = useClampedSettings(rawSettings, serverCapabilities, saveSettings)

  const {
    preConnectionStage,
    run: runWarmConnection,
    cancel: cancelWarmFlow,
    isCancelled: isWarmFlowCancelled
  } = useWarmConnection({
    statusStage,
    isStandaloneMode,
    offlineMode: settings.offline_mode ?? false,
    serverUrl: settings.server_url,
    engine: {
      probeServerHealth,
      checkStatus: checkEngineStatus
    },
    ensureReady: lifecycle.ensureReady,
    connect,
    clearWsLogs,
    onServerError: setEngineError,
    onServerHealth: (result) => setServerCapabilities(result.capabilities ?? null)
  })

  // Loading-screen "First-time setup, takes 10-30 minutes" overlay flag.
  // True while the lifecycle is mid-prepare — TerminalDisplay only mounts
  // during the LOADING portal state, which the user reaches by clicking
  // Launch, so a `preparing` state observed there means warm-connect's
  // `ensureReady` triggered a reinstall. Initial-mount preparing happens
  // before the user can click Launch and so never lands in TerminalDisplay.
  const isFreshInstall = lifecycle.state.kind === 'preparing'

  const effectiveStatusStage = useMemo(() => statusStage ?? preConnectionStage, [statusStage, preConnectionStage])

  const hasReceivedFrame = frame !== null
  const isStreaming = state === states.STREAMING
  const inputEnabled = isStreaming && isReady && !isPaused && !settingsOpen && !connectionLost && !sceneEdit.isActive

  // Refresh engine status on mount and whenever the user returns to
  // the main menu in standalone mode. The lifecycle's auto-recovery
  // effect compares `state.kind === 'ready'` against
  // `engine.isServerRunning`; that comparison is only meaningful if
  // `isServerRunning` is fresh, so we re-poll at the natural points
  // where the user might next interact with settings or click Launch.
  useEffect(() => {
    if (!isStandaloneMode) return
    if (state !== states.MAIN_MENU) return
    void checkEngineStatus()
  }, [isStandaloneMode, state, states.MAIN_MENU, checkEngineStatus])

  useEngineRespawn({
    settings,
    portalState: state,
    mainMenuState: states.MAIN_MENU,
    loadingState: states.LOADING,
    isStandaloneMode,
    disconnect,
    restartServer,
    setEngineError,
    transitionTo
  })

  // Resolve local seeds dir path on mount (does not require server availability)
  useEffect(() => {
    getSeedsDirPath().catch((err) => {
      log.error('Failed to resolve seeds directory path:', err)
    })
  }, [getSeedsDirPath])

  const { selectSeed, lastApplied, resetSession } = useSessionInit({
    portalState: state,
    loadingState: states.LOADING,
    isConnected: wsIsConnected(connectionStatus),
    isStreaming,
    isStandaloneMode,
    settings,
    engineError,
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
    runWarmConnection
  })

  // Clear `engineError` when a session-class setting changes while the
  // engine-error overlay is up: the user is acting on the error and
  // their save is implicit consent to retry. Bootstrap re-fires
  // (engineError → null is a dep change in `useSessionInit`) against
  // the still-warm server that `useLoadingFailureCleanup` cycled
  // underneath. No-op when no error is in flight — same signature
  // change in normal streaming flows through the lifecycle reducer's
  // intentional-reconnect path instead.
  const sessionSig = useMemo(() => getSessionSignature(settings), [settings])
  const prevSessionSigRef = useRef(sessionSig)
  useEffect(() => {
    if (prevSessionSigRef.current === sessionSig) return
    prevSessionSigRef.current = sessionSig
    if (engineError) {
      log.info('Session settings changed with engine-error overlay up - clearing for retry')
      setEngineError(null)
    }
  }, [sessionSig, engineError])

  const resume = useCallback(() => {
    setSettingsOpen(false)
    resumeSession()
    sendPause(false)
  }, [sendPause, resumeSession])

  useStreamingLifecycle({
    portalState: state,
    connectionStatus,
    settings,
    lastApplied,
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
      cancelWarmFlow,
      disconnect,
      exitPointerLock,
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
      serverCapabilities,
      setServerCapabilities,
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
      serverCapabilities,
      setServerCapabilities,
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
