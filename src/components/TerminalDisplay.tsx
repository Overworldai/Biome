import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '../bridge'
import { buildDiagnosticsPayload } from '../lib/diagnosticsPayload'
import { resolveStage } from '../stages'
import { useStreaming } from '../context/StreamingContext'
import { useVortex } from '../context/VortexContext'
import { useSettings } from '../hooks/useSettings'
import { useEngineLogs } from '../hooks/useEngineLogs'
import Button from './ui/Button'
import { GooseFactTicker } from './GooseMode'
import { isGooseMode } from '../i18n'
import RawButton from './ui/RawButton'
import ServerLogDisplay from './ServerLogDisplay'
import SocialCtaRow from './SocialCtaRow'
import { useTranslation } from 'react-i18next'

const INLINE_ERROR_MAX_LENGTH = 80
const ERROR_DETAIL_CLASS = 'font-serif text-[3.2cqh] leading-[1.15] text-[var(--color-error-bright)]'

type TerminalDisplayProps = {
  onCancel?: () => void
}

const TerminalDisplay = ({ onCancel }: TerminalDisplayProps) => {
  const { t } = useTranslation()
  const { connectionState, statusStage, isFreshInstall, engineError, error, cancelConnection, wsLogs, connection } =
    useStreaming()
  const { setErrorMode } = useVortex()
  const { isServerMode, settings } = useSettings()
  const { logs: engineLogs } = useEngineLogs(!isServerMode)
  const activeLogs = isServerMode ? wsLogs : engineLogs
  const [showLogsPanel, setShowLogsPanel] = useState(false)
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const logsPanelHeight = '36cqh'

  const activeError = engineError ?? error
  const errorDetail = activeError
    ? String(
        t(activeError.translationKey, { defaultValue: activeError.translationKey, ...activeError.translationParams })
      )
    : null

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
    if (errorDetail) return t('app.loading.error')
    if (currentStage?.label) return t(`stage.${currentStage.id}`, { defaultValue: currentStage.label })
    if (connectionState === 'connecting') return t('app.loading.connecting')
    return t('app.loading.starting')
  }, [connectionState, currentStage?.id, currentStage?.label, errorDetail, t])

  const handleExportDiagnostics = async () => {
    if (isExportingDiagnostics) return

    setIsExportingDiagnostics(true)
    setExportStatus(null)

    try {
      const report = await buildPayload()

      const result = await invoke('export-loading-diagnostics', JSON.stringify(report, null, 2))
      if (result.canceled) {
        setExportStatus(t('app.loading.exportCanceled'))
      } else {
        setExportStatus(t('app.loading.diagnosticsExported'))
      }
    } catch (exportErr) {
      const message = exportErr instanceof Error ? exportErr.message : t('app.loading.exportFailed')
      setExportStatus(message)
    } finally {
      setIsExportingDiagnostics(false)
    }
  }

  const buildPayload = useCallback(() => {
    const logs = errorDetail ? [...activeLogs, `[ERROR] ${errorDetail}`] : activeLogs
    return buildDiagnosticsPayload({
      connection,
      error: {
        message: errorDetail,
        stage: statusStage,
        progress_percent: progressPercent,
        connection_state: connectionState
      },
      logs,
      session: {
        engineMode: isServerMode ? 'server' : 'standalone',
        requestedModel: settings.engine_model ?? null,
        requestedQuant: settings.engine_quant ?? null
      }
    })
  }, [
    activeLogs,
    connection,
    connectionState,
    engineError,
    error,
    errorDetail,
    isServerMode,
    progressPercent,
    settings.engine_model,
    settings.engine_quant,
    statusStage
  ])

  return (
    <>
      {isFreshInstall && !errorDetail && (
        <div
          className="absolute z-55 left-1/2 top-1/2 flex flex-col items-center gap-[2.4cqh] pointer-events-none bg-[rgba(4,8,16,0.45)] rounded-[1.8cqh] px-[5cqh] py-[3.6cqh] transition-transform duration-300 ease-in-out"
          style={{
            transform: `translate(-50%, ${showLogsPanel ? 'calc(-50% - 22cqh)' : '-50%'})`
          }}
        >
          <div className="font-serif text-[5.2cqh] font-normal text-white [text-shadow:0_0.14cqh_0.83cqh_rgba(0,0,0,0.5)]">
            {t('app.loading.firstTimeSetup')}
          </div>
          <div className="font-serif text-[3.2cqh] font-normal text-text-modal-muted [text-shadow:0_0.14cqh_0.56cqh_rgba(0,0,0,0.4)] text-center leading-[1.4] max-w-[80cqh]">
            {t('app.loading.firstTimeSetupDescription')}
            <span className="block mt-[1.6cqh]">{t('app.loading.firstTimeSetupHint')}</span>
          </div>
        </div>
      )}
      <div className="terminal-display absolute z-55 flex flex-col items-center top-auto bottom-[calc(var(--edge-bottom)+7.2cqh)] left-1/2 -translate-x-1/2 gap-[1.6cqh] opacity-100 !animate-none w-[135.11cqh]">
        <div className="flex flex-col items-center gap-[0.55cqh] w-[135.11cqh]">
          <div className="w-full flex items-baseline justify-between">
            <div
              className="font-serif text-[4.62cqh] font-normal tracking-[0.01em] normal-case text-white [text-shadow:0_0.14cqh_0.56cqh_rgba(0,0,0,0.45)] text-left"
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
          {!errorDetail && isGooseMode(settings.locale) && <GooseFactTicker />}
          <div
            className="loading-inline-logs"
            style={{
              marginTop: showLogsPanel ? '0.8cqh' : '0cqh',
              height: showLogsPanel ? logsPanelHeight : '0cqh',
              opacity: showLogsPanel ? 1 : 0,
              transform: showLogsPanel ? 'translateY(0)' : 'translateY(0.83cqh)',
              pointerEvents: showLogsPanel ? 'auto' : 'none',
              overflow: 'hidden'
            }}
          >
            <ServerLogDisplay
              errorMessage={errorDetail}
              logs={activeLogs}
              buildDiagnosticsPayload={buildPayload}
              showExportAction={!!errorDetail}
              onExportAction={() => void handleExportDiagnostics()}
              isExportingAction={isExportingDiagnostics}
              exportActionLabel="app.buttons.saveReport"
              actionStatus={exportStatus}
            />
          </div>
        </div>
      </div>
      <SocialCtaRow rowClassName="z-55" />
      <div className="absolute z-55 bottom-[var(--edge-bottom)] right-[calc((100cqw-135.11cqh)/2)] flex items-end gap-[1.8cqh] pointer-events-auto">
        <RawButton
          variant="secondary"
          className="flex items-center justify-center gap-[0.8cqh] w-[19.2cqh] h-[4.9cqh] px-[1.4cqh] text-[2.45cqh] leading-none"
          aria-label={showLogsPanel ? t('app.loading.terminal.hideLogsPanel') : t('app.loading.terminal.showLogsPanel')}
          title={showLogsPanel ? t('app.loading.terminal.hideLogsPanel') : t('app.loading.terminal.showLogsPanel')}
          onClick={() => setShowLogsPanel((prev) => !prev)}
        >
          <span className="inline-block text-left w-[13cqh] whitespace-nowrap">
            {showLogsPanel ? t('app.buttons.hideLogs') : t('app.buttons.showLogs')}
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
        </RawButton>
        <Button
          variant="danger"
          autoShrinkLabel
          label="app.buttons.cancel"
          className="!animate-none flex items-center justify-center h-[4.9cqh] min-w-[12.5cqh] px-[1.8cqh] text-[2.45cqh] leading-none"
          onClick={() => {
            if (onCancel) {
              onCancel()
              return
            }
            void cancelConnection()
          }}
        />
      </div>
    </>
  )
}

export default TerminalDisplay
