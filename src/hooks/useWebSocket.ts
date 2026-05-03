import { useState, useEffect, useRef, useCallback } from 'react'
import stripAnsi from 'strip-ansi'
import { createLogger } from '../utils/logger'
import { WsRpcClient } from '../lib/wsRpc'
import type { StageId } from '../stages'
import { toWebSocketUrl } from '../utils/serverUrl'
import { TranslatableError, type TranslationKey } from '../i18n'
import type { InitMessage, InitResponse, ServerErrorSnapshot, ServerSystemInfo } from '../types/ws'
import type { ServerCode } from '../types/input'

const log = createLogger('WebSocket')
const MAX_VISIBLE_LOG_LINES = 500

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
  systemInfo: ServerSystemInfo | null
  model: string | null
  inferenceFps: number | null
  runtime: RuntimeMetrics | null
  lastErrorSnapshot: ServerErrorSnapshot | null
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
  logs: string[]
  allLogs: string[]
  connect: (endpointUrl: string) => void
  disconnect: () => void
  sendControl: (buttons?: string[], mouseDx?: number, mouseDy?: number) => boolean
  sendPause: (paused: boolean) => void
  sendInit: (params: Omit<InitMessage, 'type' | 'req_id'>) => Promise<InitResponse>
  applyInitResponse: (metrics: InitResponse) => void
  setPlaceholderFrame: (frame: Blob | string | null) => void
  reset: () => void
  request: <T = unknown>(type: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
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
  const [logs, setLogs] = useState<string[]>([])
  const [connection, setConnection] = useState<ServerConnection>(emptyConnection)
  const [inputLatency, setInputLatency] = useState<number | null>(null)
  const allLogsRef = useRef<string[]>([])

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
    (msg: Record<string, unknown>, fallbackKey: TranslationKey): TranslatableError => {
      const messageId = msg.message_id as string | undefined
      const detail = msg.message as string | undefined
      if (messageId) {
        const key = messageId as TranslationKey
        const params = (msg.params as Record<string, string>) ?? {}
        // Forward raw detail as `message` param — keys that include
        // `{{message}}` surface it; keys that don't just ignore it.
        return new TranslatableError(key, detail ? { ...params, message: detail } : params)
      }
      const message = detail ?? JSON.stringify(msg)
      return new TranslatableError(fallbackKey, { message })
    },
    []
  )

  const appendLog = useCallback((line: string) => {
    allLogsRef.current = [...allLogsRef.current, line]
    setLogs((prev) => {
      const next = [...prev, line]
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
        wsUrl = toWebSocketUrl(endpointUrl)
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

        // Binary messages: [4-byte LE header_len][JSON header][image bytes]
        // If header contains req_id → RPC response; otherwise → frame
        if (event.data instanceof ArrayBuffer) {
          const view = new DataView(event.data)
          const headerLen = view.getUint32(0, true)
          const headerBytes = new Uint8Array(event.data, 4, headerLen)
          const header = JSON.parse(new TextDecoder().decode(headerBytes)) as Record<string, unknown>
          const imageBlob = new Blob([new Uint8Array(event.data, 4 + headerLen)], { type: 'image/jpeg' })

          // Binary RPC response
          if (header.req_id != null) {
            rpc.handleBinaryResponse(header, imageBlob)
            return
          }

          // Binary frame
          const headerTemporalCompression = (header.temporal_compression as number) ?? 1
          frameTemporalCompressionRef.current = headerTemporalCompression
          setTemporalCompression(headerTemporalCompression)
          if (typeof header.gen_ms === 'number') {
            frameGenMsRef.current = header.gen_ms
            setGenTime(Math.round(header.gen_ms))
          }
          frameIdRef.current = (header.frame_id as number) ?? 0
          // First display frame of each latent pass: update latent gen stats and GPU metrics
          if ((frameIdRef.current - 1) % headerTemporalCompression === 0) {
            if (typeof header.gen_ms === 'number') {
              setLatentGenMs(Math.round(header.gen_ms))
            }
            const runtime: RuntimeMetrics = {
              vramUsedBytes: (header.vram_used_bytes as number) ?? -1,
              gpuUtilPercent: (header.gpu_util_percent as number) ?? -1,
              profile:
                header.t_infer_ms != null
                  ? {
                      inferMs: header.t_infer_ms as number,
                      syncMs: header.t_sync_ms as number,
                      encMs: header.t_enc_ms as number,
                      metricsMs: header.t_metrics_ms as number,
                      overheadMs: (header.t_overhead_ms as number) ?? 0
                    }
                  : null
            }
            setConnection((prev) => ({ ...prev, runtime }))
          }
          setFrame(imageBlob)
          setHasRealFrame(true)
          setFrameId(frameIdRef.current)
          if (typeof header.client_ts === 'number' && (header.client_ts as number) > 0) {
            setInputLatency(Math.round(performance.now() - (header.client_ts as number)))
          }
          return
        }

        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>

          // Let RPC client consume response messages first
          if (rpc.handleMessage(msg)) return

          switch (msg.type) {
            case 'status': {
              const stageId = typeof msg.stage === 'string' ? msg.stage : null
              if (stageId) {
                setStatusStage(stageId as StageId)
              }
              if (stageId === 'session.ready') {
                setIsReady(true)
                isReadyRef.current = true
              }
              break
            }
            case 'stats': {
              if (typeof msg.gentime === 'number') {
                setGenTime(Math.round(msg.gentime))
              }
              if (typeof msg.frame === 'number') {
                setFrameId(msg.frame)
              }
              break
            }
            case 'log': {
              appendLog(stripAnsi(String(msg.line ?? '')))
              break
            }
            case 'error': {
              setError(resolveServerMessage(msg, 'app.server.fallbackError'))
              setConnectionState('error')
              const snapshot = msg.snapshot as ServerErrorSnapshot | undefined
              if (snapshot) {
                setConnection((prev) => ({ ...prev, lastErrorSnapshot: snapshot }))
              }
              break
            }
            case 'system_info': {
              // Early push from server at connect time — arrives before init so
              // the hardware identity is available even if the session crashes
              // during model load / CUDA warmup.
              const { type: _, ...info } = msg
              setConnection((prev) => ({ ...prev, systemInfo: info as unknown as ServerSystemInfo }))
              break
            }
            case 'warning':
              break
            default:
              log.debug('Message:', msg.type, msg)
          }
        } catch (err) {
          log.error('Failed to parse message:', err)
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
        // server was in its init flow (e.g. "session.inpainting_load") when it
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

  const sendControl = useCallback((buttons: ServerCode[] = [], mouseDx = 0, mouseDy = 0) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const ts = performance.now()
      wsRef.current.send(JSON.stringify({ type: 'control', buttons, mouse_dx: mouseDx, mouse_dy: mouseDy, ts }))
      lastControlTsRef.current = ts
      return true
    }
    return false
  }, [])

  const sendPause = useCallback((paused: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: paused ? 'pause' : 'resume' }))
    }
  }, [])

  const sendInit = useCallback((params: Omit<InitMessage, 'type' | 'req_id'>): Promise<InitResponse> => {
    // No timeout — init can take minutes (model download, warmup, CUDA compilation).
    // The WebSocket close event will reject the promise if the connection drops.
    return rpcRef.current.request<InitResponse>('init', params, 0)
  }, [])

  const applyInitResponse = useCallback((metrics: InitResponse) => {
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
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reset' }))
    }
  }, [])

  const request = useCallback(
    <T = unknown>(type: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> => {
      return rpcRef.current.request<T>(type, params, timeoutMs)
    },
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
