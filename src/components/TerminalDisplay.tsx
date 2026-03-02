import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import { invoke, listen } from '../bridge'
import { usePortal } from '../context/PortalContext'
import { useStreaming } from '../context/StreamingContext'
import { useVortex } from '../context/VortexContext'
import { useConfig } from '../hooks/useConfig'
import OverlayModal from './ui/OverlayModal'
import Button from './ui/Button'
import ServerLogDisplay from './ServerLogDisplay'

type TerminalDisplayProps = {
  onCancel?: (options?: { shutdownHosted?: boolean }) => void
  keepVisible?: boolean
}

const TerminalDisplay = ({ onCancel, keepVisible = false }: TerminalDisplayProps) => {
  const { state, states } = usePortal()
  const { connectionState, statusStage, engineError, error, cancelConnection, endpointUrl } = useStreaming()
  const { setErrorMode } = useVortex()
  const { isServerMode, getUrl } = useConfig()
  const [showLogsPanel, setShowLogsPanel] = useState(false)
  const logsPanelHeight = 260
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [logCursor, setLogCursor] = useState<number | null>(null)
  const logCursorRef = useRef<number | null>(null)
  const [logError, setLogError] = useState<string | null>(null)
  const [syncSpinSeq, setSyncSpinSeq] = useState(0)
  const logsFetchInFlightRef = useRef(false)
  const [fallbackStage, setFallbackStage] = useState<{ id: string; label: string; percent: number } | null>(null)

  const errorDetail = engineError || error

  useEffect(() => {
    setErrorMode(!!errorDetail)
    return () => setErrorMode(false)
  }, [errorDetail, setErrorMode])

  const currentStage = statusStage ?? fallbackStage
  const progressPercent = currentStage ? Math.max(0, Math.min(100, Math.round(currentStage.percent))) : 0
  const statusText = useMemo(() => {
    if (errorDetail) return 'Error'
    if (currentStage?.label) return currentStage.label
    if (connectionState === 'connecting') return 'Connecting...'
    return 'Starting...'
  }, [connectionState, currentStage?.label, errorDetail])

  const resolveHostedBaseUrl = useCallback(() => {
    if (endpointUrl) {
      if (endpointUrl.startsWith('http://') || endpointUrl.startsWith('https://')) return endpointUrl
      if (endpointUrl.startsWith('ws://')) return `http://${endpointUrl.slice(5)}`
      if (endpointUrl.startsWith('wss://')) return `https://${endpointUrl.slice(6)}`
      return `http://${endpointUrl}`
    }
    return getUrl()
  }, [endpointUrl, getUrl])

  useEffect(() => {
    if (!showLogsPanel || !isServerMode) return
    setLogLines([])
    setLogCursor(null)
    logCursorRef.current = null
    setLogError(null)
    logsFetchInFlightRef.current = false
  }, [isServerMode, showLogsPanel])

  const syncHostedLogs = useCallback(async () => {
    if (!showLogsPanel || !isServerMode) return
    if (logsFetchInFlightRef.current) return

    logsFetchInFlightRef.current = true
    try {
      const result = await invoke('fetch-server-admin-logs', resolveHostedBaseUrl(), logCursorRef.current, 200)
      if (result.lines.length > 0) {
        setLogLines((prev) => [...prev, ...result.lines].slice(-500))
      }
      logCursorRef.current = result.next_cursor
      setLogCursor(result.next_cursor)
      setLogError(null)
    } catch (err) {
      setLogError(err instanceof Error ? err.message : String(err))
    } finally {
      logsFetchInFlightRef.current = false
    }
  }, [isServerMode, resolveHostedBaseUrl, showLogsPanel])

  useEffect(() => {
    if (!showLogsPanel || !isServerMode) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const pollLogs = async () => {
      if (cancelled) return
      await syncHostedLogs()
      if (!cancelled) {
        timer = setTimeout(pollLogs, 3000)
      }
    }

    void pollLogs()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [isServerMode, showLogsPanel, syncHostedLogs])

  useEffect(() => {
    const unlisten = listen('server-stage', (payload) => {
      if (typeof payload.id !== 'string' || typeof payload.label !== 'string' || typeof payload.percent !== 'number') {
        return
      }
      setFallbackStage({
        id: payload.id,
        label: payload.label,
        percent: Math.max(0, Math.min(100, Math.round(payload.percent)))
      })
    })
    return () => unlisten()
  }, [])

  if (state !== states.LOADING && !keepVisible) return null

  return (
    <>
      <div className="terminal-display absolute z-55 flex flex-col items-center top-auto bottom-[var(--edge-bottom)] left-1/2 -translate-x-1/2 gap-[1.6cqh] opacity-100 !animate-none w-[135.11cqh]">
        <div className="flex flex-col items-center gap-[0.55cqh] w-[135.11cqh]">
          {errorDetail && errorDetail.length >= 80 && (
            <div className="max-w-[117.35cqh] text-center font-serif text-[3.2cqh] leading-[1.15] text-[rgba(255,205,205,0.96)]">
              {errorDetail}
            </div>
          )}
          <div
            className={`w-full ${errorDetail && errorDetail.length < 80 ? 'flex items-baseline justify-between' : ''}`}
          >
            <div
              className={`font-serif text-[4.62cqh] font-normal tracking-[0.01em] normal-case text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.45)] ${errorDetail && errorDetail.length < 80 ? 'text-left' : 'text-center'}`}
              id="terminal-status"
            >
              {statusText}
            </div>
            {errorDetail && errorDetail.length < 80 && (
              <div className="font-serif text-[3.2cqh] leading-[1.15] text-[rgba(255,205,205,0.96)] whitespace-nowrap">
                {errorDetail}
              </div>
            )}
          </div>

          <div className="flex items-center w-[135.11cqh] mx-auto justify-center">
            <div className="relative overflow-hidden w-full h-[0.9cqh] m-0 border border-[rgba(255,255,255,0.78)] bg-[rgba(255,255,255,0.08)] before:hidden">
              <div
                className="absolute left-0 top-0 h-full bg-[linear-gradient(90deg,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.95)_70%,rgba(255,255,255,0.82)_100%)]"
                style={{ width: `${progressPercent}%`, transition: 'width 220ms ease' }}
              />
            </div>
          </div>
          <div
            className="loading-inline-logs"
            style={{
              height: showLogsPanel ? `${logsPanelHeight}px` : '0px',
              opacity: showLogsPanel ? 1 : 0,
              transform: showLogsPanel ? 'translateY(0)' : 'translateY(6px)',
              pointerEvents: showLogsPanel ? 'auto' : 'none',
              overflow: 'hidden'
            }}
          >
            {isServerMode ? (
              <ServerLogDisplay
                variant="loading-inline"
                disableLiveIpc={true}
                externalLogs={logLines}
                errorMessage={logError}
                title="HOSTED SERVER OUTPUT"
                headerAction={
                  <button
                    type="button"
                    className="loading-inline-logs-close grid place-items-center w-[3.4cqh] h-[3.4cqh] p-0"
                    onClick={() => {
                      setSyncSpinSeq((seq) => seq + 1)
                      void syncHostedLogs()
                    }}
                    aria-label="Synchronise logs"
                    title="Synchronise logs"
                  >
                    <svg
                      key={syncSpinSeq}
                      className={`w-[1.9cqh] h-[1.9cqh] ${syncSpinSeq > 0 ? 'animate-[spin_220ms_linear_1]' : ''}`}
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        d="M19 5v5h-5M5 19v-5h5M7 8l2-2h6l2 2M17 16l-2 2H9l-2-2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                }
              />
            ) : (
              <ServerLogDisplay variant="loading-inline" />
            )}
          </div>
          <div className="flex items-center justify-end gap-[1.2cqh] w-full">
            <Button
              variant="ghost"
              className="flex items-center gap-[0.8cqh]"
              aria-label={showLogsPanel ? 'Hide logs panel' : 'Show logs panel'}
              title={showLogsPanel ? 'Hide logs panel' : 'Show logs panel'}
              onClick={() => setShowLogsPanel((prev) => !prev)}
            >
              <span>{showLogsPanel ? 'Hide Logs' : 'Show Logs'}</span>
              {showLogsPanel ? (
                <svg className="w-[2.2cqh] h-[1.1cqh]" viewBox="0 0 24 12" aria-hidden="true">
                  <path d="M2 3h20L12 10z" fill="currentColor" />
                </svg>
              ) : (
                <svg className="w-[2.2cqh] h-[1.1cqh]" viewBox="0 0 24 12" aria-hidden="true">
                  <path d="M2 9h20L12 2z" fill="currentColor" />
                </svg>
              )}
            </Button>
            <Button
              variant="danger"
              className="!animate-none"
              onClick={() => {
                if (isServerMode) {
                  setShowCancelModal(true)
                  return
                }
                if (onCancel) {
                  onCancel()
                  return
                }
                void cancelConnection()
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>

      <OverlayModal
        open={showCancelModal}
        title="Cancel Loading"
        onClose={() => setShowCancelModal(false)}
        actions={
          <>
            <button
              type="button"
              className="border border-[rgba(245,251,255,0.7)] bg-[rgba(8,12,20,0.18)] text-[rgba(245,251,255,0.95)] font-serif text-[2.4cqh] px-[1.8cqh] py-[0.45cqh]"
              onClick={() => setShowCancelModal(false)}
            >
              Keep Loading
            </button>
            <button
              type="button"
              className="border border-[rgba(255,180,180,0.8)] bg-[rgba(130,0,0,0.4)] text-[rgba(255,235,235,0.98)] font-serif text-[2.4cqh] px-[1.8cqh] py-[0.45cqh]"
              onClick={() => {
                setShowCancelModal(false)
                if (onCancel) {
                  onCancel()
                  return
                }
                void cancelConnection()
              }}
            >
              Cancel Only
            </button>
            <button
              type="button"
              className="border border-[rgba(255,120,120,0.95)] bg-[rgba(150,0,0,0.62)] text-[rgba(255,245,245,0.98)] font-serif text-[2.4cqh] px-[1.8cqh] py-[0.45cqh]"
              onClick={() => {
                setShowCancelModal(false)
                if (onCancel) {
                  onCancel({ shutdownHosted: true })
                  return
                }
                void cancelConnection({ shutdownHosted: true })
              }}
            >
              Cancel + Shutdown Hosted
            </button>
          </>
        }
      >
        <p className="m-0 font-serif text-[2.4cqh] text-[rgba(233,242,255,0.88)]">
          Choose whether to only cancel this client connection, or also request shutdown of the hosted server.
        </p>
      </OverlayModal>
    </>
  )
}

export default TerminalDisplay
