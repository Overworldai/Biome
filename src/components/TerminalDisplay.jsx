import { useState, useEffect, useRef, useCallback } from 'react'
import { usePortal } from '../context/PortalContext'
import { useStreaming } from '../context/StreamingContextShared'
import useConfig from '../hooks/useConfig'

// Display text for portal states
const stateMessages = {
  cold: 'ENTER URL:',
  warm: 'CONNECTING...',
  hot: 'CONNECTED',
  streaming: 'STREAMING'
}

// Error messages for user feedback
const errorMessages = {
  invalid_url: 'INVALID URL',
  connection_failed: 'CONNECTION FAILED - CHECK NETWORK'
}

// Map server status codes to display text
const statusCodeMessages = {
  warmup: 'WARMING UP...',
  init: 'INITIALIZING ENGINE...',
  loading: 'LOADING WORLD...',
  ready: 'READY',
  reset: 'RESETTING...'
}

// Truncate error message to first line, max 60 chars
const formatErrorMessage = (error) => {
  const firstLine = error.split('\n')[0].slice(0, 60)
  return firstLine.length < error.split('\n')[0].length ? firstLine + '...' : firstLine
}

const TerminalDisplay = () => {
  const { state, states, transitionTo, onStateChange } = usePortal()
  const { statusCode, setEndpointUrl, engineError, clearEngineError } = useStreaming()
  const { config, saveGpuServerUrl } = useConfig()

  const defaultUrl = `${config.gpu_server.host}:${config.gpu_server.port}`
  const [displayText, setDisplayText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [inputValue, setInputValue] = useState(defaultUrl)
  const [error, setError] = useState(null)
  const [showEngineError, setShowEngineError] = useState(false)
  const [showPlaceholder, setShowPlaceholder] = useState(false)

  const timeoutRef = useRef(null)
  const currentMessageRef = useRef('')
  const displayTextRef = useRef('')
  const containerRef = useRef(null)
  const hasBeenVisible = useRef(false)
  const pendingMessageRef = useRef(null)

  // Keep ref in sync with state for deleteMessage to use
  useEffect(() => {
    displayTextRef.current = displayText
  }, [displayText])

  // Sync inputValue with config when it changes
  useEffect(() => {
    setInputValue(defaultUrl)
  }, [defaultUrl])

  const clearAnimationTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const typeMessage = useCallback((message, speed = 30) => {
    clearAnimationTimeout()
    setIsTyping(true)
    setDisplayText('')
    let currentIndex = 0

    const type = () => {
      if (currentIndex < message.length) {
        currentIndex++
        setDisplayText(message.slice(0, currentIndex))
        timeoutRef.current = setTimeout(type, speed)
      } else {
        setIsTyping(false)
        currentMessageRef.current = message
        // Show input area after "ENTER URL:" finishes typing
        if (message === stateMessages.cold) {
          setShowPlaceholder(true)
          setTimeout(() => {
            document.getElementById('terminal-input')?.focus()
          }, 1500)
        }
      }
    }

    timeoutRef.current = setTimeout(type, speed)
  }, [clearAnimationTimeout])

  const deleteMessage = useCallback((onComplete, speed = 20) => {
    clearAnimationTimeout()
    setIsDeleting(true)
    setShowPlaceholder(false)
    let currentText = displayTextRef.current

    const deleteChar = () => {
      if (currentText.length > 0) {
        currentText = currentText.slice(0, -1)
        setDisplayText(currentText)
        timeoutRef.current = setTimeout(deleteChar, speed)
      } else {
        setIsDeleting(false)
        currentMessageRef.current = ''
        onComplete()
      }
    }

    deleteChar()
  }, [clearAnimationTimeout])

  // Transition message with delete-then-type animation
  const transitionMessage = useCallback((newMessage) => {
    if (currentMessageRef.current === newMessage) return

    if (currentMessageRef.current) {
      deleteMessage(() => typeMessage(newMessage))
    } else if (!hasBeenVisible.current) {
      pendingMessageRef.current = newMessage
    } else {
      typeMessage(newMessage)
    }
  }, [deleteMessage, typeMessage])

  // Watch for fade-in animation completion to trigger initial typing
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleAnimationEnd = (e) => {
      if (e.animationName === 'contentFadeIn' && !hasBeenVisible.current) {
        hasBeenVisible.current = true
        if (pendingMessageRef.current) {
          typeMessage(pendingMessageRef.current)
          pendingMessageRef.current = null
        }
      }
    }

    el.addEventListener('animationend', handleAnimationEnd)
    return () => el.removeEventListener('animationend', handleAnimationEnd)
  }, [typeMessage])

  // Handle engine errors from context
  useEffect(() => {
    if (engineError && state === 'cold' && !showEngineError) {
      setShowEngineError(true)
      const errorMsg = formatErrorMessage(engineError).toUpperCase()
      deleteMessage(() => typeMessage(errorMsg))

      // Auto-clear engine error after 3 seconds and return to normal message
      const timeout = setTimeout(() => {
        clearEngineError?.()
        setShowEngineError(false)
        deleteMessage(() => typeMessage(stateMessages.cold))
      }, 3000)

      return () => clearTimeout(timeout)
    }
  }, [engineError, state, showEngineError, clearEngineError, deleteMessage, typeMessage])

  // Handle state/status changes
  useEffect(() => {
    // Show local error message (invalid URL etc)
    if (error && state === 'cold') {
      const errorMsg = errorMessages[error] || 'ERROR'
      if (currentMessageRef.current !== errorMsg) {
        deleteMessage(() => {
          typeMessage(errorMsg)
          setTimeout(() => setError(null), 2000)
        })
      }
      return
    }

    // Don't update message while showing engine error
    if (showEngineError) return

    // Determine new message based on state and status code
    const newMessage = (state === 'warm' && statusCode)
      ? (statusCodeMessages[statusCode] || stateMessages.warm)
      : (stateMessages[state] || '')

    transitionMessage(newMessage)

    return clearAnimationTimeout
  }, [state, statusCode, error, showEngineError, deleteMessage, typeMessage, transitionMessage, clearAnimationTimeout])

  // Reset input when returning to cold state
  useEffect(() => {
    return onStateChange((newState) => {
      if (newState === states.COLD) {
        setInputValue(defaultUrl)
      }
      setError(null)
    })
  }, [onStateChange, states.COLD, defaultUrl])

  const handleInputChange = (e) => {
    setInputValue(e.target.value)
    if (error) setError(null)
    // Clear engine error when user starts typing
    if (showEngineError && clearEngineError) {
      clearEngineError()
      setShowEngineError(false)
    }
  }

  // Validate URL format
  const isValidUrl = (url) => {
    const trimmed = url.trim()
    // Accept formats like: localhost:8080, 192.168.1.100:8080, ws://localhost:8080/ws
    return /^(ws:\/\/|wss:\/\/)?[\w.-]+(:\d+)?(\/\S*)?$/.test(trimmed)
  }

  const handleConnect = useCallback(async () => {
    if (state !== states.COLD) return

    const urlToUse = inputValue.trim()
    if (!urlToUse || !isValidUrl(urlToUse)) {
      setError('invalid_url')
      return
    }

    await saveGpuServerUrl(urlToUse)
    setEndpointUrl(urlToUse)
    transitionTo(states.WARM)
  }, [state, states.COLD, states.WARM, inputValue, saveGpuServerUrl, setEndpointUrl, transitionTo])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleConnect()
  }

  // Global Enter key handler
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Enter' && state === states.COLD && showPlaceholder && inputValue.trim()) {
        if (document.activeElement?.id === 'terminal-input') return
        handleConnect()
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [state, states.COLD, showPlaceholder, inputValue, handleConnect])

  const hasError = error || showEngineError

  return (
    <div ref={containerRef} className={`terminal-display state-${state}`}>
      {/* Loading indicator */}
      <div className="terminal-progress">
        <div className="progress-bar-wrapper">
          <span className="progress-bracket">[</span>
          <div className="progress-track">
            <div className="progress-scanner" />
          </div>
          <span className="progress-bracket">]</span>
        </div>
      </div>

      {/* Terminal status */}
      <div
        className="terminal-status"
        id="terminal-status"
        onClick={() => document.getElementById('terminal-input')?.focus()}
      >
        <span className="terminal-prompt">&gt;</span>
        <span
          className={`terminal-text ${isTyping ? 'typing' : ''} ${isDeleting ? 'deleting' : ''} ${hasError ? 'error' : ''}`}
          id="terminal-text"
        >
          {displayText}
        </span>
        <span className={`input-wrapper ${showPlaceholder ? 'show-input' : ''}`}>
          <input
            type="text"
            className="terminal-input"
            id="terminal-input"
            autoComplete="off"
            spellCheck="false"
            placeholder=""
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          <span className="input-cursor"></span>
        </span>
      </div>

      {/* Enter hint */}
      <div className={`terminal-hint ${showPlaceholder ? 'show' : ''}`}>
        Press Enter to connect
      </div>
    </div>
  )
}

export default TerminalDisplay
