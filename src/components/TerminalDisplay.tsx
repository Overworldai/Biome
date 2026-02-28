import { useMemo, useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '../bridge'
import { usePortal } from '../context/PortalContext'
import { useStreaming } from '../context/StreamingContext'
import ServerLogDisplay from './ServerLogDisplay'

const statusCodeMessages: Record<string, string> = {
  warmup: 'Starting engine...',
  init: 'Initializing world...',
  loading: 'Readying stream...',
  ready: 'Readying stream...',
  reset: 'Resetting...'
}

const LOG_PANEL_MAX_HEIGHT_CQH = 34
const LOG_DRAG_RANGE_PX = 220

type TerminalDisplayProps = {
  onCancel?: () => void
}

const TerminalDisplay = ({ onCancel }: TerminalDisplayProps) => {
  const { state, states } = usePortal()
  const { connectionState, statusCode, engineError, error, cancelConnection } = useStreaming()
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
    const unlisten = listen('server-log', (line) => {
      if (!mounted) return
      const trimmed = String(line ?? '').trim()
      if (trimmed) {
        setLastLogLine(trimmed)
      }
    })

    return () => {
      mounted = false
      unlisten()
    }
  }, [])

  const statusText = useMemo(() => {
    if (lastLogLine) return lastLogLine
    if (engineError || error) return 'Error'
    if (connectionState === 'connecting') return 'Connecting...'
    if (statusCode && statusCodeMessages[statusCode]) return statusCodeMessages[statusCode]
    if (connectionState === 'connected') return 'Readying stream...'
    return 'Starting...'
  }, [lastLogLine, connectionState, statusCode, engineError, error])

  if (state !== states.LOADING) return null

  const isLogPanelExpanded = logPanelProgress > 0.5
  const showLogPanel = logPanelProgress > 0.001 || isHandleDragging

  return (
    <div className="terminal-display absolute z-55 flex flex-col items-center top-auto bottom-[var(--edge-bottom)] left-1/2 -translate-x-1/2 gap-[1.6cqh] opacity-100 !animate-none w-[135.11cqh] pb-[8.2cqh]">
      <div className="flex flex-col items-center gap-[0.55cqh] w-[135.11cqh]">
        <div
          className="flex items-center font-serif text-[4.62cqh] font-normal tracking-[0.01em] normal-case text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.45)] max-w-[117.35cqh] text-center"
          id="terminal-status"
        >
          <span className="text-white">{statusText}</span>
        </div>

        <div className="flex items-center w-[135.11cqh] mx-auto justify-center">
          <div className="relative overflow-hidden w-full h-[0.9cqh] m-0 border border-[rgba(255,255,255,0.78)] bg-[rgba(255,255,255,0.08)] before:hidden">
            <div className="absolute top-0 h-full w-[22%] bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.95)_50%,transparent_100%)] shadow-none" />
          </div>
        </div>

        <div
          className={`loading-output-handle w-full flex justify-center items-center touch-none ${isLogPanelExpanded ? 'expanded' : ''} ${isHandleDragging ? 'dragging' : ''}`}
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
          <span className="loading-output-handle-bar rounded-full" />
        </div>
      </div>

      <button
        className="absolute left-1/2 bottom-0 -translate-x-1/2 right-auto mt-0 !animate-none leading-[1.1] whitespace-nowrap font-serif text-[3.73cqh] tracking-[0.02em] normal-case text-[rgba(255,235,235,0.98)] border border-[rgba(255,110,110,0.9)] bg-[rgba(130,0,0,0.56)] rounded-none py-[0.55cqh] px-[3.91cqh] cursor-pointer outline-0 outline-[rgba(255,170,170,0.98)] transition-[color,background-color,border-color,outline-width] duration-150 hover:text-white hover:border-[rgba(255,170,170,0.98)] hover:bg-[rgba(180,8,8,0.68)] hover:outline-2"
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
          className={`loading-inline-logs overflow-hidden origin-top ${isHandleDragging ? 'dragging' : ''}`}
          style={{
            height: `${logPanelProgress * LOG_PANEL_MAX_HEIGHT_CQH}cqh`,
            opacity: logPanelProgress,
            transform: `translateY(${(1 - logPanelProgress) * -10}px)`,
            pointerEvents: logPanelProgress > 0.98 && !isHandleDragging ? 'auto' : 'none'
          }}
        >
          <div className="w-full h-full">
            <ServerLogDisplay
              variant="loading-inline"
              headerAction={
                <a
                  className="loading-inline-logs-close cursor-pointer"
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
