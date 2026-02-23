type WarmConnectionOptions = {
  standalonePort: number
  isStandaloneMode: boolean
  endpointUrl: string | null
  gpuServer: { host: string; port: number }
  isServerRunning: boolean
  checkServerReady: () => Promise<boolean>
  checkPortInUse: (port: number) => Promise<boolean>
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

export const runWarmConnectionFlow = async ({
  standalonePort,
  isStandaloneMode,
  endpointUrl,
  gpuServer,
  isServerRunning,
  checkServerReady,
  checkPortInUse,
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
  const wsUrl = isStandaloneMode ? standaloneUrl : endpointUrl || `${gpuServer.host}:${gpuServer.port}`

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

  if (isCancelled()) return
  log.info('Connecting to WebSocket endpoint:', wsUrl)
  connect(wsUrl)
}
