import type { EngineStatus } from '../types/app'
import type { StageId } from '../stages'
import type { TranslatableError } from '../i18n'
import type { ServerConnection } from '../hooks/useWebSocket'
import type { InputCode } from '../types/input'
import type { SceneEditState, SceneEditEvent } from './sceneEditMachine'

export type StreamingStats = {
  gentime: number
  rtt: number
}

export type StreamingContextValue = {
  connectionState: string
  connectionLost: boolean
  error: TranslatableError | null
  isConnected: boolean
  isVideoReady: boolean
  isReady: boolean
  isLoading: boolean
  isStreaming: boolean
  isPaused: boolean
  /** True when the user is actively driving the game (streaming + unpaused + no menu/modal).
   *  UI surfaces consult this to decide whether gamepad input goes to the game or to
   *  UI navigation. Inverse of `inputEnabled` in game terms. */
  isUIActive: boolean
  pausedAt: number | null
  canUnpause: boolean
  unlockDelayMs: number
  pauseElapsedMs: number
  settingsOpen: boolean
  sceneEditState: SceneEditState
  dispatchSceneEdit: (event: SceneEditEvent) => void
  statusStage: StageId | null
  isFreshInstall: boolean

  genTime: number | null
  latentGenMs: number | null
  temporalCompression: number
  frameId: number
  fps: number
  showStats: boolean
  setShowStats: (value: boolean) => void
  stats: StreamingStats
  connection: ServerConnection
  inputLatency: number | null
  performanceStatsOverlay: boolean
  inputOverlay: boolean
  frameTimelineOverlay: boolean
  frameTimelineRef: { current: { currentIndex: number; slotDisplayAts: (number | null)[] } }

  endpointUrl: string | null
  setEndpointUrl: (url: string | null) => void

  isServerRunning: boolean
  engineReady: boolean
  engineError: TranslatableError | null
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
  selectSeed: (filename: string) => Promise<void>
  wsRequest: <T = unknown>(type: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
  wsLogs: string[]
  wsAllLogs: string[]
  clearWsLogs: () => void

  mouseSensitivity: number
  setMouseSensitivity: (value: number) => void
  gamepadSensitivity: number
  setGamepadSensitivity: (value: number) => void
  /** Physical keyboard `InputCode`s currently held down (e.g. `'KeyW'`, `'ArrowUp'`). */
  pressedKeys: Set<InputCode>
  /** Physical mouse `InputCode`s currently held down (e.g. `'MouseLeft'`). */
  mouseButtons: Set<InputCode>
  /** Gamepad `InputCode`s currently held down (e.g. `'GamepadA'`, `'GamepadLeftStickUp'`). */
  pressedGamepad: Set<InputCode>
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
  resume: () => void
  requestPointerLock: () => boolean
  exitPointerLock: () => void
  registerContainerRef: (element: HTMLDivElement | null) => void
  registerCanvasRef: (element: HTMLCanvasElement | null) => void
  handleContainerClick: () => void
}
