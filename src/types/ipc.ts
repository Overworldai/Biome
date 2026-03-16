import type { EngineStatus } from './app'
import type { Settings } from './settings'
import type { PortalSparksTuning } from '../lib/portalSparksTuning'

export type ModelAvailability = {
  id: string
  is_local: boolean
}

export type ModelInfo = {
  id: string
  size_bytes: number | null
  exists: boolean
  error: string | null
}

export type RuntimeDiagnosticsMeta = {
  app_name: string
  app_version: string
  commit_hash: string
  platform: string
  arch: string
  electron_version: string
  chrome_version: string
  node_version: string
  locale: string
  is_packaged: boolean
}

export type SystemDiagnostics = {
  platform: string
  release: string
  version: string
  arch: string
  uptime_seconds: number
  total_memory_bytes: number
  free_memory_bytes: number
  cpu_model: string
  cpu_cores: number
  gpu_feature_status: Record<string, string>
}

export type ExportDiagnosticsResult = {
  canceled: boolean
  file_path: string | null
}

export type AppUpdateInfo = {
  current_version: string
  latest_version: string
  release_url: string | null
  update_available: boolean
}

/**
 * Maps each IPC command channel to its argument tuple and return type.
 * This is the single source of truth for all invoke() calls.
 */
export type IpcCommandMap = {
  // Settings
  'read-settings': { args: []; return: Settings }
  'read-default-settings': { args: []; return: Settings }
  'write-settings': { args: [settings: Settings]; return: void }
  'get-settings-path-str': { args: []; return: string }
  'open-settings': { args: []; return: void }

  // Models
  'list-waypoint-models': { args: []; return: string[] }
  'list-model-availability': { args: [modelIds: string[]]; return: ModelAvailability[] }
  'get-models-info': { args: [modelIds: string[], serverUrl?: string]; return: ModelInfo[] }

  // Engine
  'check-engine-status': { args: [source?: string]; return: EngineStatus }
  'abort-engine-install': { args: []; return: string }
  'unpack-server-files': { args: [force: boolean]; return: string }
  'reinstall-engine': { args: []; return: string }
  'nuke-and-reinstall-engine': { args: []; return: string }

  // Server
  'start-engine-server': { args: [port: number]; return: string }
  'stop-engine-server': { args: []; return: string }
  'is-server-running': { args: []; return: boolean }
  'is-server-ready': { args: []; return: boolean }
  'is-port-in-use': { args: [port: number]; return: boolean }
  'probe-server-health': { args: [healthUrl: string, timeoutMs?: number]; return: boolean }

  // Seeds (filesystem ops only - seed data now goes over WS)
  'get-seeds-dir-path': { args: []; return: string }
  'open-seeds-dir': { args: []; return: void }
  'read-image-files': { args: [paths: string[]]; return: { name: string; base64: string; mimeType: string }[] }

  // Backgrounds
  'list-background-videos': { args: []; return: string[] }
  // Window
  'window-set-size': { args: [width: number, height: number]; return: void }
  'window-get-size': { args: []; return: { width: number; height: number } }
  'window-set-position': { args: [x: number, y: number]; return: void }
  'window-get-position': { args: []; return: { x: number; y: number } }
  'window-minimize': { args: []; return: void }
  'window-toggle-maximize': { args: []; return: void }
  'window-close': { args: []; return: void }
  'quit-app': { args: []; return: void }

  // Debug
  'write-spark-tuning': { args: [tuning: PortalSparksTuning]; return: void }
  'get-runtime-diagnostics-meta': { args: []; return: RuntimeDiagnosticsMeta }
  'get-system-diagnostics': { args: []; return: SystemDiagnostics }
  'export-loading-diagnostics': { args: [reportText: string]; return: ExportDiagnosticsResult }

  // Updates
  'check-for-app-update': { args: []; return: AppUpdateInfo }
}

/**
 * Maps each IPC event channel to the payload type emitted from main to renderer.
 */
export type IpcEventMap = {
  'server-ready': boolean
  'server-stage': { id: string; label: string; percent: number }
  'engine-log': { line: string; is_stderr: boolean }
  'window-resized': { width: number; height: number }
}
