import { useEffect, useRef, useState } from 'react'
import type { StageId } from '../../stages'
import type { TranslatableError } from '../../i18n'
import type { ServerHealthResult } from '../../types/ipc'
import { runWarmConnectionFlow, toTranslatableError } from '../../context/streaming/streamingWarmConnection'
import type { UseEngineResult } from '../engine/useEngineApi'
import type { LifecycleState } from '../../context/engineLifecycle/engineLifecycleContextValue'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/Warm')

/** Engine-side dependencies the warm-connection flow consults. After the
 *  EngineLifecycle-centric refactor the surface is small: warm-connect
 *  only needs to read the server port (post-ensureReady) and probe
 *  `/health`. Install / spawn / port-scan all moved to the lifecycle
 *  context. */
type WarmEngineDeps = Pick<UseEngineResult, 'probeServerHealth' | 'checkStatus'>

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
   *  steps) is stale. The hook watches this prop and clears its own
   *  stage once it becomes non-null, so the consumer's `statusStage ??
   *  preConnectionStage` fallback always shows the freshest source. */
  statusStage: StageId | null
  isStandaloneMode: boolean
  offlineMode: boolean
  serverUrl: string
  engine: WarmEngineDeps
  /** Wait until the local server reaches a terminal state — owned by
   *  the engine lifecycle context; warm-connect just awaits it. */
  ensureReady: () => Promise<LifecycleState>
  /** Open the WebSocket once the server is reachable. */
  connect: (endpointUrl: string) => void
  /** Clear the WS-side log tail before a new flow so failure
   *  diagnostics aren't contaminated by the previous attempt. */
  clearWsLogs: () => void
  /** Sink for errors raised by the flow (or its outer catch). */
  onServerError: (err: TranslatableError) => void
  /** Fired with the post-connect probe result so the provider can
   *  feed server-reported capabilities into the connection slice
   *  before the WS attaches. The settings UI's URL-validation probe
   *  is the other write site for the same state — both share
   *  `setServerCapabilities` on the connection context. */
  onServerHealth: (result: ServerHealthResult) => void
}): {
  preConnectionStage: StageId | null
  /** Trigger a fresh warm-connection attempt. The lifecycle effects
   *  call this on LOADING-state entry. */
  run: () => void
  cancel: () => void
  isCancelled: () => boolean
} {
  const {
    statusStage,
    isStandaloneMode,
    offlineMode,
    serverUrl,
    engine,
    ensureReady,
    connect,
    clearWsLogs,
    onServerError,
    onServerHealth
  } = opts

  const [trigger, setTrigger] = useState(0)
  const [preConnectionStage, setPreConnectionStage] = useState<StageId | null>(null)
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
      isStandaloneMode,
      offlineMode,
      endpointUrl: null,
      serverUrl,
      ensureReady,
      checkEngineStatus: engine.checkStatus,
      probeServerHealthViaMain: engine.probeServerHealth,
      connect,
      onServerError: handleServerError,
      onStage: (stageId) => {
        if (!cancelledRef.current) setPreConnectionStage(stageId)
      },
      onServerHealth: (result) => {
        if (!cancelledRef.current) onServerHealth(result)
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

  return { preConnectionStage, run, cancel, isCancelled }
}
