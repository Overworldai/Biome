import { STANDALONE_PORT, localhostUrl } from '../../types/settings'
import type { StageId } from '../../stages'
import { toHealthUrl, toWebSocketUrl } from '../../utils/serverUrl'
import { TranslatableError } from '../../i18n'
import { isNetworkError } from '../../lib/networkErrorClassifier'

export const toTranslatableError = (err: unknown, offlineMode: boolean): TranslatableError => {
  if (err instanceof TranslatableError) return err
  const message = err instanceof Error ? err.message : String(err)
  // Steer users who aren't offline-mode-enabled yet toward it. If they already
  // are, the suggestion is irrelevant — fall through to the raw message.
  if (!offlineMode && isNetworkError(message)) {
    return new TranslatableError('app.server.networkUnreachable', { message })
  }
  return new TranslatableError('app.server.fallbackError', { message })
}

type WarmConnectionOptions = {
  currentServerPort: number | null
  isStandaloneMode: boolean
  offlineMode: boolean
  endpointUrl: string | null
  serverUrl: string
  isServerRunning: boolean
  checkServerReady: () => Promise<boolean>
  checkPortInUse: (port: number) => Promise<boolean>
  checkServerRunning: () => Promise<boolean>
  getLastServerExitTail: () => Promise<string | null>
  probeServerHealthViaMain: (healthUrl: string, timeoutMs?: number) => Promise<boolean>
  checkEngineStatus: () => Promise<{
    uv_installed?: boolean
    repo_cloned?: boolean
    dependencies_synced?: boolean
    server_port?: number | null
  } | null>
  startServer: (port: number) => Promise<unknown>
  setupEngine: (onStage?: (stageId: StageId) => void) => Promise<unknown>
  connect: (wsUrl: string) => void
  onServerError: (error: TranslatableError) => void
  onStage: (stageId: StageId) => void
  onFreshInstall: (isFresh: boolean) => void
  isCancelled: () => boolean
  log: { info: (...args: unknown[]) => void }
}

const CONNECTIVITY_TIMEOUT_MS = 2500
const CONNECTIVITY_RETRIES = 4
const CONNECTIVITY_RETRY_DELAY_MS = 450

const STARTUP_HEALTH_POLL_INTERVAL_MS = 500
const STANDALONE_PORT_SCAN_LIMIT = 1337

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const probeServerHealth = async (
  wsUrl: string,
  probeServerHealthViaMain: (healthUrl: string, timeoutMs?: number) => Promise<boolean>
): Promise<boolean> => {
  const healthUrl = toHealthUrl(wsUrl)

  for (let attempt = 1; attempt <= CONNECTIVITY_RETRIES; attempt++) {
    const ok = await probeServerHealthViaMain(healthUrl, CONNECTIVITY_TIMEOUT_MS)
    if (ok) return true

    if (attempt < CONNECTIVITY_RETRIES) {
      await delay(CONNECTIVITY_RETRY_DELAY_MS)
    }
  }

  return false
}

/**
 * Poll health endpoint until it responds 200.
 * Used instead of listening for stdout "SERVER READY" signals.
 *
 * Polls indefinitely — the server's first-time init can include
 * arbitrarily long synchronous work (model downloads, kernel JIT,
 * device-graph compilation), and putting a wall-clock deadline on
 * that just turns "user is patient" into "false-positive timeout".
 * The user-cancel signal (`isCancelled`) and the process-died signal
 * (`checkServerRunning`) are the meaningful exit conditions; if
 * neither fires, the server is still working towards readiness.
 */
const waitForHealthy = async (
  wsUrl: string,
  probeServerHealthViaMain: (healthUrl: string, timeoutMs?: number) => Promise<boolean>,
  checkServerRunning: () => Promise<boolean>,
  getLastServerExitTail: () => Promise<string | null>,
  isCancelled: () => boolean,
  log: { info: (...args: unknown[]) => void }
): Promise<void> => {
  const healthUrl = toHealthUrl(wsUrl)
  log.info('Polling health endpoint until server is ready:', healthUrl)

  while (true) {
    if (isCancelled()) return
    const ok = await probeServerHealthViaMain(healthUrl, CONNECTIVITY_TIMEOUT_MS)
    if (ok) {
      log.info('Server health check passed')
      return
    }
    if (!(await checkServerRunning())) {
      const tail = (await getLastServerExitTail()) ?? ''
      throw new Error(tail || 'Server exited before becoming ready')
    }
    await delay(STARTUP_HEALTH_POLL_INTERVAL_MS)
  }
}

