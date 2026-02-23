import { useState, useEffect, useRef, useCallback } from 'react'
import { createLogger } from '../utils/logger'

const log = createLogger('WebSocket')

export const useWebSocket = () => {
  const [connectionState, setConnectionState] = useState('disconnected')
  const [frame, setFrame] = useState(null)
  const [frameId, setFrameId] = useState(0)
  const [error, setError] = useState(null)
  const [genTime, setGenTime] = useState(null)
  const [isReady, setIsReady] = useState(false)
  const [statusCode, setStatusCode] = useState(null)

  const wsRef = useRef(null)
  const isConnectingRef = useRef(false)
  const isReadyRef = useRef(false)

  // Connect directly to a local WebSocket server
  // endpointUrl can be: "localhost:8080", "ws://localhost:8080", "ws://localhost:8080/ws"
  const connect = useCallback((endpointUrl) => {
    if (isConnectingRef.current || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) {
      return
    }

    if (!endpointUrl) {
      log.error('No endpoint URL provided')
      setError('No endpoint URL provided')
      return
    }

    isConnectingRef.current = true
    setConnectionState('connecting')
    setError(null)
    setStatusCode(null)

    // Build WebSocket URL from endpoint
    let wsUrl
    if (endpointUrl.startsWith('ws://') || endpointUrl.startsWith('wss://')) {
      // Already a full WebSocket URL
      wsUrl = endpointUrl.includes('/ws') ? endpointUrl : `${endpointUrl}/ws`
    } else {
      // Just host:port, add ws:// prefix and /ws path
      wsUrl = `ws://${endpointUrl}/ws`
    }

    log.info('Connecting to', wsUrl)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      if (wsRef.current !== ws) return
      isConnectingRef.current = false
      setConnectionState('connected')
      log.info('Connected to', wsUrl)
    }

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return
      try {
        const msg = JSON.parse(event.data)

        switch (msg.type) {
          case 'status':
            // Server sends: {"type": "status", "code": "init|loading|ready|reset|warmup"}
            const code = msg.code || msg.status || msg.message
            log.info('Status:', code)
            setStatusCode(code)
            // Only mark as ready when server explicitly says "ready"
            if (code === 'ready') {
              setIsReady(true)
              isReadyRef.current = true
              log.info('Server ready - enabling input')
            }
            break

          case 'frame':
            setFrame(msg.data)
            setFrameId(msg.frame_id)
            if (msg.gen_ms) {
              setGenTime(Math.round(msg.gen_ms))
            }
            break

          case 'stats':
            // Handle stats messages
            if (msg.gentime !== undefined) {
              setGenTime(Math.round(msg.gentime))
            }
            if (msg.frame !== undefined) {
              setFrameId(msg.frame)
            }
            break

          case 'error':
            log.error('Server error:', msg.message)
            setError(msg.message)
            setConnectionState('error')
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
      log.error('Connection error')
      isConnectingRef.current = false
      setError('WebSocket error')
      setConnectionState('error')
    }

    ws.onclose = () => {
      if (wsRef.current !== ws) return
      log.info('Disconnected')
      isConnectingRef.current = false
      wsRef.current = null
      setConnectionState('disconnected')
      setIsReady(false)
      setStatusCode(null)
      setFrame(null)
      setFrameId(0)
      setGenTime(null)
    }
  }, [])

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setConnectionState('disconnected')
    setIsReady(false)
    isReadyRef.current = false
    setFrame(null)
    setFrameId(0)
    setError(null)
    setGenTime(null)
    setStatusCode(null)
  }, [])

  const sendControl = useCallback((buttons = [], mouseDx = 0, mouseDy = 0) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'control',
          buttons,
          mouse_dx: mouseDx,
          mouse_dy: mouseDy
        })
      )
      return true
    }
    return false
  }, [])

  const sendPause = useCallback((paused) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: paused ? 'pause' : 'resume' }))
      log.info(paused ? 'Paused' : 'Resumed')
    }
  }, [])

  const sendPrompt = useCallback((prompt) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'prompt', prompt }))
      log.info('Prompt sent:', prompt)
    }
  }, [])

  const sendPromptWithSeed = useCallback((filename) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'prompt_with_seed', filename }))
      log.info('Prompt with seed sent:', filename)
    }
  }, [])

  const sendInitialSeed = useCallback((filename) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_initial_seed', filename }))
      log.info('Initial seed sent:', filename)
    }
  }, [])

  const sendModel = useCallback((model, seed = null) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && model) {
      const payload = { type: 'set_model', model }
      if (seed) payload.seed = seed
      wsRef.current.send(JSON.stringify(payload))
      log.info('Model sent:', model, seed ? `(with seed: ${seed})` : '')
    }
  }, [])

  const reset = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reset' }))
      log.info('Reset sent')
    }
  }, [])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    connectionState,
    statusCode,
    error,
    frame,
    frameId,
    genTime,
    connect,
    disconnect,
    sendControl,
    sendPause,
    sendPrompt,
    sendPromptWithSeed,
    sendInitialSeed,
    sendModel,
    reset,
    isConnected: connectionState === 'connected',
    isReady,
    isLoading: connectionState === 'connecting' || (connectionState === 'connected' && !isReady)
  }
}

export default useWebSocket
