import { useState, useEffect, useRef, useCallback } from 'react'
import { usePortal } from '../context/PortalContext'
import { useStreaming } from '../context/StreamingContextShared'
import { useConfig, STANDALONE_PORT, ENGINE_MODES } from '../hooks/useConfig'
import EngineModeChoice from './EngineModeChoice'

// Display text for portal states
const stateMessages = {
  cold: 'ENTER URL:',
  cold_standalone: 'PRESS ENTER',
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
  const { statusCode, setEndpointUrl, engineError, clearEngineError, cancelConnection, handleModeChoice } =
    useStreaming()
  const { config, saveGpuServerUrl, engineMode, isEngineUnchosen, isStandaloneMode, isServerMode } = useConfig()

  // For backwards compatibility: treat unchosen as standalone for URL purposes
  const useStandaloneEngine = isStandaloneMode || isEngineUnchosen
  const defaultUrl = useStandaloneEngine
    ? `localhost:${STANDALONE_PORT}`
    : `${config?.gpu_server?.host || 'localhost'}:${config?.gpu_server?.port || STANDALONE_PORT}`
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
  const lastStateRef = useRef(state)

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

  const typeMessage = useCallback(
    (message, speed = 30) => {
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
          // Show input area after "ENTER URL:" finishes typing (only for non-standalone mode)
          if (message === stateMessages.cold) {
            setShowPlaceholder(true)
            setTimeout(() => {
              document.getElementById('terminal-input')?.focus()
            }, 1500)
          } else if (message === stateMessages.cold_standalone) {
            setShowPlaceholder(true)
          }
        }
      }

      timeoutRef.current = setTimeout(type, speed)
    },
    [clearAnimationTimeout]
  )

  const deleteMessage = useCallback(
    (onComplete, speed = 20) => {
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
    },
    [clearAnimationTimeout]
  )

  // Transition message with delete-then-type animation
  const transitionMessage = useCallback(
    (newMessage) => {
      if (currentMessageRef.current === newMessage) return

      if (currentMessageRef.current) {
        deleteMessage(() => typeMessage(newMessage))
      } else if (!hasBeenVisible.current) {
        pendingMessageRef.current = newMessage
      } else {
        typeMessage(newMessage)
      }
    },
    [deleteMessage, typeMessage]
  )

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

  // Handle state transitions - reset terminal when returning to cold
  useEffect(() => {
    const prevState = lastStateRef.current
    lastStateRef.current = state

    // When returning to cold from another state, reset everything
    if (prevState !== 'cold' && state === 'cold') {
      clearAnimationTimeout()
      setError(null)
      setInputValue(defaultUrl)
      currentMessageRef.current = ''
      const coldMessage = useStandaloneEngine ? stateMessages.cold_standalone : stateMessages.cold
      typeMessage(coldMessage)
      return
    }

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

    // Show engine error state
    if (engineError) {
      const errorMsg = 'ERROR'
      if (currentMessageRef.current !== errorMsg) {
        transitionMessage(errorMsg)
      }
      return
    }

    // Determine new message based on state and status code
    let newMessage
    if (state === 'warm' && statusCode) {
      newMessage = statusCodeMessages[statusCode] || stateMessages.warm
    } else if (state === 'cold' && useStandaloneEngine) {
      newMessage = stateMessages.cold_standalone
    } else {
      newMessage = stateMessages[state] || ''
    }

    transitionMessage(newMessage)

    return clearAnimationTimeout
  }, [
    state,
    statusCode,
    error,
    engineError,
    useStandaloneEngine,
    defaultUrl,
    deleteMessage,
    typeMessage,
    transitionMessage,
    clearAnimationTimeout
  ])

  // Reset state change listener
  useEffect(() => {
    return onStateChange((newState) => {
      if (newState === states.COLD) {
        setError(null)
      }
    })
  }, [onStateChange, states.COLD])

  const handleInputChange = (e) => {
    setInputValue(e.target.value)
    if (error) setError(null)
  }

  // Validate URL format
  const isValidUrl = (url) => {
    const trimmed = url.trim()
    return /^(ws:\/\/|wss:\/\/)?[\w.-]+(:\d+)?(\/\S*)?$/.test(trimmed)
  }

  const handleConnect = useCallback(async () => {
    if (state !== states.COLD) return

    // In standalone mode, just transition - StreamingContext handles the URL
    if (useStandaloneEngine) {
      transitionTo(states.WARM)
      return
    }

    const urlToUse = inputValue.trim()
    if (!urlToUse || !isValidUrl(urlToUse)) {
      setError('invalid_url')
      return
    }

    await saveGpuServerUrl(urlToUse)
    setEndpointUrl(urlToUse)
    transitionTo(states.WARM)
  }, [state, states.COLD, states.WARM, useStandaloneEngine, inputValue, saveGpuServerUrl, setEndpointUrl, transitionTo])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleConnect()
  }

  // Global Enter key handler
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // In standalone mode, just need showPlaceholder; otherwise also need inputValue
      const canConnect = useStandaloneEngine ? showPlaceholder : showPlaceholder && inputValue.trim()
      if (e.key === 'Enter' && state === states.COLD && canConnect) {
        if (document.activeElement?.id === 'terminal-input') return
        handleConnect()
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [state, states.COLD, showPlaceholder, useStandaloneEngine, inputValue, handleConnect])

  // Handle mode choice from dialog
  const onModeChosen = useCallback(
    (chosenMode) => {
      if (handleModeChoice) {
        handleModeChoice(chosenMode)
      }
    },
    [handleModeChoice]
  )

  // Show choice dialog for unchosen mode
  if (isEngineUnchosen && state === states.COLD) {
    return (
      <div ref={containerRef} className={`terminal-display state-${state}`}>
        <EngineModeChoice onChoiceMade={onModeChosen} />
      </div>
    )
  }

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
        onClick={() => (isStandaloneMode ? handleConnect() : document.getElementById('terminal-input')?.focus())}
      >
        <span className="terminal-prompt">&gt;</span>
        <span
          className={`terminal-text ${isTyping ? 'typing' : ''} ${isDeleting ? 'deleting' : ''} ${error || engineError ? 'error' : ''}`}
          id="terminal-text"
        >
          {displayText}
        </span>
        {isServerMode && (
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
        )}
      </div>

      {/* Enter hint - only shown in server mode */}
      {isServerMode && <div className={`terminal-hint ${showPlaceholder ? 'show' : ''}`}>Press Enter to connect</div>}

      {/* Cancel button - shown during WARM state */}
      {state === states.WARM && (
        <button className="terminal-cancel-btn" onClick={cancelConnection}>
          CANCEL
        </button>
      )}
    </div>
  )
}

export default TerminalDisplay
