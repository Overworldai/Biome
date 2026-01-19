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

const TerminalDisplay = () => {
  const { state, states, transitionTo, onStateChange } = usePortal()
  const { statusCode, setEndpointUrl } = useStreaming()
  const { config, saveGpuServerUrl } = useConfig()

  // Build default URL from config
  const defaultUrl = `${config.gpu_server.host}:${config.gpu_server.port}`
  const [displayText, setDisplayText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [inputValue, setInputValue] = useState(defaultUrl)
  const [error, setError] = useState(null)
  const [showPlaceholder, setShowPlaceholder] = useState(false)
  const timeoutRef = useRef(null)
  const currentMessageRef = useRef('')
  const displayTextRef = useRef('')
  const containerRef = useRef(null)
  const hasBeenVisible = useRef(false)
  const pendingMessageRef = useRef(null)

  // Keep ref in sync with state
  useEffect(() => {
    displayTextRef.current = displayText
  }, [displayText])

  // Sync inputValue with config when it changes
  useEffect(() => {
    setInputValue(defaultUrl)
  }, [defaultUrl])

  const typeMessage = (message, speed = 30) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
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
        // Delay focus so user sees the blinking cursor animation first
        if (message === stateMessages.cold) {
          setShowPlaceholder(true)
          setTimeout(() => {
            document.getElementById('terminal-input')?.focus()
          }, 1500)
        }
      }
    }

    timeoutRef.current = setTimeout(type, speed)
  }

  const deleteMessage = (onComplete, speed = 20) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
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
  }

  // Watch for fade-in animation completion to trigger initial typing
  useEffect(() => {
    if (!containerRef.current) return

    const handleAnimationEnd = (e) => {
      if (e.animationName === 'contentFadeIn' && !hasBeenVisible.current) {
        hasBeenVisible.current = true
        if (pendingMessageRef.current) {
          typeMessage(pendingMessageRef.current)
          pendingMessageRef.current = null
        }
      }
    }

    containerRef.current.addEventListener('animationend', handleAnimationEnd)
    const el = containerRef.current
    return () => el.removeEventListener('animationend', handleAnimationEnd)
  }, [])

  useEffect(() => {
    // Show error message if there's an error
    if (error && state === 'cold') {
      const errorMsg = errorMessages[error] || 'ERROR'
      if (currentMessageRef.current !== errorMsg) {
        deleteMessage(() => {
          typeMessage(errorMsg)
          // Clear error and show ENTER URL again after 2 seconds
          setTimeout(() => {
            setError(null)
          }, 2000)
        })
      }
      return
    }

    // During WARM state, use server status code if available
    let newMessage
    if (state === 'warm' && statusCode) {
      newMessage = statusCodeMessages[statusCode] || stateMessages.warm
    } else {
      newMessage = stateMessages[state] || ''
    }

    // Skip if already showing this message
    if (currentMessageRef.current === newMessage) {
      return
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // If there's existing text, delete it first before typing new message
    if (currentMessageRef.current) {
      deleteMessage(() => {
        typeMessage(newMessage)
      })
    } else if (!hasBeenVisible.current) {
      pendingMessageRef.current = newMessage
    } else {
      typeMessage(newMessage)
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [state, statusCode, error])

  useEffect(() => {
    return onStateChange((newState) => {
      // Reset to default URL when returning to cold state
      if (newState === states.COLD) {
        setInputValue(defaultUrl)
      }
      setError(null)
    })
  }, [onStateChange, states.COLD, defaultUrl])

  const handleInputChange = (e) => {
    setInputValue(e.target.value)
    // Clear any error when user starts typing
    if (error) {
      setError(null)
    }
  }

  // Validate URL format
  const isValidUrl = (url) => {
    const trimmed = url.trim()
    // Accept formats like: localhost:8080, 192.168.1.100:8080, ws://localhost:8080/ws
    const urlPattern = /^(ws:\/\/|wss:\/\/)?[\w.-]+(:\d+)?(\/\S*)?$/
    return urlPattern.test(trimmed)
  }

  // Connect to the server with the current URL
  const handleConnect = useCallback(async () => {
    if (state !== states.COLD) return

    const urlToUse = inputValue.trim()
    if (!urlToUse || !isValidUrl(urlToUse)) {
      setError('invalid_url')
      return
    }

    // Save URL to config
    await saveGpuServerUrl(urlToUse)

    setEndpointUrl(urlToUse)
    transitionTo(states.WARM)
  }, [state, states.COLD, inputValue, saveGpuServerUrl, setEndpointUrl, transitionTo])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleConnect()
    }
  }

  // Global Enter key handler - connect if URL is present and input is shown
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Enter' && state === states.COLD && showPlaceholder && inputValue.trim()) {
        // Don't double-trigger if input is focused
        if (document.activeElement?.id === 'terminal-input') return
        handleConnect()
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [state, states.COLD, showPlaceholder, inputValue, handleConnect])

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
          className={`terminal-text ${isTyping ? 'typing' : ''} ${isDeleting ? 'deleting' : ''} ${error ? 'error' : ''}`}
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
