import { STANDALONE_PORT, localhostUrl } from '../types/settings'
import type { StageId } from '../stages'

type WarmConnectionOptions = {
  currentServerPort: number | null
  isStandaloneMode: boolean
  endpointUrl: string | null
  serverUrl: string
  isServerRunning: boolean
  checkServerReady: () => Promise<boolean>
  checkPortInUse: (port: number) => Promise<boolean>
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
  onServerError: (error: unknown) => void
  onStage: (stageId: StageId) => void
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

const normalizeWsEndpoint = (endpoint: string, preferSecure: boolean): string => {
  let raw = endpoint.trim()
  if (!raw) raw = localhostUrl(STANDALONE_PORT)

  if (!/^[a-z]+:\/\//i.test(raw)) {
    raw = `${preferSecure ? 'wss' : 'ws'}://${raw}`
  }

  const url = new URL(raw)
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    url.protocol = preferSecure ? 'wss:' : 'ws:'
  }
  if (!url.pathname || url.pathname === '/') {
    url.pathname = '/ws'
  }
  return url.toString()
}

const toHealthUrl = (normalizedWsUrl: string): string => {
  const url = new URL(normalizedWsUrl)
  if (url.protocol === 'wss:') {
    url.protocol = 'https:'
  } else {
    url.protocol = 'http:'
  }
  url.pathname = '/health'
  url.search = ''
  url.hash = ''
  return url.toString()
}

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
 */
const waitForHealthy = async (
  wsUrl: string,
  probeServerHealthViaMain: (healthUrl: string, timeoutMs?: number) => Promise<boolean>,
  isCancelled: () => boolean,
  log: { info: (...args: unknown[]) => void }
): Promise<void> => {
  const healthUrl = toHealthUrl(wsUrl)
  const deadline = Date.now() + STARTUP_HEALTH_TIMEOUT_MS
  log.info('Polling health endpoint until server is ready:', healthUrl)

  while (Date.now() < deadline) {
    if (isCancelled()) return
    const ok = await probeServerHealthViaMain(healthUrl, CONNECTIVITY_TIMEOUT_MS)
    if (ok) {
      log.info('Server health check passed')
      return
    }
    await delay(STARTUP_HEALTH_POLL_INTERVAL_MS)
  }

  throw new Error('Server startup timeout - check logs for errors')
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
  isCancelled,
  log
}: WarmConnectionOptions): Promise<void> => {
  // In server mode, derive WS URL from the configured server URL (or override endpoint).
  // In standalone mode, wsUrl is always overwritten below with localhost:{port}.
  const preferSecureTransport = !isStandaloneMode && serverUrl.startsWith('https')
  let wsUrl = normalizeWsEndpoint(endpointUrl || serverUrl, preferSecureTransport)

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
      wsUrl = normalizeWsEndpoint(localhostUrl(selectedPort), false)

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
          onServerError(err)
          return
        }
      }
    } else {
      onStage('setup.port_scan')
      const openPort = await findFirstOpenStandalonePort(STANDALONE_PORT, checkPortInUse, log)
      if (openPort === null) {
        onServerError(
          new Error(
            `No open standalone port found in range ${STANDALONE_PORT}-${STANDALONE_PORT + STANDALONE_PORT_SCAN_LIMIT - 1}.`
          )
        )
        return
      }
      selectedPort = openPort
      wsUrl = normalizeWsEndpoint(localhostUrl(selectedPort), false)

      const status = await checkEngineStatus()
      if (!status?.uv_installed || !status?.repo_cloned || !status?.dependencies_synced) {
        onStage('setup.engine')
        log.info('Engine not fully set up, running auto-setup...')
        try {
          await setupEngine(onStage)
          if (isCancelled()) return
        } catch (err) {
          if (isCancelled()) return
          onServerError(err)
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
        onServerError(err)
        return
      }
    }
  }

  onStage('setup.connecting')

  const responsive = await probeServerHealth(wsUrl, probeServerHealthViaMain)
  if (!responsive) {
    onServerError(new Error(`Server is not responding at ${toHealthUrl(wsUrl)}.`))
    return
  }

  if (isCancelled()) return
  log.info('Connecting to WebSocket endpoint:', wsUrl)
  connect(wsUrl)
}
