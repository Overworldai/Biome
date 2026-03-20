import { useState, useEffect, useRef, useCallback } from 'react'
import stripAnsi from 'strip-ansi'
import { createLogger } from '../utils/logger'
import { WsRpcClient } from '../lib/wsRpc'
import type { StageId } from '../stages'

const log = createLogger('WebSocket')
const MAX_VISIBLE_LOG_LINES = 500

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export type ServerMetrics = {
  isMultiframe: boolean
  vramUsedMb: number
  vramTotalMb: number
  vramPercent: number
  gpuUtilPercent: number
  gpuName: string | null
  cpuName: string | null
  model: string
}

type WebSocketHook = {
  connectionState: ConnectionState
  statusStage: StageId | null
  error: string | null
  warning: string | null
  frame: Blob | string | null
  hasRealFrame: boolean
  frameId: number
  genTime: number | null
  latentGenMs: number | null
  frameGenMsRef: { current: number }
  frameNFramesRef: { current: number }
  frameIdRef: { current: number }
  serverMetrics: ServerMetrics | null
  inputLatency: number | null
  logs: string[]
  allLogs: string[]
  connect: (endpointUrl: string) => void
  disconnect: () => void
  sendControl: (buttons?: string[], mouseDx?: number, mouseDy?: number) => boolean
  sendPause: (paused: boolean) => void
  sendPrompt: (prompt: string) => void
  sendPromptWithSeed: (promptOrFilename: string, seedUrl?: string) => void
  sendInitialSeed: (filename: string) => void
  sendModel: (model: string, seed?: string | null) => void
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
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
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
  const frameNFramesRef = useRef<number>(1)
  const frameIdRef = useRef<number>(0)
  const staticMetricsRef = useRef<{ gpuName: string | null; cpuName: string | null; model: string }>({
    gpuName: null,
    cpuName: null,
    model: ''
  })
  const rpcRef = useRef(new WsRpcClient())
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearWarningTimer = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current)
      warningTimerRef.current = null
    }
  }, [])

  const pushWarning = useCallback(
    (message: string) => {
      setWarning(message)
      clearWarningTimer()
      warningTimerRef.current = setTimeout(() => {
        setWarning(null)
        warningTimerRef.current = null
      }, 3500)
    },
    [clearWarningTimer]
  )

  const clearLogs = useCallback(() => {
    allLogsRef.current = []
    setLogs([])
  }, [])

  const connect = useCallback((endpointUrl: string) => {
    if (isConnectingRef.current || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) {
      return
    }

    if (!endpointUrl) {
      setError('No endpoint URL provided')
      return
    }

    isConnectingRef.current = true
    setConnectionState('connecting')
    setError(null)
    setWarning(null)
    clearWarningTimer()
    setStatusStage(null)
    setHasRealFrame(false)
    allLogsRef.current = []
    setLogs([])

    let wsUrl: string
    if (endpointUrl.startsWith('ws://') || endpointUrl.startsWith('wss://')) {
      wsUrl = endpointUrl.includes('/ws') ? endpointUrl : `${endpointUrl}/ws`
    } else {
      wsUrl = `ws://${endpointUrl}/ws`
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch (err) {
      isConnectingRef.current = false
      setConnectionState('error')
      setError(err instanceof Error ? err.message : 'Failed to create WebSocket connection')
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

        // Binary RPC response (e.g. seeds_image, seeds_thumbnail)
        if (header.req_id != null) {
          rpc.handleBinaryResponse(header, imageBlob)
          return
        }

        // Binary frame
        const nFrames = (header.n_frames as number) ?? 1
        frameNFramesRef.current = nFrames
        if (typeof header.gen_ms === 'number') {
          frameGenMsRef.current = header.gen_ms
          setGenTime(Math.round(header.gen_ms))
        }
        frameIdRef.current = (header.frame_id as number) ?? 0
        // First display frame of each latent pass: update latent gen stats and GPU metrics
        if ((frameIdRef.current - 1) % nFrames === 0) {
          if (typeof header.gen_ms === 'number') {
            setLatentGenMs(Math.round(header.gen_ms))
          }
          // GPU metrics from frame header
          setServerMetrics({
            ...staticMetricsRef.current,
            isMultiframe: nFrames > 1,
            vramUsedMb: (header.vram_used_mb as number) ?? -1,
            vramTotalMb: (header.vram_total_mb as number) ?? -1,
            vramPercent: (header.vram_percent as number) ?? -1,
            gpuUtilPercent: (header.gpu_util_percent as number) ?? -1
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
          case 'metrics': {
            // Initial static session info sent once at connection start
            staticMetricsRef.current = {
              gpuName: (msg.gpu_name as string | null) ?? null,
              cpuName: (msg.cpu_name as string | null) ?? null,
              model: (msg.model as string) ?? ''
            }
            setServerMetrics({
              ...staticMetricsRef.current,
              isMultiframe: !!msg.is_multiframe,
              vramUsedMb: (msg.vram_used_mb as number) ?? -1,
              vramTotalMb: (msg.vram_total_mb as number) ?? -1,
              vramPercent: (msg.vram_percent as number) ?? -1,
              gpuUtilPercent: (msg.gpu_util_percent as number) ?? -1
            })
            break
          }
          case 'log': {
            const line = stripAnsi(String(msg.line ?? ''))
            allLogsRef.current = [...allLogsRef.current, line]
            setLogs((prev) => {
              const next = [...prev, line]
              return next.length > MAX_VISIBLE_LOG_LINES ? next.slice(-MAX_VISIBLE_LOG_LINES) : next
            })
            break
          }
          case 'error': {
            setError((msg.message as string) ?? 'Server error')
            setWarning(null)
            clearWarningTimer()
            setConnectionState('error')
            break
          }
          case 'warning': {
            const warningMessage = (msg.message as string) ?? 'Server warning'
            pushWarning(warningMessage)
            break
          }
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
      setError('WebSocket error')
      setConnectionState('error')
    }

    ws.onclose = () => {
      if (wsRef.current !== ws) return
      isConnectingRef.current = false
      rpc.detach()
      wsRef.current = null
      setConnectionState('disconnected')
      setIsReady(false)
      setWarning(null)
      clearWarningTimer()
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
    setWarning(null)
    clearWarningTimer()
    setFrame(null)
    setFrameId(0)
    setError(null)
    setGenTime(null)
    setServerMetrics(null)
    setInputLatency(null)
    setStatusStage(null)
    setHasRealFrame(false)
  }, [clearWarningTimer])

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

  const sendPrompt = useCallback((prompt: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'prompt', prompt }))
    }
  }, [])

  const sendPromptWithSeed = useCallback((promptOrFilename: string, seedUrl?: string) => {
    if (!(wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) return

    if (seedUrl) {
      wsRef.current.send(
        JSON.stringify({
          type: 'prompt_with_seed',
          prompt: promptOrFilename,
          seed_image_url: seedUrl
        })
      )
      return
    }

    wsRef.current.send(JSON.stringify({ type: 'prompt_with_seed', filename: promptOrFilename }))
  }, [])

  const sendInitialSeed = useCallback((filename: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_initial_seed', filename }))
    }
  }, [])

  const sendModel = useCallback((model: string, seed: string | null = null) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && model) {
      const payload: { type: 'set_model'; model: string; seed?: string } = { type: 'set_model', model }
      if (seed) payload.seed = seed
      wsRef.current.send(JSON.stringify(payload))
    }
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
      clearWarningTimer()
    }
  }, [disconnect, clearWarningTimer])

  return {
    connectionState,
    statusStage,
    error,
    warning,
    frame,
    hasRealFrame,
    frameId,
    genTime,
    latentGenMs,
    frameGenMsRef,
    frameNFramesRef,
    frameIdRef,
    serverMetrics,
    inputLatency,
    logs,
    allLogs: allLogsRef.current,
    connect,
    disconnect,
    sendControl,
    sendPause,
    sendPrompt,
    sendPromptWithSeed,
    sendInitialSeed,
    sendModel,
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
