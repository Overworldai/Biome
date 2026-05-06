import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '../bridge'
import { buildDiagnosticsPayload } from '../lib/diagnosticsPayload'
import { useConnection } from '../context/streaming/connection'
import { useEngine } from '../context/streaming/engine'
import { useEngineLogs } from '../hooks/engine/useEngineLogs'
import Button from './ui/Button'
import ServerLogDisplay from './ServerLogDisplay'
import { FocusScope } from '../context/focus/FocusScopeContext'
import { useTranslation } from 'react-i18next'

type EngineInstallModalProps = {
  onClose: () => void
}

const EngineInstallModal = ({ onClose }: EngineInstallModalProps) => {
  const { t } = useTranslation()
  const { server } = useConnection()
  const setup = useEngine().setup
  const { logs: installLogs, clear: clearInstallLogs } = useEngineLogs(true)
  const [isExportingInstallDiagnostics, setIsExportingInstallDiagnostics] = useState(false)
  const [isAbortingInstall, setIsAbortingInstall] = useState(false)
  const [installExportStatus, setInstallExportStatus] = useState<string | null>(null)

  useEffect(() => {
    if (setup.inProgress) {
      clearInstallLogs()
      setInstallExportStatus(null)
    }
  }, [setup.inProgress, clearInstallLogs])

  const buildPayload = useCallback(
    () =>
      buildDiagnosticsPayload({
        server,
        error: {
          message: setup.error,
          stage: setup.progress,
          in_progress: setup.inProgress
        },
        // Install runs entirely on the Electron side — no WS connection
        // yet — so the Electron-process tail (pulled by the builder) is
        // the only log source.
        serverLogs: []
      }),
    [server, setup.error, setup.inProgress, setup.progress]
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
      const message = await setup.abort()
      setInstallExportStatus(message || t('app.dialogs.install.abortRequested'))
    } catch (abortErr) {
      const message = abortErr instanceof Error ? abortErr.message : t('app.dialogs.install.abortFailed')
      setInstallExportStatus(message)
    } finally {
      setIsAbortingInstall(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-10000 flex items-center justify-center bg-overlay-scrim backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <FocusScope
        autoFocus
        onCancel={setup.inProgress ? undefined : onClose}
        className="pointer-events-auto w-[135.11cqh] max-w-[92vw]"
      >
        <ServerLogDisplay
          title="app.dialogs.install.title"
          logs={installLogs}
          showProgress={setup.inProgress}
          progressMessage={
            setup.inProgress
              ? setup.progress || t('app.dialogs.install.installing')
              : setup.error
                ? t('app.dialogs.install.failed')
                : t('app.dialogs.install.complete')
          }
          errorMessage={setup.error}
          buildDiagnosticsPayload={buildPayload}
          showExportAction={!setup.inProgress && !!setup.error}
          onExportAction={() => void handleExportInstallDiagnostics()}
          isExportingAction={isExportingInstallDiagnostics}
          exportActionLabel="app.buttons.saveReport"
          actionStatus={installExportStatus}
          headerAction={
            setup.inProgress ? (
              <div className="flex items-center gap-[0.8cqh]">
                <Button
                  variant="secondary"
                  autoShrinkLabel
                  label={isAbortingInstall ? 'app.buttons.aborting' : 'app.buttons.abort'}
                  className="px-[1.2cqh] py-[0.25cqh] text-[1.8cqh]"
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
                  className="px-[1.2cqh] py-[0.25cqh] text-[1.8cqh]"
                  onClick={onClose}
                  aria-label={t('app.dialogs.install.closeInstallLogs')}
                  data-default-focus
                />
              </div>
            )
          }
        />
      </FocusScope>
    </div>,
    document.body
  )
}

export default EngineInstallModal
