import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '../bridge'
import { resolveStage } from '../stages'
import { useStreaming } from '../context/StreamingContext'
import { useVortex } from '../context/VortexContext'
import { useSettings } from '../hooks/useSettings'
import Button from './ui/Button'
import ServerLogDisplay from './ServerLogDisplay'
import SocialCtaRow from './SocialCtaRow'

const INLINE_ERROR_MAX_LENGTH = 80
const ERROR_DETAIL_CLASS = 'font-serif text-[3.2cqh] leading-[1.15] text-[var(--color-error-bright)]'

type TerminalDisplayProps = {
  onCancel?: () => void
}

const TerminalDisplay = ({ onCancel }: TerminalDisplayProps) => {
  const { connectionState, statusStage, engineError, error, cancelConnection, wsLogs } = useStreaming()
  const { setErrorMode } = useVortex()
  const { isServerMode } = useSettings()
  const [showLogsPanel, setShowLogsPanel] = useState(false)
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [displayedLogs, setDisplayedLogs] = useState<string[]>([])
  const logsPanelHeight = 260

  const errorDetail = engineError || error

  // Extract the first non-empty line from the error for the inline display
  const errorFirstLine = useMemo(() => {
    if (!errorDetail) return null
    const lines = errorDetail.split('\n').filter((l) => l.trim().length > 0)
    return lines.length > 0 ? lines[0].trim() : errorDetail
  }, [errorDetail])

  useEffect(() => {
    setErrorMode(!!errorDetail)
    return () => setErrorMode(false)
  }, [errorDetail, setErrorMode])

  const currentStage = statusStage ? resolveStage(statusStage) : null
  const progressPercent = currentStage ? Math.max(0, Math.min(100, Math.round(currentStage.percent))) : 0
  const statusText = useMemo(() => {
    if (errorDetail) return 'Error'
    if (currentStage?.label) return currentStage.label
    if (connectionState === 'connecting') return 'Connecting...'
    return 'Starting...'
  }, [connectionState, currentStage?.label, errorDetail])

  const handleExportDiagnostics = async () => {
    if (isExportingDiagnostics) return

    setIsExportingDiagnostics(true)
    setExportStatus(null)

    try {
      const report = await buildDiagnosticsPayload()

      const result = await invoke('export-loading-diagnostics', JSON.stringify(report, null, 2))
      if (result.canceled) {
        setExportStatus('Export canceled')
      } else {
        setExportStatus('Diagnostics exported')
      }
    } catch (exportErr) {
      const message = exportErr instanceof Error ? exportErr.message : 'Export failed'
      setExportStatus(message)
    } finally {
      setIsExportingDiagnostics(false)
    }
  }

  const buildDiagnosticsPayload = useCallback(async () => {
    const activeError = errorDetail
    const logs = activeError ? [...displayedLogs, `[ERROR] ${activeError}`] : displayedLogs
    const meta = await invoke('get-runtime-diagnostics-meta')
    const system = await invoke('get-system-diagnostics')
    const serverProcessLogTail = isServerMode ? null : await invoke('read-server-log-tail', 260)
    return {
      generated_at: new Date().toISOString(),
      runtime: meta,
      system,
      loading_state: {
        connection_state: connectionState,
        status_stage: statusStage,
        status_text: statusText,
        progress_percent: progressPercent,
        active_error: activeError,
        engine_error: engineError,
        websocket_error: error,
        is_server_mode: isServerMode
      },
      logs,
      server_process_log_tail: serverProcessLogTail
    }
  }, [
    connectionState,
    displayedLogs,
    engineError,
    error,
    errorDetail,
    isServerMode,
    progressPercent,
    statusStage,
    statusText
  ])

  return (
    <>
      <SocialCtaRow rowClassName="z-55" />
      <div className="terminal-display absolute z-55 flex flex-col items-center top-auto bottom-[calc(var(--edge-bottom)+7.2cqh)] left-1/2 -translate-x-1/2 gap-[1.6cqh] opacity-100 !animate-none w-[135.11cqh]">
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
              marginTop: showLogsPanel ? '0.8cqh' : '0px',
              height: showLogsPanel ? `${logsPanelHeight}px` : '0px',
              opacity: showLogsPanel ? 1 : 0,
              transform: showLogsPanel ? 'translateY(0)' : 'translateY(6px)',
              pointerEvents: showLogsPanel ? 'auto' : 'none',
              overflow: 'hidden'
            }}
          >
            <ServerLogDisplay
              variant="loading-inline"
              errorMessage={errorDetail}
              title={isServerMode ? 'SERVER OUTPUT' : undefined}
              externalLogs={isServerMode ? wsLogs : null}
              pollLogFileTail={!isServerMode}
              onLogsChange={setDisplayedLogs}
              reportContext={{
                flow: 'loading',
                connection_state: connectionState,
                status_stage: statusStage,
                status_text: statusText,
                progress_percent: progressPercent,
                engine_error: engineError,
                websocket_error: error,
                is_server_mode: isServerMode
              }}
              buildDiagnosticsPayload={buildDiagnosticsPayload}
              showExportAction={!!errorDetail}
              onExportAction={() => void handleExportDiagnostics()}
              isExportingAction={isExportingDiagnostics}
              exportActionLabel="Export Logs"
            />
          </div>
          <div className="flex items-center justify-end gap-[1.8cqh] mt-[1.35cqh] w-full">
            <Button
              variant="ghost"
              className="flex items-center justify-center gap-[0.8cqh] w-[19.2cqh] h-[4.9cqh] px-[1.4cqh] text-[2.45cqh] leading-none"
              aria-label={showLogsPanel ? 'Hide logs panel' : 'Show logs panel'}
              title={showLogsPanel ? 'Hide logs panel' : 'Show logs panel'}
              onClick={() => setShowLogsPanel((prev) => !prev)}
            >
              <span className="inline-block text-left w-[13cqh] whitespace-nowrap">
                {showLogsPanel ? 'Hide Logs' : 'Show Logs'}
              </span>
              <span className="inline-flex w-[2.2cqh] justify-center">
                {showLogsPanel ? (
                  <svg className="w-[2.2cqh] h-[1.1cqh]" viewBox="0 0 24 12" aria-hidden="true">
                    <path d="M2 3h20L12 10z" fill="currentColor" />
                  </svg>
                ) : (
                  <svg className="w-[2.2cqh] h-[1.1cqh]" viewBox="0 0 24 12" aria-hidden="true">
                    <path d="M2 9h20L12 2z" fill="currentColor" />
                  </svg>
                )}
              </span>
            </Button>
            <Button
              variant="danger"
              className="!animate-none flex items-center justify-center h-[4.9cqh] min-w-[12.5cqh] px-[1.8cqh] text-[2.45cqh] leading-none"
              onClick={() => {
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
          {exportStatus && (
            <div className="w-full text-right font-serif text-[2cqh] leading-[1.1] text-[rgba(245,249,255,0.78)] mt-[0.45cqh]">
              {exportStatus}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default TerminalDisplay
