import { useEffect, useMemo, useState } from 'react'
import { useStreaming } from '../context/StreamingContext'
import { useVortex } from '../context/VortexContext'
import { useConfig } from '../hooks/useConfig'
import OverlayModal from './ui/OverlayModal'
import Button from './ui/Button'
import ServerLogDisplay from './ServerLogDisplay'

const INLINE_ERROR_MAX_LENGTH = 80
const ERROR_DETAIL_CLASS = 'font-serif text-[3.2cqh] leading-[1.15] text-[rgba(255,205,205,0.96)]'

type TerminalDisplayProps = {
  onCancel?: (options?: { shutdownHosted?: boolean }) => void
}

const TerminalDisplay = ({ onCancel }: TerminalDisplayProps) => {
  const { connectionState, statusStage, engineError, error, cancelConnection, wsLogs } = useStreaming()
  const { setErrorMode } = useVortex()
  const { isServerMode } = useConfig()
  const [showLogsPanel, setShowLogsPanel] = useState(false)
  const logsPanelHeight = 260
  const [showCancelModal, setShowCancelModal] = useState(false)

  const errorDetail = engineError || error

  // Extract the first non-empty line from the error for the inline display
  const errorFirstLine = useMemo(() => {
    if (!errorDetail) return null
    const lines = errorDetail.split('\n').filter((l) => l.trim().length > 0)
    return lines.length > 0 ? lines[0].trim() : errorDetail
  }, [errorDetail])

  // Append error to logs so it's visible in the logs panel
  const logsWithError = useMemo(() => {
    if (!errorDetail) return wsLogs
    return [...wsLogs, `[ERROR] ${errorDetail}`]
  }, [wsLogs, errorDetail])

  useEffect(() => {
    setErrorMode(!!errorDetail)
    return () => setErrorMode(false)
  }, [errorDetail, setErrorMode])

  const currentStage = statusStage
  const progressPercent = currentStage ? Math.max(0, Math.min(100, Math.round(currentStage.percent))) : 0
  const statusText = useMemo(() => {
    if (errorDetail) return 'Error'
    if (currentStage?.label) return currentStage.label
    if (connectionState === 'connecting') return 'Connecting...'
    return 'Starting...'
  }, [connectionState, currentStage?.label, errorDetail])

  return (
    <>
      <div className="terminal-display absolute z-55 flex flex-col items-center top-auto bottom-[var(--edge-bottom)] left-1/2 -translate-x-1/2 gap-[1.6cqh] opacity-100 !animate-none w-[135.11cqh]">
        <div className="flex flex-col items-center gap-[0.55cqh] w-[135.11cqh]">
          <div className="w-full flex items-baseline justify-between">
            <div
              className="font-serif text-[4.62cqh] font-normal tracking-[0.01em] normal-case text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.45)] text-left"
              id="terminal-status"
            >
              {statusText}
            </div>
            {errorFirstLine && errorFirstLine.length < INLINE_ERROR_MAX_LENGTH && (
              <div className={`${ERROR_DETAIL_CLASS} whitespace-nowrap`}>{errorFirstLine}</div>
            )}
          </div>
          {errorFirstLine && errorFirstLine.length >= INLINE_ERROR_MAX_LENGTH && (
            <div className={`w-full text-left ${ERROR_DETAIL_CLASS}`}>{errorFirstLine}</div>
          )}

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
            <ServerLogDisplay
              variant="loading-inline"
              disableLiveIpc={true}
              externalLogs={logsWithError}
              title={isServerMode ? 'HOSTED SERVER OUTPUT' : undefined}
            />
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
