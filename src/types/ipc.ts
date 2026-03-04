import type { AppConfig, EngineStatus } from './app'
import type { PortalSparksTuning } from '../lib/portalSparksTuning'

export type ModelAvailability = {
  id: string
  is_local: boolean
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

export type ExportDiagnosticsResult = {
  canceled: boolean
  file_path: string | null
}

/**
 * Maps each IPC command channel to its argument tuple and return type.
 * This is the single source of truth for all invoke() calls.
 */
export type IpcCommandMap = {
  // Config
  'read-config': { args: []; return: AppConfig }
  'read-default-config': { args: []; return: AppConfig }
  'write-config': { args: [config: AppConfig]; return: void }
  'get-config-path-str': { args: []; return: string }
  'open-config': { args: []; return: void }

  // Models
  'list-waypoint-models': { args: []; return: string[] }
  'list-local-waypoint-models': { args: []; return: string[] }
  'list-model-availability': { args: [modelIds: string[]]; return: ModelAvailability[] }

  // Engine
  'check-engine-status': { args: [source?: string]; return: EngineStatus }
  'install-uv': { args: []; return: string }
  'setup-server-components': { args: []; return: string }
  'sync-engine-dependencies': { args: []; return: string }
  'setup-engine': { args: []; return: string }
  'unpack-server-files': { args: [force: boolean]; return: string }
  'get-engine-dir-path': { args: []; return: string }
  'open-engine-dir': { args: []; return: void }

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

  // Backgrounds
  'list-background-images': { args: []; return: string[] }
  'read-background-image-as-base64': { args: [filename: string]; return: string }
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
  'export-loading-diagnostics': { args: [reportText: string]; return: ExportDiagnosticsResult }
}

/**
 * Maps each IPC event channel to the payload type emitted from main to renderer.
 */
export type IpcEventMap = {
  'server-log': string
  'server-ready': boolean
  'server-stage': { id: string; label: string; percent: number }
  'window-resized': { width: number; height: number }
}
