import { useState, useEffect, useRef, type ReactNode } from 'react'
import { listen } from '../bridge'
import { INTERACTIVE_TRANSITION } from '../styles'

// Determine log line color class based on content
const getLogClass = (line: string): string => {
  if (line.includes('[ERROR]') || line.includes('FATAL') || line.includes('Error:')) {
    return 'text-text-error'
  }
  if (line.includes('[WARNING]') || line.includes('Warning:')) {
    return 'text-[rgba(255,200,100,0.9)]'
  }
  if (line.includes('[INFO]')) {
    return 'text-hud/90'
  }
  if (line.includes('100%') || line.includes('SERVER READY') || line.includes('complete')) {
    return 'text-hot/90'
  }
  return ''
}

const ServerLogDisplay = ({
  showDismiss = false,
  onDismiss,
  errorMessage = null,
  showProgress = false,
  progressMessage = null,
  headerAction = null,
  variant = 'default',
  externalLogs = null,
  disableLiveIpc = false,
  title = null
}: {
  showDismiss?: boolean
  onDismiss?: () => void
  errorMessage?: string | null
  showProgress?: boolean
  progressMessage?: string | null
  headerAction?: ReactNode
  variant?: 'default' | 'loading-inline'
  externalLogs?: string[] | null
  disableLiveIpc?: boolean
  title?: string | null
}) => {
  const isLoadingInline = variant === 'loading-inline'
  const [logs, setLogs] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (disableLiveIpc) return
    let mounted = true

    const unlisten = listen('server-log', (line) => {
      if (!mounted) return
      const logLine = String(line ?? '')
      setLogs((prev) => {
        // Keep last 100 lines to prevent memory issues
        const newLogs = [...prev, logLine]
        if (newLogs.length > 100) {
          return newLogs.slice(-100)
        }
        return newLogs
      })
    })

    return () => {
      mounted = false
      unlisten()
    }
  }, [disableLiveIpc])

  const visibleLogs = externalLogs ?? logs

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [visibleLogs])

  return (
    <div
      className={`flex flex-col overflow-hidden ${isLoadingInline ? 'static w-full h-full max-h-none border border-[rgba(255,255,255,0.55)] bg-[rgba(0,0,0,0.72)] opacity-100 !animate-none' : 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] max-h-[50%] z-100 bg-[rgba(8,12,16,0.95)] border border-warm/30 rounded-[1.42cqh] opacity-0 animate-[serverLogFadeIn_0.3s_ease_forwards] shadow-[0_0_30px_rgba(0,0,0,0.6),0_0_15px_rgba(255,200,100,0.1)]'}`}
    >
      <div
        className={`flex items-center gap-[1.42cqh] px-[2.13cqh] py-[0.8cqh] ${isLoadingInline ? 'bg-[rgba(255,255,255,0.08)] border-b border-[rgba(255,255,255,0.2)] justify-between' : 'bg-warm/8 border-b border-warm/20'}`}
      >
        <div className="flex items-center gap-[1.42cqh]">
          <span
            className={`font-mono text-[2.13cqh] tracking-wider uppercase ${isLoadingInline ? 'font-serif tracking-[0.02em] text-[rgba(255,255,255,0.94)]' : 'text-warm/90'}`}
          >
            {title ?? (showProgress ? 'INSTALLING WORLD ENGINE' : 'ENGINE OUTPUT')}
          </span>
          <span
            className={`w-[1.07cqh] h-[1.07cqh] rounded-full ${isLoadingInline ? 'bg-[rgba(255,255,255,0.82)]' : `bg-warm/90 ${showDismiss ? 'bg-[rgba(255,100,100,0.9)] !animate-none' : 'animate-[indicatorPulse_1s_ease-in-out_infinite]'}`}`}
          />
        </div>
        {headerAction}
      </div>
      {showProgress && progressMessage && (
        <div className="flex items-center gap-[1.78cqh] px-[2.13cqh] py-[0.8cqh] bg-hud/8 border-b border-hud/20">
          <div className="animate-spin w-[2.13cqh] h-[2.13cqh] border-2 border-hud/30 border-t-hud/90 rounded-full" />
          <span className="font-mono text-[1.96cqh] text-hud/90">{progressMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="flex flex-col gap-[0.4cqh] px-[2.13cqh] py-[0.8cqh] bg-error/10 border-b border-error/30">
          <div className="font-mono text-[1.96cqh] text-error/90">{errorMessage}</div>
          <div className="font-mono text-[1.6cqh] text-white/50 italic">Open Settings to reinstall the engine.</div>
        </div>
      )}
      <div
        className={`server-log-content flex-1 px-[1.78cqh] py-[0.8cqh] overflow-y-auto font-mono text-[1.78cqh] leading-relaxed ${isLoadingInline ? '[scrollbar-color:rgba(255,255,255,0.34)_transparent]' : ''}`}
        ref={containerRef}
      >
        {visibleLogs.length === 0 ? (
          <div className={`italic ${isLoadingInline ? 'text-[rgba(255,255,255,0.72)]' : 'text-warm/50'}`}>
            Waiting for server output...
          </div>
        ) : (
          visibleLogs.map((line, index) => (
            <div
              key={index}
              className={`whitespace-pre-wrap break-all ${isLoadingInline ? 'text-[rgba(255,255,255,0.88)]' : `text-[rgba(200,200,200,0.9)] ${getLogClass(line)}`}`}
            >
              {line}
            </div>
          ))
        )}
      </div>
      {showDismiss && (
        <button
          className={`mx-[2.13cqh] my-[1cqh] px-[2.67cqh] py-[0.6cqh] bg-[rgba(255,100,100,0.15)] border border-[rgba(255,100,100,0.4)] rounded-panel text-text-error font-mono text-[1.78cqh] tracking-wider cursor-pointer outline-0 outline-[rgba(255,100,100,0.6)] ${INTERACTIVE_TRANSITION} duration-200 hover:bg-[rgba(255,100,100,0.25)] hover:border-[rgba(255,100,100,0.6)] hover:outline-2`}
          onClick={onDismiss}
        >
          DISMISS
        </button>
      )}
    </div>
  )
}

export default ServerLogDisplay
