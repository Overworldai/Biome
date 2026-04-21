import type { EngineStatus, SeedFileRecord } from './app'
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
  gpu: string | null
  gpu_feature_status: Record<string, string>
}

// ============================================================================
// Diagnostics payload — the JSON blob copied to clipboard / attached to
// GitHub issues via "Copy Report" / "Report on GitHub".
//
// Built in TerminalDisplay (loading/streaming errors) and EngineInstallModal
// (engine install errors).  Every field should be self-explanatory to
// someone triaging a bug report with no Biome source access.
// ============================================================================

/** Biome app build identity.  Useful for verifying the build is correct
 *  (e.g. CI produced the wrong version) and for reproducing with the
 *  exact same binary. */
export type DiagnosticsApp = {
  /** Semantic version from package.json. */
  version: string
  /** Full git commit hash of this build. */
  commit: string
  /** true = production installer build; false = local dev (`npm run dev`). */
  packaged: boolean
  /** Electron framework version (e.g. "35.7.5"). */
  electron: string
  /** Chromium version embedded in this Electron build. */
  chrome: string
  /** Node.js version embedded in this Electron build. */
  node: string
  /** BCP 47 locale the app is running in (e.g. "en-GB", "ja"). */
  locale: string
}

/** The machine running the Biome desktop app (Electron renderer).
 *  In server mode this is NOT the machine running the World Engine —
 *  see {@link DiagnosticsServer} for that. */
export type DiagnosticsClient = {
  /** Platform identifier: "linux", "win32", or "darwin". */
  os: string
  /** OS kernel / release version (e.g. "6.12.80", "10.0.22631"). */
  os_version: string
  /** CPU architecture: "x64" or "arm64". */
  arch: string
  /** CPU model string from the OS (e.g. "AMD Ryzen 9 9950X3D"). */
  cpu: string
  /** Number of logical CPU cores. */
  cpu_cores: number
  /** Rendering GPU device name from Chromium (e.g. "NVIDIA GeForce RTX 5090").
   *  This is the GPU used for compositing the Electron window — it may differ
   *  from the CUDA GPU in multi-GPU setups.  null if unavailable. */
  gpu: string | null
  /** Total physical RAM in bytes. */
  ram_total_bytes: number
  /** Free RAM in bytes at the time the report was generated. */
  ram_free_bytes: number
  /** System uptime in seconds.  Long uptimes may correlate with stale
   *  driver state or resource exhaustion. */
  uptime_seconds: number
  /** Chromium GPU compositing feature flags (e.g. webgl, vulkan, rasterization).
   *  Indicates whether the Electron renderer is using hardware acceleration;
   *  software fallback here can cause UI rendering issues unrelated to CUDA. */
  gpu_compositing: Record<string, string>
}

/** The machine running the World Engine server (Python / CUDA).
 *  Same physical machine as the client in standalone mode; a remote host
 *  in server mode.  null in the payload if the server was never reached
 *  (e.g. engine install failure, server didn't start). */
export type DiagnosticsServer = {
  /** CPU model string reported by py-cpuinfo on the server host. */
  cpu: string | null
  /** CUDA GPU device name (e.g. "NVIDIA GeForce RTX 5090"). */
  gpu: string | null
  /** Number of CUDA-visible GPU devices.  0 if unknown (server never reached). */
  gpu_count: number
  /** Total VRAM on device 0 in bytes. */
  vram_total_bytes: number | null
  /** CUDA toolkit version (e.g. "12.8"). */
  cuda: string | null
  /** NVIDIA driver version (e.g. "580.142"). */
  driver: string | null
  /** PyTorch version including CUDA suffix (e.g. "2.10.0+cu128"). */
  torch: string | null
}

/** What the user was trying to do when the error occurred. */
export type DiagnosticsSession = {
  /** "standalone" = local server managed by Biome; "server" = remote server. */
  engine_mode: 'standalone' | 'server'
  /** Model the client asked the server to load (from settings). */
  requested_model: string | null
  /** Quantisation the client asked for (e.g. "int8", or null for default). */
  requested_quant: string | null
  /** Model the server confirmed loading (from init RPC response).
   *  null if init never completed (crash during warmup). */
  confirmed_model: string | null
  /** Target inference FPS reported by the server, or null if init
   *  never completed. */
  inference_fps: number | null
}

