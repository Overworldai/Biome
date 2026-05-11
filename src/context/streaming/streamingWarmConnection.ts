import { STANDALONE_PORT, localhostUrl } from '../../types/settings'
import type { ServerHealthResult } from '../../types/ipc'
import type { StageId } from '../../stages'
import { toHealthUrl, toWebSocketUrl } from '../../utils/serverUrl'
import { TranslatableError } from '../../i18n'
import { isNetworkError } from '../../lib/networkErrorClassifier'
import type { LifecycleState } from '../engineLifecycle/engineLifecycleContextValue'

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
  isStandaloneMode: boolean
  offlineMode: boolean
  endpointUrl: string | null
  serverUrl: string
  /** Wait until the local server reaches a terminal state. Owned by
   *  the engine lifecycle context; warm-connect's job in standalone mode is just to
   *  await this and then connect, never to install or spawn anything
   *  itself. */
  ensureReady: () => Promise<LifecycleState>
  /** Read the current server port out of `check-engine-status`. Used
   *  after `ensureReady` resolves to derive the WS URL — the actual
   *  port can drift from `STANDALONE_PORT` if the default was already
   *  in use when the server started. */
  checkEngineStatus: () => Promise<{ server_port?: number | null } | null>
  probeServerHealthViaMain: (healthUrl: string, timeoutMs?: number) => Promise<ServerHealthResult>
  connect: (wsUrl: string) => void
  onServerError: (error: TranslatableError) => void
  onStage: (stageId: StageId) => void
  /** Fired with the post-connect probe result so the caller can feed
   *  server-reported state (currently `capabilities`) into app state.
   *  Called only on a successful probe; the failure path goes through
   *  `onServerError` instead. */
  onServerHealth: (result: ServerHealthResult) => void
  isCancelled: () => boolean
  log: { info: (...args: unknown[]) => void }
}

const CONNECTIVITY_TIMEOUT_MS = 2500
const CONNECTIVITY_RETRIES = 4
const CONNECTIVITY_RETRY_DELAY_MS = 450

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

  return { ok: false, launched_from_standalone: false }
}

export const runWarmConnectionFlow = async (opts: WarmConnectionOptions): Promise<void> => {
  // In server mode, derive WS URL from the configured server URL (or override endpoint).
  // In standalone mode, wsUrl is overwritten below with localhost:{port}.
  let wsUrl = toWebSocketUrl(opts.endpointUrl || opts.serverUrl || localhostUrl(STANDALONE_PORT))

  if (opts.isStandaloneMode) {
    opts.onStage('setup.checking')
    opts.log.info('Standalone mode: awaiting engine lifecycle ensureReady')
    let result: LifecycleState
    try {
      result = await opts.ensureReady()
    } catch (err) {
      if (opts.isCancelled()) return
      opts.onServerError(toTranslatableError(err, opts.offlineMode))
      return
    }
    if (opts.isCancelled()) return
    if (result.kind === 'failed') {
      opts.onServerError(toTranslatableError(new Error(result.error), opts.offlineMode))
      return
    }

    // ensureReady promises terminal state — anything reachable here is `ready`.
    // Pull the server port from check-engine-status; it can drift from
    // STANDALONE_PORT if the default was in use when the lifecycle started
    // the server.
    opts.onStage('setup.health_poll')
    const status = await opts.checkEngineStatus()
    const port = status?.server_port ?? STANDALONE_PORT
    wsUrl = toWebSocketUrl(localhostUrl(port))
  }

  opts.onStage('setup.connecting')
  const health = await probeServerHealth(wsUrl, opts.probeServerHealthViaMain)
  if (!health.ok) {
    opts.onServerError(new TranslatableError('app.server.notResponding', { url: toHealthUrl(wsUrl) }))
    return
  }
  opts.onServerHealth(health)

  if (opts.isCancelled()) return
  opts.log.info('Connecting to WebSocket endpoint:', wsUrl)
  opts.connect(wsUrl)
}
