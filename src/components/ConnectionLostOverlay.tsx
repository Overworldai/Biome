import { useCallback } from 'react'
import { buildDiagnosticsPayload } from '../lib/diagnosticsPayload'
import { useStreaming } from '../context/StreamingContext'
import { useSettings } from '../hooks/useSettings'
import Button from './ui/Button'
import ServerLogDisplay from './ServerLogDisplay'
import { useTranslation } from 'react-i18next'

const ConnectionLostOverlay = () => {
  const { t } = useTranslation()
  const { connectionLost, cancelConnection, connection, wsLogs, wsAllLogs, error, engineError, statusStage } =
    useStreaming()
  const { settings, isServerMode } = useSettings()

  // Same resolution logic as TerminalDisplay — prefer engineError, fall back to raw WS error.
  const activeError = engineError ?? error
  const errorDetail = activeError
    ? String(
        t(activeError.translationKey, { defaultValue: activeError.translationKey, ...activeError.translationParams })
      )
    : null

  const handleReturnToMainMenu = () => {
    void cancelConnection()
  }

  const buildPayload = useCallback(() => {
    const logs = errorDetail ? [...wsAllLogs, `[ERROR] ${errorDetail}`] : wsAllLogs
    return buildDiagnosticsPayload({
      connection,
      error: {
        message: errorDetail,
        stage: statusStage,
        connection_state: 'disconnected'
      },
      logs,
      session: {
        engineMode: isServerMode ? 'server' : 'standalone',
        requestedModel: settings.engine_model ?? null,
        requestedQuant: settings.engine_quant ?? null
      }
    })
  }, [connection, wsAllLogs, errorDetail, statusStage, isServerMode, settings.engine_model, settings.engine_quant])

  return (
    <div
      className={`
        connection-lost-overlay absolute inset-0 z-200 flex items-center justify-center bg-darkest/90
        backdrop-blur-[0.56cqh]
        ${connectionLost ? 'active pointer-events-auto visible opacity-100' : 'pointer-events-none invisible opacity-0'}
      `}
    >
      <div
        className="
          flex w-[115cqh] max-w-[92vw] animate-[connectionLostFadeIn_0.4s_ease-out] flex-col items-center gap-[2.2cqh]
          border border-border-medium bg-surface-modal p-[3cqh_2.84cqh] text-(--color-text-primary)
        "
      >
        <div className="h-[8.5cqh] w-[8.5cqh] animate-[connectionLostPulse_2s_ease-in-out_infinite] text-error-muted">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-full"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>
        <div className="flex w-full flex-col items-center gap-[0.4cqh]">
          <h3 className="m-0 font-serif text-[3.91cqh] font-medium">{t('app.dialogs.connectionLost.title')}</h3>
          {errorDetail ? (
            <p
              className="
                m-0 w-full text-center font-serif text-[2.4cqh] leading-[1.3] wrap-break-word text-error-bright
              "
            >
              {errorDetail}
            </p>
          ) : (
            <p className="m-0 text-center font-serif text-[2.4cqh] text-text-modal-muted">
              {t('app.dialogs.connectionLost.description')}
            </p>
          )}
        </div>
        <div className="h-[28cqh] w-full">
          <ServerLogDisplay
            errorMessage={errorDetail}
            logs={wsLogs}
            buildDiagnosticsPayload={buildPayload}
            primaryAction={
              <Button
                variant="primary"
                autoShrinkLabel
                label="app.buttons.returnToMainMenu"
                className="px-[1.4cqh] py-[0.4cqh] text-[2.13cqh]"
                onClick={handleReturnToMainMenu}
              />
            }
          />
        </div>
      </div>
    </div>
  )
}

export default ConnectionLostOverlay