const findFirstOpenStandalonePort = async (
  startPort: number,
  checkPortInUse: (port: number) => Promise<boolean>,
  log: { info: (...args: unknown[]) => void }
): Promise<number | null> => {
  for (let i = 0; i < STANDALONE_PORT_SCAN_LIMIT; i++) {
    const port = startPort + i
    const inUse = await checkPortInUse(port)
    if (!inUse) return port

    log.info(`Port ${port} is in use; skipping`)
  }
  return null
}

/** Sentinel thrown by the standalone helpers to short-circuit a flow
 *  the user has cancelled mid-flight. The main catch handler routes
 *  via `isCancelled()` rather than the error type, so this exists only
 *  to make exit-via-throw legible in the helpers. */
class CancelledError extends Error {
  constructor() {
    super('warm-flow cancelled')
    this.name = 'CancelledError'
  }
}

/** Attach to a managed standalone server that's already running.
 *  Resolves the port (from the prop, or by asking the engine), opens
 *  the WS URL, and (if the server isn't yet ready) waits for health.
 *  Throws on health-poll failure or on cancellation between awaits. */
const attachToRunningStandalone = async (opts: WarmConnectionOptions): Promise<string> => {
  let selectedPort = opts.currentServerPort ?? STANDALONE_PORT
  if (!opts.currentServerPort) {
    const status = await opts.checkEngineStatus()
    if (status?.server_port) selectedPort = status.server_port
  }
  const wsUrl = toWebSocketUrl(localhostUrl(selectedPort))

  if (await opts.checkServerReady()) {
    opts.log.info('Managed standalone server already running and ready on port', selectedPort)
    return wsUrl
  }

  opts.onStage('setup.health_poll')
  opts.log.info('Managed standalone server running but not ready; polling health on port', selectedPort)
  await waitForHealthy(
    wsUrl,
    opts.probeServerHealthViaMain,
    opts.checkServerRunning,
    opts.getLastServerExitTail,
    opts.isCancelled,
    opts.log
  )
  return wsUrl
}

/** Boot a fresh managed standalone server: scan for an open port,
 *  run engine setup if missing, start the server, and wait for it to
 *  become healthy. Throws on any failure or on cancellation between
 *  awaits. */
const bootStandalone = async (opts: WarmConnectionOptions): Promise<string> => {
  opts.onStage('setup.port_scan')
  const port = await findFirstOpenStandalonePort(STANDALONE_PORT, opts.checkPortInUse, opts.log)
  if (port === null) {
    throw new TranslatableError('app.server.noOpenPort', {
      rangeStart: String(STANDALONE_PORT),
      rangeEnd: String(STANDALONE_PORT + STANDALONE_PORT_SCAN_LIMIT - 1)
    })
  }
  const wsUrl = toWebSocketUrl(localhostUrl(port))

  const status = await opts.checkEngineStatus()
  if (!status?.uv_installed || !status?.repo_cloned || !status?.dependencies_synced) {
    opts.onFreshInstall(true)
    opts.onStage('setup.engine')
    opts.log.info('Engine not fully set up, running auto-setup...')
    await opts.setupEngine(opts.onStage)
    if (opts.isCancelled()) throw new CancelledError()
  }

  opts.onStage('setup.server_start')
  opts.log.info('Starting standalone server on port', port)
  await opts.startServer(port)
  opts.onStage('setup.health_poll')
  opts.log.info('Server started, polling health until ready...')
  await waitForHealthy(
    wsUrl,
    opts.probeServerHealthViaMain,
    opts.checkServerRunning,
    opts.getLastServerExitTail,
    opts.isCancelled,
    opts.log
  )
  return wsUrl
}

export const runWarmConnectionFlow = async (opts: WarmConnectionOptions): Promise<void> => {
  // In server mode, derive WS URL from the configured server URL (or override endpoint).
  // In standalone mode, wsUrl is overwritten below with localhost:{port}.
  let wsUrl = toWebSocketUrl(opts.endpointUrl || opts.serverUrl || localhostUrl(STANDALONE_PORT))

  if (opts.isStandaloneMode) {
    opts.onStage('setup.checking')
    opts.log.info('Standalone mode enabled, checking server state...')
    try {
      // Only attach to an already-running server when it's Biome's managed process.
      wsUrl = opts.isServerRunning ? await attachToRunningStandalone(opts) : await bootStandalone(opts)
    } catch (err) {
      if (opts.isCancelled()) return
      opts.onServerError(toTranslatableError(err, opts.offlineMode))
      return
    }
    if (opts.isCancelled()) return
  }

  opts.onStage('setup.connecting')
  const responsive = await probeServerHealth(wsUrl, opts.probeServerHealthViaMain)
  if (!responsive) {
    opts.onServerError(new TranslatableError('app.server.notResponding', { url: toHealthUrl(wsUrl) }))
    return
  }

  if (opts.isCancelled()) return
  opts.log.info('Connecting to WebSocket endpoint:', wsUrl)
  opts.connect(wsUrl)
}
