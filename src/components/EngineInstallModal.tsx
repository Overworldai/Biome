import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../bridge'
import { buildDiagnosticsPayload } from '../lib/diagnosticsPayload'
import { useStreaming } from '../context/StreamingContext'
import { useEngineLogs } from '../hooks/useEngineLogs'
import Button from './ui/Button'
import ServerLogDisplay from './ServerLogDisplay'
import { FocusScope } from '../context/FocusScopeContext'
import { useTranslation } from 'react-i18next'

type EngineInstallModalProps = {
  onClose: () => void
}

const EngineInstallModal = ({ onClose }: EngineInstallModalProps) => {
  const { t } = useTranslation()
  const { engineSetupInProgress, setupProgress, engineSetupError, abortEngineSetup, connection } = useStreaming()
  const { logs: installLogs, clear: clearInstallLogs } = useEngineLogs(true)
  const [isExportingInstallDiagnostics, setIsExportingInstallDiagnostics] = useState(false)
  const [isAbortingInstall, setIsAbortingInstall] = useState(false)
  const [installExportStatus, setInstallExportStatus] = useState<string | null>(null)

  useEffect(() => {
    if (engineSetupInProgress) {
      clearInstallLogs()
      setInstallExportStatus(null)
    }
  }, [engineSetupInProgress, clearInstallLogs])

  const buildPayload = useCallback(
    () =>
      buildDiagnosticsPayload({
        connection,
        error: {
          message: engineSetupError,
          stage: setupProgress,
          in_progress: engineSetupInProgress
        },
        logs: installLogs
      }),
    [connection, engineSetupError, engineSetupInProgress, installLogs, setupProgress]
  )

  const handleExportInstallDiagnostics = async () => {
    if (isExportingInstallDiagnostics) return

    setIsExportingInstallDiagnostics(true)
    setInstallExportStatus(null)
    try {
      const report = await buildPayload()

      const result = await invoke('export-loading-diagnostics', JSON.stringify(report, null, 2))
      if (result.canceled) {
        setInstallExportStatus(t('app.dialogs.install.exportCanceled'))
      } else {
        setInstallExportStatus(t('app.dialogs.install.diagnosticsExported'))
      }
    } catch (exportErr) {
      const message = exportErr instanceof Error ? exportErr.message : t('app.dialogs.install.exportFailed')
      setInstallExportStatus(message)
    } finally {
      setIsExportingInstallDiagnostics(false)
    }
  }

  const handleAbortInstall = async () => {
    if (isAbortingInstall) return

    setIsAbortingInstall(true)
    setInstallExportStatus(null)
    try {
      const message = await abortEngineSetup()
      setInstallExportStatus(message || t('app.dialogs.install.abortRequested'))
    } catch (abortErr) {
      const message = abortErr instanceof Error ? abortErr.message : t('app.dialogs.install.abortFailed')
      setInstallExportStatus(message)
    } finally {
      setIsAbortingInstall(false)
    }
  }

  return (
    <div
      className="absolute inset-0 z-[12] flex items-center justify-center bg-[var(--color-overlay-scrim)] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <FocusScope
        autoFocus
        onCancel={engineSetupInProgress ? undefined : onClose}
        className="w-[135.11cqh] max-w-[92vw] pointer-events-auto"
      >
        <ServerLogDisplay
          title="app.dialogs.install.title"
          logs={installLogs}
          showProgress={engineSetupInProgress}
          progressMessage={
            engineSetupInProgress
              ? setupProgress || t('app.dialogs.install.installing')
              : engineSetupError
                ? t('app.dialogs.install.failed')
                : t('app.dialogs.install.complete')
          }
          errorMessage={engineSetupError}
          buildDiagnosticsPayload={buildPayload}
          showExportAction={!engineSetupInProgress && !!engineSetupError}
          onExportAction={() => void handleExportInstallDiagnostics()}
          isExportingAction={isExportingInstallDiagnostics}
          exportActionLabel="app.buttons.saveReport"
          actionStatus={installExportStatus}
          headerAction={
            engineSetupInProgress ? (
              <div className="flex items-center gap-[0.8cqh]">
                <Button
                  variant="secondary"
                  autoShrinkLabel
                  label={isAbortingInstall ? 'app.buttons.aborting' : 'app.buttons.abort'}
                  className="text-[1.8cqh] px-[1.2cqh] py-[0.25cqh]"
                  onClick={() => void handleAbortInstall()}
                  disabled={isAbortingInstall}
                  aria-label={t('app.dialogs.install.abortEngineInstall')}
                />
              </div>
            ) : (
              <div className="flex items-center gap-[0.8cqh]">
                <Button
                  variant="secondary"
                  autoShrinkLabel
                  label="app.buttons.close"
                  className="text-[1.8cqh] px-[1.2cqh] py-[0.25cqh]"
                  onClick={onClose}
                  aria-label={t('app.dialogs.install.closeInstallLogs')}
                  data-default-focus
                />
              </div>
            )
          }
        />
      </FocusScope>
    </div>
  )
}

export default EngineInstallModal
