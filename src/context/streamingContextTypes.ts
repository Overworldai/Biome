import type { EngineStatus } from '../types/app'
import type { StageId } from '../stages'
import type { TranslatableError } from '../i18n'
import type { ConnectionStatus, ServerConnection } from '../hooks/useWebSocket'
import type { LogRecord } from '../types/ipc'
import type { InputCode } from '../types/input'
import type { WsRequest } from '../lib/wsRpc'
import type { SceneEditState, SceneEditEvent } from './sceneEditMachine'

export type StreamingContextValue = {
  connectionStatus: ConnectionStatus
  /** Canonical user-visible error for the engine session: the sticky
   *  warm-flow / lifecycle error if one is set, otherwise the transport
   *  error from the connection union. Components that show error UI
   *  should read this; the underlying split is an internal detail. */
  error: TranslatableError | null
  connectionLost: boolean
  isVideoReady: boolean
  isStreaming: boolean
  /** True when the user is actively driving the game (streaming + unpaused + no menu/modal).
   *  UI surfaces consult this to decide whether gamepad input goes to the game or to
   *  UI navigation. Inverse of `inputEnabled` in game terms. */
  isUIActive: boolean
  /** Pause / scene-edit / menu lifecycle state for the active session. */
  session: {
    isPaused: boolean
    pausedAt: number | null
    pauseElapsedMs: number
    canUnpause: boolean
    unlockDelayMs: number
    settingsOpen: boolean
    sceneEdit: {
      state: SceneEditState
      dispatch: (event: SceneEditEvent) => void
    }
  }
  statusStage: StageId | null
  isFreshInstall: boolean

  /** Live frame-stream metrics. Refs are mutable cells consumed by the
   *  canvas-render loop and the timeline overlay. */
  frames: {
    id: number
    latentGenMs: number | null
    temporalCompression: number
    inputLatency: number | null
    timelineRef: { current: { currentIndex: number; slotDisplayAts: (number | null)[] } }
  }
  server: ServerConnection

  endpointUrl: string | null
  setEndpointUrl: (url: string | null) => void

  /** Local engine state + actions. Only meaningful in standalone mode;
   *  in server mode the fields are inert (status null, isReady/isRunning
   *  false, setup is a no-op). */
  engine: {
    status: EngineStatus | null
    /** UV installed + repo cloned + dependencies synced. */
    isReady: boolean
    /** Standalone Python server process is running. */
    isRunning: boolean
    serverLogPath: string | null
    check: () => Promise<EngineStatus | null>
    setup: {
      inProgress: boolean
      progress: string | null
      error: string | null
      /** Run install / sync from current state — fixes a partial setup. */
      run: (onStage?: (stageId: StageId) => void) => Promise<EngineStatus>
      /** Wipe the engine dir and re-run from scratch. */
      nukeAndReinstall: (onStage?: (stageId: StageId) => void) => Promise<EngineStatus>
      abort: () => Promise<string>
    }
  }

  openSeedsDir: () => Promise<void>
  seedsDir: string | null
  selectSeed: (filename: string) => Promise<void>
  wsRequest: WsRequest
  wsLogs: LogRecord[]
  wsAllLogs: LogRecord[]
  clearWsLogs: () => void

  /** Live input state (held inputs + pointer lock). */
  input: {
    /** Physical keyboard `InputCode`s currently held down (e.g. `'KeyW'`, `'ArrowUp'`). */
    pressedKeys: Set<InputCode>
    /** Physical mouse `InputCode`s currently held down (e.g. `'MouseLeft'`). */
    mouseButtons: Set<InputCode>
    /** Gamepad `InputCode`s currently held down (e.g. `'GamepadA'`, `'GamepadLeftStickUp'`). */
    pressedGamepad: Set<InputCode>
    scrollActive: { up: boolean; down: boolean }
    pointerLock: {
      isLocked: boolean
      /** Bumped when a pointer-lock request is denied by the browser
       *  cooldown; consumers watch this to play feedback sounds. */
      blockedSeq: number
      request: () => boolean
      exit: () => void
    }
  }

  connect: (endpointUrl: string) => void
  disconnect: () => void
  logout: () => Promise<void>
  dismissConnectionLost: () => Promise<void>
  reconnectAfterConnectionLost: () => Promise<void>
  cancelConnection: () => Promise<void>
  prepareReturnToMainMenu: () => Promise<void>
  resetScene: () => void
  registerContainerRef: (element: HTMLDivElement | null) => void
  registerCanvasRef: (element: HTMLCanvasElement | null) => void
  handleContainerClick: () => void
}
