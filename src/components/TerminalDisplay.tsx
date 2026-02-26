import { useMemo, useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { usePortal } from '../context/PortalContext'
import { useStreaming } from '../context/StreamingContext'
import { useConfig } from '../hooks/useConfig'
import EngineModeChoice from './EngineModeChoice'
import ServerLogDisplay from './ServerLogDisplay'
import type { EngineMode } from '../types/app'

const statusCodeMessages: Record<string, string> = {
  warmup: 'STARTING ENGINE...',
  init: 'INITIALIZING WORLD...',
  loading: 'READYING STREAM...',
  ready: 'READYING STREAM...',
  reset: 'RESETTING...'
}

const LOG_PANEL_MAX_HEIGHT_CQH = 34
const LOG_DRAG_RANGE_PX = 220

type TerminalDisplayProps = {
  onCancel?: () => void
}

const TerminalDisplay = ({ onCancel }: TerminalDisplayProps) => {
  const { state, states } = usePortal()
  const { connectionState, statusCode, engineError, error, cancelConnection, handleModeChoice } = useStreaming()
  const { isEngineUnchosen } = useConfig()
  const [logPanelProgress, setLogPanelProgress] = useState(0)
  const [isHandleDragging, setIsHandleDragging] = useState(false)
  const [lastLogLine, setLastLogLine] = useState('')
  const swipeStateRef = useRef<{ active: boolean; startY: number; startProgress: number; lastDeltaY: number }>({
    active: false,
    startY: 0,
    startProgress: 0,
    lastDeltaY: 0
  })

  useEffect(() => {
    let mounted = true
    let unlisten: (() => void) | undefined

    const setup = async () => {
      unlisten = await listen('server-log', (event) => {
        if (!mounted) return
        const line = String(event.payload ?? '').trim()
        if (line) {
          setLastLogLine(line)
        }
      })
    }

    setup()
    return () => {
      mounted = false
      if (unlisten) unlisten()
    }
  }, [])

  const statusText = useMemo(() => {
    if (lastLogLine) return lastLogLine
    if (engineError || error) return 'ERROR'
    if (connectionState === 'connecting') return 'CONNECTING...'
    if (statusCode && statusCodeMessages[statusCode]) return statusCodeMessages[statusCode]
    if (connectionState === 'connected') return 'READYING STREAM...'
    return 'STARTING...'
  }, [lastLogLine, connectionState, statusCode, engineError, error])

  const onModeChosen = useCallback(
    (chosenMode: EngineMode) => {
      if (handleModeChoice) {
        handleModeChoice(chosenMode)
      }
    },
    [handleModeChoice]
  )

  if (state !== states.LOADING) return null

  if (isEngineUnchosen) {
    return (
      <div className="terminal-display state-loading">
        <EngineModeChoice onChoiceMade={onModeChosen} />
      </div>
    )
  }

  const isLogPanelExpanded = logPanelProgress > 0.5
  const showLogPanel = logPanelProgress > 0.001 || isHandleDragging

  return (
    <div className="terminal-display state-loading">
      <div className="loading-progress-block">
        <div className="terminal-status" id="terminal-status">
          <span className={`terminal-text ${engineError || error ? 'error' : ''}`}>{statusText}</span>
        </div>

        <div className="terminal-progress loading-cinematic-progress">
          <div className="progress-track">
            <div className="progress-scanner" />
          </div>
        </div>

        <div
          className={`loading-output-handle ${isLogPanelExpanded ? 'expanded' : ''} ${isHandleDragging ? 'dragging' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Drag to show or hide engine output"
          onPointerDown={(event) => {
            swipeStateRef.current = {
              active: true,
              startY: event.clientY,
              startProgress: logPanelProgress,
              lastDeltaY: 0
            }
            setIsHandleDragging(true)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (!swipeStateRef.current.active) return
            const deltaY = event.clientY - swipeStateRef.current.startY
            swipeStateRef.current.lastDeltaY = deltaY
            const nextProgress = Math.min(
              1,
              Math.max(0, swipeStateRef.current.startProgress - deltaY / LOG_DRAG_RANGE_PX)
            )
            setLogPanelProgress(nextProgress)
          }}
          onPointerUp={(event) => {
            if (!swipeStateRef.current.active) return
            event.currentTarget.releasePointerCapture(event.pointerId)
            const deltaY = swipeStateRef.current.lastDeltaY
            const isTap = Math.abs(deltaY) < 8
            if (isTap) {
              setLogPanelProgress((value) => (value < 0.5 ? 1 : 0))
            } else {
              setLogPanelProgress((value) => (value >= 0.5 ? 1 : 0))
            }
            swipeStateRef.current = { active: false, startY: 0, startProgress: 0, lastDeltaY: 0 }
            setIsHandleDragging(false)
          }}
          onPointerCancel={() => {
            setLogPanelProgress((value) => (value >= 0.5 ? 1 : 0))
            swipeStateRef.current = { active: false, startY: 0, startProgress: 0, lastDeltaY: 0 }
            setIsHandleDragging(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setLogPanelProgress((value) => (value < 0.5 ? 1 : 0))
            }
          }}
        >
          <span className="loading-output-handle-bar" />
        </div>
      </div>

      <button
        className="terminal-cancel-btn"
        onClick={() => {
          if (onCancel) {
            onCancel()
            return
          }
          void cancelConnection()
        }}
      >
        Cancel
      </button>

      {showLogPanel && (
        <div
          className={`loading-inline-logs ${isHandleDragging ? 'dragging' : ''}`}
          style={{
            height: `${logPanelProgress * LOG_PANEL_MAX_HEIGHT_CQH}cqh`,
            opacity: logPanelProgress,
            transform: `translateY(${(1 - logPanelProgress) * -10}px)`,
            pointerEvents: logPanelProgress > 0.98 && !isHandleDragging ? 'auto' : 'none'
          }}
        >
          <div className="loading-inline-logs-shell">
            <ServerLogDisplay
              headerAction={
                <a
                  className="loading-inline-logs-close"
                  href="https://github.com/Overworldai/Biome/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Report Bug
                </a>
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default TerminalDisplay
