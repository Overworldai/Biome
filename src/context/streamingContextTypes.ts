import type { EngineStatus } from '../types/app'
import type { StageId } from '../stages'
import type { ServerMetrics } from '../hooks/useWebSocket'

export type StreamingStats = {
  gentime: number
  rtt: number
}

export type StreamingContextValue = {
  connectionState: string
  connectionLost: boolean
  error: string | null
  warning: string | null
  isConnected: boolean
  isVideoReady: boolean
  isReady: boolean
  isLoading: boolean
  isStreaming: boolean
  isPaused: boolean
  pausedAt: number | null
  canUnpause: boolean
  unlockDelayMs: number
  pauseElapsedMs: number
  settingsOpen: boolean
  statusStage: StageId | null
  isFreshInstall: boolean

  genTime: number | null
  latentGenMs: number | null
  frameId: number
  fps: number
  showStats: boolean
  setShowStats: (value: boolean) => void
  stats: StreamingStats
  serverMetrics: ServerMetrics | null
  inputLatency: number | null
  performanceStatsOverlay: boolean
  inputOverlay: boolean
  frameTimelineOverlay: boolean
  frameTimelineRef: { current: { currentIndex: number; slotDisplayAts: (number | null)[] } }

  endpointUrl: string | null
  setEndpointUrl: (url: string | null) => void

  isServerRunning: boolean
  engineReady: boolean
  engineError: string | null
  clearEngineError: () => void
  serverLogPath: string | null
  engineStatus: EngineStatus | null
  checkEngineStatus: () => Promise<EngineStatus | null>
  setupEngine: (onStage?: (stageId: StageId) => void) => Promise<EngineStatus>
  nukeAndReinstallEngine: (onStage?: (stageId: StageId) => void) => Promise<EngineStatus>
  abortEngineSetup: () => Promise<string>
  engineSetupInProgress: boolean
  setupProgress: string | null
  engineSetupError: string | null

  openSeedsDir: () => Promise<void>
  seedsDir: string | null
  wsRequest: <T = unknown>(type: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
  wsLogs: string[]
  wsAllLogs: string[]
  clearWsLogs: () => void

  mouseSensitivity: number
  setMouseSensitivity: (value: number) => void
  pressedKeys: Set<string>
  mouseButtons: Set<string>
  scrollActive: { up: boolean; down: boolean }
  isPointerLocked: boolean
  pointerLockBlockedSeq: number

  connect: (endpointUrl: string) => void
  disconnect: () => void
  logout: () => Promise<void>
  dismissConnectionLost: () => Promise<void>
  reconnectAfterConnectionLost: () => Promise<void>
  cancelConnection: () => Promise<void>
  prepareReturnToMainMenu: () => Promise<void>
  reset: () => void
  sendPrompt: (prompt: string) => void
  sendPromptWithSeed: (promptOrFilename: string, maybeSeedUrl?: string) => void
  sendInitialSeed: (filename: string) => void
  requestPointerLock: () => boolean
  exitPointerLock: () => void
  registerContainerRef: (element: HTMLDivElement | null) => void
  registerCanvasRef: (element: HTMLCanvasElement | null) => void
  handleContainerClick: () => void
}
