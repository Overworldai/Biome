import type { MutableRefObject } from 'react'
import type { EngineStatus } from '../types/app'

export type StreamingStats = {
  gentime: number
  rtt: number
}

export type StreamingContextValue = {
  connectionState: string
  connectionLost: boolean
  error: string | null
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
  statusCode: string | null

  genTime: number | null
  frameId: number
  fps: number
  showStats: boolean
  setShowStats: (value: boolean) => void
  stats: StreamingStats

  sessionRemaining: null
  sessionExpired: boolean
  sessionTimeDisplay: null
  gpuAssignment: null
  setGpuAssignment: () => void
  endpointUrl: string | null
  setEndpointUrl: (url: string | null) => void

  isServerRunning: boolean
  engineReady: boolean
  engineError: string | null
  clearEngineError: () => void
  serverLogPath: string | null
  engineStatus: EngineStatus | null
  checkEngineStatus: () => Promise<EngineStatus | null>
  setupEngine: () => Promise<EngineStatus>
  engineSetupInProgress: boolean
  setupProgress: string | null
  engineSetupError: string | null

  openSeedsDir: () => Promise<void>
  seedsDir: string | null

  mouseSensitivity: number
  setMouseSensitivity: (value: number) => void
  pressedKeys: Set<string>
  isPointerLocked: boolean

  connect: (endpointUrl: string) => void
  disconnect: () => void
  logout: () => Promise<void>
  dismissConnectionLost: () => Promise<void>
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
  registerVideoRef: () => void
  handleContainerClick: () => void
}
