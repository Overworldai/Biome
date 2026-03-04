import { useState, useEffect, useRef, useCallback } from 'react'
import { createLogger } from '../utils/logger'
import { WsRpcClient } from '../lib/wsRpc'
import type { LoadingStage } from '../types/app'

const log = createLogger('WebSocket')

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

type WebSocketHook = {
  connectionState: ConnectionState
  statusCode: string | null
  statusStage: LoadingStage | null
  error: string | null
  warning: string | null
  frame: string | null
  hasRealFrame: boolean
  frameId: number
  genTime: number | null
  logs: string[]
  connect: (endpointUrl: string) => void
  disconnect: () => void
  sendControl: (buttons?: string[], mouseDx?: number, mouseDy?: number) => boolean
  sendPause: (paused: boolean) => void
  sendPrompt: (prompt: string) => void
  sendPromptWithSeed: (promptOrFilename: string, seedUrl?: string) => void
  sendInitialSeed: (filename: string) => void
  sendModel: (model: string, seed?: string | null) => void
  setPlaceholderFrame: (dataUrl: string | null) => void
  reset: () => void
  request: <T = unknown>(type: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
  clearLogs: () => void
  isConnected: boolean
  isReady: boolean
  isLoading: boolean
}

export const useWebSocket = (): WebSocketHook => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [frame, setFrame] = useState<string | null>(null)
  const [frameId, setFrameId] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [genTime, setGenTime] = useState<number | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [statusCode, setStatusCode] = useState<string | null>(null)
  const [statusStage, setStatusStage] = useState<LoadingStage | null>(null)
  const [hasRealFrame, setHasRealFrame] = useState(false)
  const [logs, setLogs] = useState<string[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const isConnectingRef = useRef(false)
  const isReadyRef = useRef(false)
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
    setStatusCode(null)
    setStatusStage(null)
    setHasRealFrame(false)
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

    ws.onmessage = (event: MessageEvent<string>) => {
      if (wsRef.current !== ws) return
      try {
        const msg = JSON.parse(event.data) as Record<string, unknown>

        // Let RPC client consume response messages first
        if (rpc.handleMessage(msg)) return

        switch (msg.type) {
          case 'status': {
            const code = (typeof msg.code === 'string' ? msg.code : null) as string | null
            setStatusCode(code)
            const rawStage = msg.stage as Partial<LoadingStage> | undefined
            if (
              rawStage &&
              typeof rawStage.id === 'string' &&
              typeof rawStage.label === 'string' &&
              typeof rawStage.percent === 'number'
            ) {
              setStatusStage({
                id: rawStage.id,
                label: rawStage.label,
                percent: Math.max(0, Math.min(100, Math.round(rawStage.percent)))
              })
            }
            if (code === 'ready') {
              setIsReady(true)
              isReadyRef.current = true
            }
            break
          }
          case 'frame': {
            setFrame((msg.data as string) ?? null)
            setHasRealFrame(true)
            setFrameId((msg.frame_id as number) ?? 0)
            if (typeof msg.gen_ms === 'number') {
              setGenTime(Math.round(msg.gen_ms))
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
            const line = String(msg.line ?? '')
            setLogs((prev) => [...prev, line])
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
      setStatusCode(null)
      setStatusStage(null)
      setFrame(null)
      setHasRealFrame(false)
      setFrameId(0)
      setGenTime(null)
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
    setStatusCode(null)
    setStatusStage(null)
    setHasRealFrame(false)
  }, [clearWarningTimer])

  const sendControl = useCallback((buttons: string[] = [], mouseDx = 0, mouseDy = 0) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'control', buttons, mouse_dx: mouseDx, mouse_dy: mouseDy }))
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

  const setPlaceholderFrame = useCallback((dataUrl: string | null) => {
    setFrame(dataUrl)
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
    statusCode,
    statusStage,
    error,
    warning,
    frame,
    hasRealFrame,
    frameId,
    genTime,
    logs,
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
