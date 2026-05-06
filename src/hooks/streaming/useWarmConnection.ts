import { useEffect, useRef, useState } from 'react'
import type { StageId } from '../../stages'
import type { TranslatableError } from '../../i18n'
import { runWarmConnectionFlow, toTranslatableError } from '../../context/streaming/streamingWarmConnection'
import type { UseEngineResult } from '../engine/useEngineApi'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/Warm')

/** Engine-side dependencies the warm-connection flow consults. Carved
 *  out of `UseEngineResult` so callers don't have to wire each method
 *  individually. */
type WarmEngineDeps = Pick<
  UseEngineResult,
  | 'startServer'
  | 'checkServerReady'
  | 'checkServerRunning'
  | 'checkPortInUse'
  | 'probeServerHealth'
  | 'getLastServerExitTail'
  | 'checkStatus'
  | 'setupEngine'
> & {
  serverPort: number | null
  isServerRunning: boolean
}

/** Drives the warm-connection flow that runs whenever the lifecycle
 *  enters LOADING. The lifecycle effect handler calls `run()` to fire
 *  the flow; the hook owns the trigger counter internally so we don't
 *  pollute the provider with mirror state.
 *
 *  The flow may need to be cancelled imperatively from outside —
 *  `cleanupState` and the intentional-reconnect lifecycle effect both
 *  abort an in-flight warm-up. The hook exposes `cancel()` for that;
 *  every async step inside the flow consults `isCancelled()` before
 *  surfacing state, so a late-arriving error from a cancelled flow
 *  doesn't pollute the UI. */
export function useWarmConnection(opts: {
  /** Once the server starts reporting its own stages over the WS,
   *  this hook's `preConnectionStage` (set during the pre-WS warm-up
   *  steps — uv install, port scan, etc.) is stale. The hook watches
   *  this prop and clears its own stage once it becomes non-null, so
   *  the consumer's `statusStage ?? preConnectionStage` fallback
   *  always shows the freshest source. */
  statusStage: StageId | null
  isStandaloneMode: boolean
  offlineMode: boolean
  serverUrl: string
  engine: WarmEngineDeps
  /** Open the WebSocket once the server is reachable. */
  connect: (endpointUrl: string) => void
  /** Clear the WS-side log tail before a new flow so failure
   *  diagnostics aren't contaminated by the previous attempt. */
  clearWsLogs: () => void
  /** Sink for errors raised by the flow (or its outer catch). */
  onServerError: (err: TranslatableError) => void
}): {
  preConnectionStage: StageId | null
  isFreshInstall: boolean
  /** Trigger a fresh warm-connection attempt. The lifecycle effects
   *  call this on LOADING-state entry. */
  run: () => void
  cancel: () => void
  isCancelled: () => boolean
} {
  const { statusStage, isStandaloneMode, offlineMode, serverUrl, engine, connect, clearWsLogs, onServerError } = opts

  const [trigger, setTrigger] = useState(0)
  const [preConnectionStage, setPreConnectionStage] = useState<StageId | null>(null)
  const [isFreshInstall, setIsFreshInstall] = useState(false)
  const cancelledRef = useRef(false)

  // Once the WS starts reporting its own stages, the warm-flow stage is stale.
  useEffect(() => {
    if (statusStage) setPreConnectionStage(null)
  }, [statusStage])

  useEffect(() => {
    if (trigger === 0) return

    cancelledRef.current = false
    clearWsLogs()

    const handleServerError = (err: TranslatableError) => {
      if (cancelledRef.current) return
      log.error('Server error:', err)
      onServerError(err)
    }

    runWarmConnectionFlow({
      currentServerPort: engine.serverPort,
      isStandaloneMode,
      offlineMode,
      endpointUrl: null,
      serverUrl,
      isServerRunning: engine.isServerRunning,
      checkServerReady: engine.checkServerReady,
      checkPortInUse: engine.checkPortInUse,
      checkServerRunning: engine.checkServerRunning,
      getLastServerExitTail: engine.getLastServerExitTail,
      probeServerHealthViaMain: engine.probeServerHealth,
      checkEngineStatus: engine.checkStatus,
      startServer: engine.startServer,
      setupEngine: engine.setupEngine,
      connect,
      onServerError: handleServerError,
      onStage: (stageId) => {
        if (!cancelledRef.current) setPreConnectionStage(stageId)
      },
      onFreshInstall: (isFresh) => {
        if (!cancelledRef.current) setIsFreshInstall(isFresh)
      },
      isCancelled: () => cancelledRef.current,
      log
    }).catch((err) => {
      if (cancelledRef.current) return
      handleServerError(toTranslatableError(err, offlineMode))
    })

    return () => {
      cancelledRef.current = true
      setPreConnectionStage(null)
      setIsFreshInstall(false)
    }
    // Only restart on a new trigger — every other input is read latest-
    // at-call-time on purpose so a settings change mid-flow doesn't
    // tear it down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])

  const run = () => setTrigger((t) => t + 1)
  const cancel = () => {
    cancelledRef.current = true
  }
  const isCancelled = () => cancelledRef.current

  return { preConnectionStage, isFreshInstall, run, cancel, isCancelled }
}
