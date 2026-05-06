import { useState, useEffect, useRef, useCallback } from 'react'
import stripAnsi from 'strip-ansi'
import { createLogger } from '../utils/logger'
import { WsRpcClient } from '../lib/wsRpc'
import type { StageId } from '../stages'
import { toWebSocketUrl } from '../utils/serverUrl'
import { TranslatableError, type TranslationKey } from '../i18n'
import {
  PROTOCOL_VERSION,
  type ControlNotif,
  type ErrorMessage,
  type ErrorSnapshot,
  type FrameHeader,
  type InitRequest,
  type InitResponseData,
  type LogMessage,
  type PauseNotif,
  type ResetNotif,
  type ResumeNotif,
  type SystemInfo,
  type WarningMessage
} from '../types/protocol.generated'
import type { LogRecord } from '../types/ipc'
import { ServerMessageSchema, type ServerMessage, type WsRequest } from '../lib/wsRpc'
import { FrameHeaderSchema } from '../types/protocol.generated'

/** TS-side union of the fire-and-forget notifications the renderer
 *  sends; constructed per-call by the helpers below so tsc verifies
 *  the wire shape against the generated types. */
type ClientNotif = ControlNotif | PauseNotif | ResumeNotif | ResetNotif
import type { ServerCode } from '../types/input'

const log = createLogger('WebSocket')
const MAX_VISIBLE_LOG_LINES = 500

const toLogRecord = (msg: LogMessage): LogRecord => ({
  event: stripAnsi(msg.event),
  level: msg.level,
  logger: msg.logger,
  timestamp: msg.timestamp,
  exception: msg.exception,
  fields: msg.fields
})

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export type FrameProfile = {
  inferMs: number
  syncMs: number
  encMs: number
  metricsMs: number
  overheadMs: number
}

/** Live, per-frame-header metrics.  Static identifiers (GPU name, VRAM total,
 *  model, inference FPS) live on ServerConnection rather than here — frame
 *  headers only carry dynamic values. */
export type RuntimeMetrics = {
  vramUsedBytes: number
  gpuUtilPercent: number
  profile: FrameProfile | null
}

/** Single source of truth for everything about the current server session.
 *  Populated from the init RPC response (static identifiers), binary frame
 *  headers (runtime metrics), and error push messages (lastErrorSnapshot). */
export type ServerConnection = {
  systemInfo: SystemInfo | null
  model: string | null
  inferenceFps: number | null
  runtime: RuntimeMetrics | null
  lastErrorSnapshot: ErrorSnapshot | null
}

const emptyConnection = (): ServerConnection => ({
  systemInfo: null,
  model: null,
  inferenceFps: null,
  runtime: null,
  lastErrorSnapshot: null
})

type WebSocketHook = {
  connectionState: ConnectionState
  statusStage: StageId | null
  error: TranslatableError | null
  frame: Blob | string | null
  hasRealFrame: boolean
  frameId: number
  genTime: number | null
  latentGenMs: number | null
  temporalCompression: number
  frameGenMsRef: { current: number }
  frameTemporalCompressionRef: { current: number }
  frameIdRef: { current: number }
  connection: ServerConnection
  inputLatency: number | null
  logs: LogRecord[]
  allLogs: LogRecord[]
  connect: (endpointUrl: string) => void
  disconnect: () => void
  sendControl: (buttons?: string[], mouseDx?: number, mouseDy?: number) => boolean
  sendPause: (paused: boolean) => void
  sendInit: (params: Omit<InitRequest, 'type' | 'req_id'>) => Promise<InitResponseData>
  applyInitResponse: (metrics: InitResponseData) => void
  setPlaceholderFrame: (frame: Blob | string | null) => void
  reset: () => void
  request: WsRequest
  clearLogs: () => void
  isConnected: boolean
  isReady: boolean
  isLoading: boolean
}

