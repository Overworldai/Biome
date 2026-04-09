import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import stripAnsi from 'strip-ansi'
import { createLogger } from '../utils/logger'
import { WsRpcClient } from '../lib/wsRpc'
import type { StageId } from '../stages'
import { toWebSocketUrl } from '../utils/serverUrl'
import type { TranslationKey } from '../i18n'
import type { InitMessage, InitResponse } from '../types/ws'

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

export type ServerMetrics = {
  isMultiframe: boolean
  vramUsedMb: number
  vramTotalMb: number
  vramPercent: number
  gpuUtilPercent: number
  gpuName: string | null
  cpuName: string | null
  model: string
  inferenceFps: number
  profile: FrameProfile | null
}

type WebSocketHook = {
  connectionState: ConnectionState
  statusStage: StageId | null
  error: string | null
  frame: Blob | string | null
  hasRealFrame: boolean
  frameId: number
  genTime: number | null
  latentGenMs: number | null
  temporalCompression: number
  frameGenMsRef: { current: number }
  frameTemporalCompressionRef: { current: number }
  frameIdRef: { current: number }
  serverMetrics: ServerMetrics | null
  inputLatency: number | null
  logs: string[]
  allLogs: string[]
  connect: (endpointUrl: string) => void
  disconnect: () => void
  sendControl: (buttons?: string[], mouseDx?: number, mouseDy?: number) => boolean
  sendPause: (paused: boolean) => void
  sendInit: (params: Omit<InitMessage, 'type' | 'req_id'>) => Promise<InitResponse>
  setInitMetrics: (metrics: InitResponse) => void
  setPlaceholderFrame: (frame: Blob | string | null) => void
  reset: () => void
  request: <T = unknown>(type: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
  clearLogs: () => void
  isConnected: boolean
  isReady: boolean
  isLoading: boolean
}

export const useWebSocket = (): WebSocketHook => {
  const { t } = useTranslation()
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [frame, setFrame] = useState<Blob | string | null>(null)
  const [frameId, setFrameId] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [genTime, setGenTime] = useState<number | null>(null)
  const [latentGenMs, setLatentGenMs] = useState<number | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [statusStage, setStatusStage] = useState<StageId | null>(null)
  const [hasRealFrame, setHasRealFrame] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [serverMetrics, setServerMetrics] = useState<ServerMetrics | null>(null)
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
  const staticMetricsRef = useRef<{
    gpuName: string | null
    cpuName: string | null
    model: string
    inferenceFps: number
  }>({
    gpuName: null,
    cpuName: null,
    model: '',
    inferenceFps: 60
  })
  const rpcRef = useRef(new WsRpcClient())
  const resolveServerMessage = useCallback(
    (msg: Record<string, unknown>, fallbackKey: TranslationKey): string => {
      const messageId = msg.message_id as string | undefined
      const detail = msg.message as string | undefined
      if (messageId) {
        const key = messageId as TranslationKey
        const params = (msg.params as Record<string, string>) ?? {}
        const resolved = t(key, { defaultValue: '', ...params })
        if (resolved) return detail ? `${resolved}: ${detail}` : resolved
      }
      const message = detail ?? JSON.stringify(msg)
      return String(t(fallbackKey, { defaultValue: fallbackKey, message }))
    },
    [t]
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

  const connect = useCallback((endpointUrl: string) => {
    if (isConnectingRef.current || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) {
      return
    }

    if (!endpointUrl) {
      setError(t('app.server.noEndpointUrl'))
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
      setError(err instanceof Error ? err.message : t('app.server.invalidWebsocketEndpoint'))
      return
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch (err) {
      isConnectingRef.current = false
      setConnectionState('error')
      setError(err instanceof Error ? err.message : t('app.server.websocketConnectionFailed'))
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
          // GPU metrics from frame header
          setServerMetrics({
            ...staticMetricsRef.current,
            isMultiframe: headerTemporalCompression > 1,
            vramUsedMb: (header.vram_used_mb as number) ?? -1,
            vramTotalMb: (header.vram_total_mb as number) ?? -1,
            vramPercent: (header.vram_percent as number) ?? -1,
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
          })
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
      setError(t('app.server.websocketError'))
      setConnectionState('error')
    }

    ws.onclose = () => {
      if (wsRef.current !== ws) return
      isConnectingRef.current = false
      rpc.detach()
      wsRef.current = null
      setConnectionState('disconnected')
      setIsReady(false)
      setStatusStage(null)
      setFrame(null)
      setHasRealFrame(false)
      setFrameId(0)
      setGenTime(null)
      setLatentGenMs(null)
      setServerMetrics(null)
      setInputLatency(null)
    }
  }, [])

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
    setServerMetrics(null)
    setInputLatency(null)
    setStatusStage(null)
    setHasRealFrame(false)
  }, [])

  const sendControl = useCallback((buttons: string[] = [], mouseDx = 0, mouseDy = 0) => {
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

  const setInitMetrics = useCallback((metrics: InitResponse) => {
    staticMetricsRef.current = {
      gpuName: metrics.gpu_name ?? null,
      cpuName: metrics.cpu_name ?? null,
      model: metrics.model ?? '',
      inferenceFps: metrics.inference_fps ?? 60
    }
    setServerMetrics({
      ...staticMetricsRef.current,
      isMultiframe: false,
      vramUsedMb: -1,
      vramTotalMb: -1,
      vramPercent: -1,
      gpuUtilPercent: -1,
      profile: null
    })
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
    serverMetrics,
    inputLatency,
    logs,
    allLogs: allLogsRef.current,
    connect,
    disconnect,
    sendControl,
    sendPause,
    sendInit,
    setInitMetrics,
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
