type WarmConnectionOptions = {
  standalonePort: number
  isStandaloneMode: boolean
  endpointUrl: string | null
  gpuServer: { host: string; port: number; use_ssl?: boolean }
  isServerRunning: boolean
  checkServerReady: () => Promise<boolean>
  checkPortInUse: (port: number) => Promise<boolean>
  probeServerHealthViaMain: (healthUrl: string, timeoutMs?: number) => Promise<boolean>
  checkEngineStatus: () => Promise<{
    uv_installed?: boolean
    repo_cloned?: boolean
    dependencies_synced?: boolean
  } | null>
  startServer: (port: number) => Promise<unknown>
  connect: (wsUrl: string) => void
  setUnlisten: (fn: () => void) => void
  listenForServerReady: (onReady: () => void) => Promise<() => void>
  onServerError: (error: unknown) => void
  isCancelled: () => boolean
  log: { info: (...args: unknown[]) => void }
}

const CONNECTIVITY_TIMEOUT_MS = 2500
const CONNECTIVITY_RETRIES = 4
const CONNECTIVITY_RETRY_DELAY_MS = 450

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const normalizeWsEndpoint = (endpoint: string, preferSecure: boolean): string => {
  let raw = endpoint.trim()
  if (!raw) return preferSecure ? 'wss://localhost/ws' : 'ws://localhost/ws'

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

export const runWarmConnectionFlow = async ({
  standalonePort,
  isStandaloneMode,
  endpointUrl,
  gpuServer,
  isServerRunning,
  checkServerReady,
  checkPortInUse,
  probeServerHealthViaMain,
  checkEngineStatus,
  startServer,
  connect,
  setUnlisten,
  listenForServerReady,
  onServerError,
  isCancelled,
  log
}: WarmConnectionOptions): Promise<void> => {
  const standaloneUrl = `localhost:${standalonePort}`
  const rawEndpoint = isStandaloneMode ? standaloneUrl : endpointUrl || `${gpuServer.host}:${gpuServer.port}`
  const preferSecureTransport = isStandaloneMode ? false : Boolean(gpuServer.use_ssl)
  const wsUrl = normalizeWsEndpoint(rawEndpoint, preferSecureTransport)

  const waitForServerReady = () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout - check logs for errors'))
      }, 120000)

      listenForServerReady(() => {
        clearTimeout(timeout)
        log.info('Server ready signal received!')
        resolve()
      }).then(setUnlisten)
    })
  }

  if (isStandaloneMode) {
    log.info('Standalone mode enabled, checking server state...')

    const serverAlreadyReady = await checkServerReady()
    if (serverAlreadyReady) {
      log.info('Server already running and ready')
    } else {
      const portInUse = await checkPortInUse(standalonePort)
      if (portInUse) {
        log.info(`Port ${standalonePort} already in use - assuming server is ready`)
      } else if (isServerRunning) {
        log.info('Server running but not ready - waiting...')
        try {
          await waitForServerReady()
          if (isCancelled()) return
        } catch (err) {
          if (isCancelled()) return
          onServerError(err)
          return
        }
      } else {
        log.info('Starting server on port', standalonePort)
        const status = await checkEngineStatus()
        if (!status?.uv_installed || !status?.repo_cloned || !status?.dependencies_synced) {
          const missing: string[] = []
          if (!status?.uv_installed) missing.push('uv package manager')
          if (!status?.repo_cloned) missing.push('engine files')
          if (!status?.dependencies_synced) missing.push('dependencies')
          const missingStr = missing.join(', ')
          onServerError(new Error(`Engine not ready: missing ${missingStr}. Please reinstall in Settings.`))
          return
        }

        try {
          const readyPromise = waitForServerReady()
          await startServer(standalonePort)
          log.info('Server started, waiting for ready signal...')
          await readyPromise
          if (isCancelled()) return
        } catch (err) {
          if (isCancelled()) return
          onServerError(err)
          return
        }
      }
    }
  }

  const responsive = await probeServerHealth(wsUrl, probeServerHealthViaMain)
  if (!responsive) {
    onServerError(new Error(`Server is not responding at ${toHealthUrl(wsUrl)}.`))
    return
  }

  if (isCancelled()) return
  log.info('Connecting to WebSocket endpoint:', wsUrl)
  connect(wsUrl)
}
