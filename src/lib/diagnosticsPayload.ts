/**
 * Diagnostics payload builder.
 *
 * Constructs the JSON blob copied to clipboard / attached to GitHub issues
 * via "Copy Report" / "Report on GitHub".  Used by TerminalDisplay (loading
 * and streaming errors) and EngineInstallModal (engine install errors).
 *
 * Centralised here so the payload shape is defined once, strongly typed,
 * and reusable from any error surface.
 */

import { invoke } from '../bridge'
import type { ServerConnection } from '../hooks/useWebSocket'
import type {
  DiagnosticsApp,
  DiagnosticsClient,
  DiagnosticsError,
  DiagnosticsPayload,
  DiagnosticsServer,
  DiagnosticsSession,
  DiagnosticsStateAtError
} from '../types/ipc'

// ---------------------------------------------------------------------------
// Options accepted by the builder
// ---------------------------------------------------------------------------

export type BuildDiagnosticsOptions = {
  /** Current server connection state (system info, runtime metrics, error
   *  snapshot).  The single source of truth for everything server-side. */
  connection: ServerConnection

  /** What went wrong. */
  error: DiagnosticsError

  /** Tail of the server/engine log, most recent last. */
  logs: string[]

  /** Session context — present for loading/streaming errors where the user
   *  was actively trying to run a model.  Omitted for install-time errors
   *  where no session was ever established. */
  session?: {
    engineMode: 'standalone' | 'server'
    requestedModel: string | null
    requestedQuant: string | null
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildApp(meta: Awaited<ReturnType<typeof fetchMeta>>): DiagnosticsApp {
  return {
    version: meta.app_version,
    commit: meta.commit_hash,
    packaged: meta.is_packaged,
    electron: meta.electron_version,
    chrome: meta.chrome_version,
    node: meta.node_version,
    locale: meta.locale
  }
}

function buildClient(
  meta: Awaited<ReturnType<typeof fetchMeta>>,
  sys: Awaited<ReturnType<typeof fetchSys>>
): DiagnosticsClient {
  return {
    os: meta.platform,
    os_version: sys.release,
    arch: meta.arch,
    cpu: sys.cpu_model,
    cpu_cores: sys.cpu_cores,
    gpu: sys.gpu,
    ram_total_bytes: sys.total_memory_bytes,
    ram_free_bytes: sys.free_memory_bytes,
    uptime_seconds: sys.uptime_seconds,
    gpu_compositing: sys.gpu_feature_status
  }
}

function buildServer(connection: ServerConnection): DiagnosticsServer | null {
  const si = connection.systemInfo
  if (!si) return null
  return {
    cpu: si.cpu_name ?? null,
    gpu: si.gpu_name ?? null,
    gpu_count: si.gpu_count ?? 0,
    vram_total_bytes: si.vram_total_bytes ?? null,
    cuda: si.cuda_version ?? null,
    driver: si.driver_version ?? null,
    torch: si.torch_version ?? null
  }
}

function buildSession(
  opts: NonNullable<BuildDiagnosticsOptions['session']>,
  connection: ServerConnection
): DiagnosticsSession {
  return {
    engine_mode: opts.engineMode,
    requested_model: opts.requestedModel,
    requested_quant: opts.requestedQuant,
    confirmed_model: connection.model || null,
    inference_fps: connection.inferenceFps
  }
}

function buildStateAtError(connection: ServerConnection): DiagnosticsStateAtError | null {
  const snap = connection.lastErrorSnapshot
  const rt = connection.runtime
  if (!snap && !rt) return null
  return {
    process_rss_bytes: snap?.process_rss_bytes ?? null,
    ram_used_bytes: snap?.ram_used_bytes ?? null,
    vram_used_bytes: snap?.vram_used_bytes ?? rt?.vramUsedBytes ?? null,
    vram_reserved_bytes: snap?.vram_reserved_bytes ?? null,
    gpu_util_percent: snap?.gpu_util_percent ?? rt?.gpuUtilPercent ?? null
  }
}

// Type-inferred wrappers so the helpers above get the right shapes without
// importing the IPC types directly.
const fetchMeta = () => invoke('get-runtime-diagnostics-meta')
const fetchSys = () => invoke('get-system-diagnostics')

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildDiagnosticsPayload(opts: BuildDiagnosticsOptions): Promise<DiagnosticsPayload> {
  const [meta, sys] = await Promise.all([fetchMeta(), fetchSys()])

  const payload: DiagnosticsPayload = {
    generated_at: new Date().toISOString(),
    app: buildApp(meta),
    client: buildClient(meta, sys),
    server: buildServer(opts.connection),
    error: opts.error,
    logs: opts.logs
  }

  if (opts.session) {
    payload.session = buildSession(opts.session, opts.connection)
    payload.state_at_error = buildStateAtError(opts.connection)
  }

  return payload
}
