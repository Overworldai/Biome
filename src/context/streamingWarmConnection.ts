import { STANDALONE_PORT, localhostUrl } from '../types/settings'
import type { ServerHealthResult } from '../types/ipc'
import type { StageId } from '../stages'
import { toHealthUrl, toWebSocketUrl } from '../utils/serverUrl'
import { TranslatableError } from '../i18n'

const toTranslatableError = (err: unknown): TranslatableError => {
  if (err instanceof TranslatableError) return err
  const message = err instanceof Error ? err.message : String(err)
  return new TranslatableError('app.server.fallbackError', { message })
}

type WarmConnectionOptions = {
  currentServerPort: number | null
  isStandaloneMode: boolean
  endpointUrl: string | null
  serverUrl: string
  isServerRunning: boolean
  checkServerReady: () => Promise<boolean>
  checkPortInUse: (port: number) => Promise<boolean>
  probeServerHealthViaMain: (healthUrl: string, timeoutMs?: number) => Promise<ServerHealthResult>
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
  onServerHealth: (result: ServerHealthResult) => void
  isCancelled: () => boolean
  log: { info: (...args: unknown[]) => void }
}

const CONNECTIVITY_TIMEOUT_MS = 2500
const CONNECTIVITY_RETRIES = 4
const CONNECTIVITY_RETRY_DELAY_MS = 450

const STARTUP_HEALTH_POLL_INTERVAL_MS = 500
const STARTUP_HEALTH_TIMEOUT_MS = 120_000
const STANDALONE_PORT_SCAN_LIMIT = 1337

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const probeServerHealth = async (
  wsUrl: string,
  probeServerHealthViaMain: (healthUrl: string, timeoutMs?: number) => Promise<ServerHealthResult>
): Promise<ServerHealthResult> => {
  const healthUrl = toHealthUrl(wsUrl)

  for (let attempt = 1; attempt <= CONNECTIVITY_RETRIES; attempt++) {
    const result = await probeServerHealthViaMain(healthUrl, CONNECTIVITY_TIMEOUT_MS)
    if (result.ok) return result

    if (attempt < CONNECTIVITY_RETRIES) {
      await delay(CONNECTIVITY_RETRY_DELAY_MS)
    }
  }

  return { ok: false }
}

/**
 * Poll health endpoint until it responds 200.
 * Used instead of listening for stdout "SERVER READY" signals.
 */
const waitForHealthy = async (
  wsUrl: string,
  probeServerHealthViaMain: (healthUrl: string, timeoutMs?: number) => Promise<ServerHealthResult>,
  isCancelled: () => boolean,
  log: { info: (...args: unknown[]) => void }
): Promise<void> => {
  const healthUrl = toHealthUrl(wsUrl)
  const deadline = Date.now() + STARTUP_HEALTH_TIMEOUT_MS
  log.info('Polling health endpoint until server is ready:', healthUrl)

  while (Date.now() < deadline) {
    if (isCancelled()) return
    const result = await probeServerHealthViaMain(healthUrl, CONNECTIVITY_TIMEOUT_MS)
    if (result.ok) {
      log.info('Server health check passed')
      return
    }
    await delay(STARTUP_HEALTH_POLL_INTERVAL_MS)
  }

  throw new TranslatableError('app.server.startupTimeout')
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

export const runWarmConnectionFlow = async ({
  currentServerPort,
  isStandaloneMode,
  endpointUrl,
  serverUrl,
  isServerRunning,
  checkServerReady,
  checkPortInUse,
  probeServerHealthViaMain,
  checkEngineStatus,
  startServer,
  setupEngine,
  connect,
  onServerError,
  onStage,
  onFreshInstall,
  onServerHealth,
  isCancelled,
  log
}: WarmConnectionOptions): Promise<void> => {
  // In server mode, derive WS URL from the configured server URL (or override endpoint).
  // In standalone mode, wsUrl is always overwritten below with localhost:{port}.
  let wsUrl = toWebSocketUrl(endpointUrl || serverUrl || localhostUrl(STANDALONE_PORT))

  if (isStandaloneMode) {
    onStage('setup.checking')
    log.info('Standalone mode enabled, checking server state...')
    let selectedPort = STANDALONE_PORT

    // Only attach to an already-running server when it's Biome's managed process.
    if (isServerRunning) {
      selectedPort = currentServerPort ?? selectedPort
      if (!currentServerPort) {
        const status = await checkEngineStatus()
        if (status?.server_port) selectedPort = status.server_port
      }
      wsUrl = toWebSocketUrl(localhostUrl(selectedPort))

      const serverAlreadyReady = await checkServerReady()
      if (serverAlreadyReady) {
        log.info('Managed standalone server already running and ready on port', selectedPort)
      } else {
        onStage('setup.health_poll')
        log.info('Managed standalone server running but not ready; polling health on port', selectedPort)
        try {
          await waitForHealthy(wsUrl, probeServerHealthViaMain, isCancelled, log)
          if (isCancelled()) return
        } catch (err) {
          if (isCancelled()) return
          onServerError(toTranslatableError(err))
          return
        }
      }
    } else {
      onStage('setup.port_scan')
      const openPort = await findFirstOpenStandalonePort(STANDALONE_PORT, checkPortInUse, log)
      if (openPort === null) {
        onServerError(
          new TranslatableError('app.server.noOpenPort', {
            rangeStart: String(STANDALONE_PORT),
            rangeEnd: String(STANDALONE_PORT + STANDALONE_PORT_SCAN_LIMIT - 1)
          })
        )
        return
      }
      selectedPort = openPort
      wsUrl = toWebSocketUrl(localhostUrl(selectedPort))

      const status = await checkEngineStatus()
      if (!status?.uv_installed || !status?.repo_cloned || !status?.dependencies_synced) {
        onFreshInstall(true)
        onStage('setup.engine')
        log.info('Engine not fully set up, running auto-setup...')
        try {
          await setupEngine(onStage)
          if (isCancelled()) return
        } catch (err) {
          if (isCancelled()) return
          onServerError(toTranslatableError(err))
          return
        }
      }

      try {
        onStage('setup.server_start')
        log.info('Starting standalone server on port', selectedPort)
        await startServer(selectedPort)
        onStage('setup.health_poll')
        log.info('Server started, polling health until ready...')
        await waitForHealthy(wsUrl, probeServerHealthViaMain, isCancelled, log)
        if (isCancelled()) return
      } catch (err) {
        if (isCancelled()) return
        onServerError(toTranslatableError(err))
        return
      }
    }
  }

  onStage('setup.connecting')

  const health = await probeServerHealth(wsUrl, probeServerHealthViaMain)
  if (!health.ok) {
    onServerError(new TranslatableError('app.server.notResponding', { url: toHealthUrl(wsUrl) }))
    return
  }
  onServerHealth(health)

  if (isCancelled()) return
  log.info('Connecting to WebSocket endpoint:', wsUrl)
  connect(wsUrl)
}