export const useWebSocket = (): WebSocketHook => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [frame, setFrame] = useState<Blob | string | null>(null)
  const [frameId, setFrameId] = useState(0)
  const [error, setError] = useState<TranslatableError | null>(null)
  const [genTime, setGenTime] = useState<number | null>(null)
  const [latentGenMs, setLatentGenMs] = useState<number | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [statusStage, setStatusStage] = useState<StageId | null>(null)
  const [hasRealFrame, setHasRealFrame] = useState(false)
  const [logs, setLogs] = useState<LogRecord[]>([])
  const [connection, setConnection] = useState<ServerConnection>(emptyConnection)
  const [inputLatency, setInputLatency] = useState<number | null>(null)
  const allLogsRef = useRef<LogRecord[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const isConnectingRef = useRef(false)
  const isReadyRef = useRef(false)
  const lastControlTsRef = useRef<number>(0)
  const frameGenMsRef = useRef<number>(0)
  const frameTemporalCompressionRef = useRef<number>(1)
  const frameIdRef = useRef<number>(0)
  const [temporalCompression, setTemporalCompression] = useState(1)
  const rpcRef = useRef(new WsRpcClient())
  const resolveServerMessage = useCallback(
    (msg: ErrorMessage | WarningMessage, fallbackKey: TranslationKey): TranslatableError => {
      const detail = msg.message
      if (msg.message_id) {
        const params = msg.params ?? {}
        // Forward raw detail as `message` param — keys that include
        // `{{message}}` surface it; keys that don't just ignore it.
        return new TranslatableError(msg.message_id, detail ? { ...params, message: detail } : params)
      }
      const message = detail ?? JSON.stringify(msg)
      return new TranslatableError(fallbackKey, { message })
    },
    []
  )

  const appendLog = useCallback((record: LogRecord) => {
    allLogsRef.current = [...allLogsRef.current, record]
    setLogs((prev) => {
      const next = [...prev, record]
      return next.length > MAX_VISIBLE_LOG_LINES ? next.slice(-MAX_VISIBLE_LOG_LINES) : next
    })
  }, [])

  const clearLogs = useCallback(() => {
    allLogsRef.current = []
    setLogs([])
  }, [])

  const connect = useCallback(
    (endpointUrl: string) => {
      if (isConnectingRef.current || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) {
        return
      }

      if (!endpointUrl) {
        setError(new TranslatableError('app.server.noEndpointUrl'))
        return
      }

      isConnectingRef.current = true
      setConnectionState('connecting')
      setError(null)
      setStatusStage(null)
      setHasRealFrame(false)
      allLogsRef.current = []
      setLogs([])

      let wsUrl: string
      try {
        const baseUrl = toWebSocketUrl(endpointUrl)
        // Tag the WS URL with the renderer's protocol version so the server
        // can reject mismatched clients up front. The server compares against
        // its own `PROTOCOL_VERSION`; on mismatch we get back a typed
        // `error` push with `app.server.error.protocolVersionMismatch`.
        const separator = baseUrl.includes('?') ? '&' : '?'
        wsUrl = `${baseUrl}${separator}protocol_version=${PROTOCOL_VERSION}`
      } catch (err) {
        isConnectingRef.current = false
        setConnectionState('error')
        setError(err instanceof TranslatableError ? err : new TranslatableError('app.server.invalidWebsocketEndpoint'))
        return
      }

      let ws: WebSocket
      try {
        ws = new WebSocket(wsUrl)
      } catch (err) {
        isConnectingRef.current = false
        setConnectionState('error')
        setError(err instanceof TranslatableError ? err : new TranslatableError('app.server.websocketConnectionFailed'))
        return
      }
      wsRef.current = ws

      const rpc = rpcRef.current
      rpc.attach(ws)

      ws.onopen = () => {
        if (wsRef.current !== ws) return
        isConnectingRef.current = false
        setConnectionState('connected')
      }

      ws.binaryType = 'arraybuffer'

      ws.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (wsRef.current !== ws) return

        // Binary messages: [4-byte LE header_len][FrameHeader JSON][JPEG bytes]
        // The server sends every frame envelope through `FrameHeader.model_dump_json`,
        // so the wire shape matches the generated `FrameHeader` type — and we
        // validate it at runtime via `FrameHeaderSchema` to catch any mid-deploy
        // version skew before the consumer reads possibly-missing fields.
        if (event.data instanceof ArrayBuffer) {
          const view = new DataView(event.data)
          const headerLen = view.getUint32(0, true)
          const headerBytes = new Uint8Array(event.data, 4, headerLen)
          const headerJson: unknown = JSON.parse(new TextDecoder().decode(headerBytes))
          const headerResult = FrameHeaderSchema.safeParse(headerJson)
          if (!headerResult.success) {
            log.error('Frame header failed validation:', headerResult.error.message, headerJson)
            return
          }
          const header: FrameHeader = headerResult.data
          const imageBlob = new Blob([new Uint8Array(event.data, 4 + headerLen)], { type: 'image/jpeg' })

          const headerTemporalCompression = header.temporal_compression ?? 1
          frameTemporalCompressionRef.current = headerTemporalCompression
          setTemporalCompression(headerTemporalCompression)
          frameGenMsRef.current = header.gen_ms
          setGenTime(Math.round(header.gen_ms))
          frameIdRef.current = header.frame_id
          // First display frame of each latent pass: update latent gen stats and GPU metrics
          if ((frameIdRef.current - 1) % headerTemporalCompression === 0) {
            setLatentGenMs(Math.round(header.gen_ms))
            const runtime: RuntimeMetrics = {
              vramUsedBytes: header.vram_used_bytes ?? -1,
              gpuUtilPercent: header.gpu_util_percent ?? -1,
              profile:
                header.t_infer_ms != null
                  ? {
                      inferMs: header.t_infer_ms,
                      syncMs: header.t_sync_ms ?? 0,
                      encMs: header.t_enc_ms ?? 0,
                      metricsMs: header.t_metrics_ms ?? 0,
                      overheadMs: header.t_overhead_ms ?? 0
                    }
                  : null
            }
            setConnection((prev) => ({ ...prev, runtime }))
          }
          setFrame(imageBlob)
          setHasRealFrame(true)
          setFrameId(frameIdRef.current)
          if (header.client_ts > 0) {
            setInputLatency(Math.round(performance.now() - header.client_ts))
          }
          return
        }

        let raw: unknown
        try {
          raw = JSON.parse(event.data)
        } catch (err) {
          log.error('Failed to JSON-parse message:', err)
          return
        }
        const msgResult = ServerMessageSchema.safeParse(raw)
        if (!msgResult.success) {
          // Wire shape didn't match any known variant — the server is on a
          // different protocol version, or somebody is poking the WS with
          // bad payloads. Log the Zod error and the raw blob, then drop.
          log.error('Server message failed validation:', msgResult.error.message, raw)
          return
        }
        const msg: ServerMessage = msgResult.data

        // RPC responses are routed via the type predicate; after this
        // returns false, `msg` narrows to push-only variants and the
        // exhaustive switch below catches a missing case at compile time.
        if (rpc.handleMessage(msg)) return

        switch (msg.type) {
          case 'status': {
            setStatusStage(msg.stage)
            if (msg.stage === 'session.ready') {
              setIsReady(true)
              isReadyRef.current = true
            }
            break
          }
          case 'log': {
            appendLog(toLogRecord(msg))
            break
          }
          case 'error': {
            setError(resolveServerMessage(msg, 'app.server.fallbackError'))
            setConnectionState('error')
            if (msg.snapshot) {
              setConnection((prev) => ({ ...prev, lastErrorSnapshot: msg.snapshot ?? prev.lastErrorSnapshot }))
            }
            break
          }
          case 'system_info': {
            // Early push from server at connect time — arrives before init so
            // the hardware identity is available even if the session crashes
            // during model load / device warmup.
            const { type: _type, ...info } = msg
            setConnection((prev) => ({ ...prev, systemInfo: info }))
            break
          }
          case 'warning':
            break
          default: {
            // Exhaustiveness gate: every variant of `ServerPushMessage` must
            // have a case above. tsc errors here if we add a new push type
            // to `protocol.py` without handling it.
            const _exhaustive: never = msg
            log.debug('Unhandled message:', _exhaustive)
          }
        }
      }

      ws.onerror = () => {
        if (wsRef.current !== ws) return
        isConnectingRef.current = false
        setError(new TranslatableError('app.server.websocketError'))
        setConnectionState('error')
      }

      ws.onclose = () => {
        if (wsRef.current !== ws) return
        isConnectingRef.current = false
        rpc.detach()
        wsRef.current = null
        setConnectionState('disconnected')
        setIsReady(false)
        // Preserve statusStage across close so a bug report captures where the
        // server was in its init flow (e.g. "session.scene_authoring.load") when it
        // died.  It's overwritten by the next session's status messages on reconnect.
        setFrame(null)
        setHasRealFrame(false)
        setFrameId(0)
        setGenTime(null)
        setLatentGenMs(null)
        // Preserve systemInfo + lastErrorSnapshot across close so a bug report
        // copied after the server dies still has the hardware identity + the
        // error-time snapshot.  Model/inferenceFps/runtime are session-scoped
        // and get reset.
        setConnection((prev) => ({
          ...emptyConnection(),
          systemInfo: prev.systemInfo,
          lastErrorSnapshot: prev.lastErrorSnapshot
        }))
        setInputLatency(null)
      }
    },
    [appendLog, resolveServerMessage]
  )

  const disconnect = useCallback(() => {
    isConnectingRef.current = false
    isReadyRef.current = false
    rpcRef.current.detach()
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setConnectionState('disconnected')
    setIsReady(false)
    setFrame(null)
    setFrameId(0)
    setError(null)
    setGenTime(null)
    // Explicit user-initiated disconnect — clear everything including any
    // previously cached systemInfo, since this isn't a "server died" case.
    setConnection(emptyConnection())
    setInputLatency(null)
    setStatusStage(null)
    setHasRealFrame(false)
  }, [])

  const sendNotif = useCallback((notif: ClientNotif): boolean => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false
    // `notif` is typed `ClientNotif` so each construction site (sendControl,
    // sendPause, reset) is checked at compile time — no runtime validation
    // needed here.
    wsRef.current.send(JSON.stringify(notif))
    return true
  }, [])

  const sendControl = useCallback(
    (buttons: ServerCode[] = [], mouseDx = 0, mouseDy = 0) => {
      const ts = performance.now()
      const notif: ControlNotif = { type: 'control', buttons, mouse_dx: mouseDx, mouse_dy: mouseDy, ts }
      const sent = sendNotif(notif)
      if (sent) lastControlTsRef.current = ts
      return sent
    },
    [sendNotif]
  )

  const sendPause = useCallback(
    (paused: boolean) => {
      const notif: PauseNotif | ResumeNotif = paused ? { type: 'pause' } : { type: 'resume' }
      sendNotif(notif)
    },
    [sendNotif]
  )

  const sendInit = useCallback((params: Omit<InitRequest, 'type' | 'req_id'>): Promise<InitResponseData> => {
    // No timeout — init can take minutes (model download, warmup, graph compilation).
    // The WebSocket close event will reject the promise if the connection drops.
    return rpcRef.current.request('init', params, 0)
  }, [])

  const applyInitResponse = useCallback((metrics: InitResponseData) => {
    setConnection((prev) => ({
      ...prev,
      systemInfo: metrics.system_info ?? prev.systemInfo,
      model: metrics.model || null,
      inferenceFps: metrics.inference_fps ?? null,
      runtime: null // will be populated from the next frame header
    }))
  }, [])

  const setPlaceholderFrame = useCallback((frame: Blob | string | null) => {
    setFrame(frame)
  }, [])

  const reset = useCallback(() => {
    const notif: ResetNotif = { type: 'reset' }
    sendNotif(notif)
  }, [sendNotif])

  const request = useCallback<WsRequest>(
    (type, params, timeoutMs) => rpcRef.current.request(type, params, timeoutMs),
    []
  )

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    connectionState,
    statusStage,
    error,
    frame,
    hasRealFrame,
    frameId,
    genTime,
    latentGenMs,
    temporalCompression,
    frameGenMsRef,
    frameTemporalCompressionRef,
    frameIdRef,
    connection,
    inputLatency,
    logs,
    allLogs: allLogsRef.current,
    connect,
    disconnect,
    sendControl,
    sendPause,
    sendInit,
    applyInitResponse,
    setPlaceholderFrame,
    reset,
    request,
    clearLogs,
    isConnected: connectionState === 'connected',
    isReady,
    isLoading: connectionState === 'connecting' || (connectionState === 'connected' && !isReady)
  }
}

export default useWebSocket
