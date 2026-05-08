import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '../../bridge'
import { buildDiagnosticsPayload } from '../../lib/diagnosticsPayload'
import { useConnection } from '../../context/streaming/connection'
import { useEngineLifecycle } from '../../context/engineLifecycle/engineLifecycleContextValue'
import { useEngineLogs } from '../../hooks/engine/useEngineLogs'
import Button from '../ui/Button'
import ServerLogDisplay from './ServerLogDisplay'
import { FocusScope } from '../../context/focus/FocusScopeContext'
import { useTranslation } from 'react-i18next'

type EngineInstallModalProps = {
  onClose: () => void
}

const EngineInstallModal = ({ onClose }: EngineInstallModalProps) => {
  const { t } = useTranslation()
  const { server } = useConnection()
  // Install lifecycle and abort are both owned by the engine lifecycle
  // context. `abortReinstall` targets the same Electron-side
  // AbortController as the reinstall command, so cancelling propagates
  // through `uv sync` cleanly regardless of which entry kicked off the
  // install.
  const { state: lifecycleState, abortReinstall } = useEngineLifecycle()
  const installInProgress = lifecycleState.kind === 'preparing'
  const installError = lifecycleState.kind === 'failed' ? lifecycleState.error : null
  const { logs: installLogs, clear: clearInstallLogs } = useEngineLogs(true)
  const [isExportingInstallDiagnostics, setIsExportingInstallDiagnostics] = useState(false)
  const [isAbortingInstall, setIsAbortingInstall] = useState(false)
  const [installExportStatus, setInstallExportStatus] = useState<string | null>(null)

  useEffect(() => {
    if (installInProgress) {
      clearInstallLogs()
      setInstallExportStatus(null)
    }
  }, [installInProgress, clearInstallLogs])

  const buildPayload = useCallback(
    () =>
      buildDiagnosticsPayload({
        server,
        error: {
          message: installError,
          in_progress: installInProgress
        },
        // Install runs entirely on the Electron side — no WS connection
        // yet — so the Electron-process tail (pulled by the builder) is
        // the only log source.
        serverLogs: []
      }),
    [server, installError, installInProgress]
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
      await abortReinstall()
      setInstallExportStatus(t('app.dialogs.install.abortRequested'))
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
        onCancel={installInProgress ? undefined : onClose}
        className="pointer-events-auto w-[135.11cqh] max-w-[92vw]"
      >
        <ServerLogDisplay
          title="app.dialogs.install.title"
          logs={installLogs}
          showProgress={installInProgress}
          progressMessage={
            installInProgress
              ? t('app.dialogs.install.installing')
              : installError
                ? t('app.dialogs.install.failed')
                : t('app.dialogs.install.complete')
          }
          errorMessage={installError}
          buildDiagnosticsPayload={buildPayload}
          showExportAction={!installInProgress && !!installError}
          onExportAction={() => void handleExportInstallDiagnostics()}
          isExportingAction={isExportingInstallDiagnostics}
          exportActionLabel="app.buttons.saveReport"
          actionStatus={installExportStatus}
          headerAction={
            installInProgress ? (
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