/** What went wrong. */
export type DiagnosticsError = {
  /** Human-readable error message (localised). */
  message: string | null
  /** Loading stage ID at the time of the error (e.g. "session.ready"),
   *  or null if the error happened outside the loading flow. */
  stage?: string | null
  /** Loading progress 0–100 at the time of the error. */
  progress_percent?: number
  /** WebSocket connection state at the time the report was generated. */
  connection_state?: string
  /** Whether an engine install was still in progress when the error occurred. */
  in_progress?: boolean
}

/** Ephemeral server state captured at the moment the error was emitted.
 *  Populated from the server's error-push snapshot (graceful errors) merged
 *  with the last-known frame-header metrics (fallback for ungraceful crashes
 *  like SIGKILL / segfault).  null if neither source has data (e.g. crash
 *  during warmup before any frames were generated, with no graceful error). */
export type DiagnosticsStateAtError = {
  /** Server Python process resident set size in bytes (from psutil). */
  process_rss_bytes: number | null
  /** Host RAM in use in bytes at error time (from psutil). */
  ram_used_bytes: number | null
  /** VRAM allocated by torch on device 0 in bytes. */
  vram_used_bytes: number | null
  /** VRAM held by torch's caching allocator (allocated + cached) in bytes. */
  vram_reserved_bytes: number | null
  /** GPU utilization 0–100 at error time. */
  gpu_util_percent: number | null
}

/** Top-level diagnostics payload copied to clipboard / attached to GitHub
 *  issues.  Built by TerminalDisplay (loading/streaming errors) and
 *  EngineInstallModal (engine install errors). */
export type DiagnosticsPayload = {
  /** ISO 8601 timestamp of when this report was generated. */
  generated_at: string
  /** Biome app build identity. */
  app: DiagnosticsApp
  /** The machine running the Biome desktop app. */
  client: DiagnosticsClient
  /** The machine running the World Engine server, or null if never reached. */
  server: DiagnosticsServer | null
  /** What the user was doing — present for loading/streaming errors. */
  session?: DiagnosticsSession
  /** What went wrong. */
  error: DiagnosticsError
  /** Server resource state at the moment of error, or null if unavailable. */
  state_at_error?: DiagnosticsStateAtError | null
  /** Tail of the server/engine log, most recent last. */
  logs: string[]
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

/** Semantic session state parsed from a recording's MP4 `comment` atom.
 *  Matches the dataclass in server-components/video_recorder.py. All fields
 *  optional on the renderer side because older files may lack the atom or
 *  its contents may be malformed. */
export type RecordingProperties = {
  biome_version?: string
  model?: string | null
  quant?: string
  seed?: string | null
  scene_edit_enabled?: boolean
}

export type RecordingEntry = {
  filename: string
  path: string
  size_bytes: number
  mtime_ms: number
  properties: RecordingProperties | null
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
  'delete-cached-model': { args: [modelId: string]; return: void }

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

  // Seeds
  'list-seeds': { args: []; return: SeedFileRecord[] }
  'get-seed-image-base64': { args: [filename: string]; return: { base64: string } }
  'get-seed-thumbnail-base64': { args: [filename: string]; return: string }
  'upload-seed': { args: [filename: string, base64: string]; return: SeedFileRecord }
  'delete-seed': { args: [filename: string]; return: void }
  'get-seeds-dir-path': { args: []; return: string }
  'open-seeds-dir': { args: []; return: void }
  'read-image-files': { args: [paths: string[]]; return: { name: string; base64: string; mimeType: string }[] }

  // Backgrounds
  'list-background-videos': { args: []; return: string[] }
  // Window
  'renderer-ready': { args: []; return: void }
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

  // Recordings
  'get-default-video-dir': { args: []; return: string }
  'resolve-video-dir': { args: [configured: string]; return: string }
  'pick-video-dir': { args: [currentValue: string]; return: string | null }
  'list-recordings': { args: [configured: string]; return: RecordingEntry[] }
  'delete-recording': { args: [filePath: string]; return: void }
  'open-recording-externally': { args: [filePath: string]; return: void }
  'open-recordings-folder': { args: [configured: string]; return: void }
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
