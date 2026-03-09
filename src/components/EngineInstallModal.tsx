import { useCallback, useEffect, useState } from 'react'
import { invoke, listen } from '../bridge'
import { useStreaming } from '../context/StreamingContext'
import ServerLogDisplay from './ServerLogDisplay'

type EngineInstallModalProps = {
  onClose: () => void
}

const EngineInstallModal = ({ onClose }: EngineInstallModalProps) => {
  const { engineSetupInProgress, setupProgress, engineSetupError, abortEngineSetup } = useStreaming()
  const [installLogs, setInstallLogs] = useState<string[]>([])
  const [isExportingInstallDiagnostics, setIsExportingInstallDiagnostics] = useState(false)
  const [isAbortingInstall, setIsAbortingInstall] = useState(false)
  const [installExportStatus, setInstallExportStatus] = useState<string | null>(null)

  useEffect(() => {
    setInstallLogs([])
    const unlisten = listen('engine-install-log', (payload) => {
      setInstallLogs((prev) => {
        const next = [...prev, payload.line]
        if (next.length > 360) next.shift()
        return next
      })
    })
    return unlisten
  }, [])

  useEffect(() => {
    if (engineSetupInProgress) {
      setInstallLogs([])
      setInstallExportStatus(null)
    }
  }, [engineSetupInProgress])

  const buildDiagnosticsPayload = useCallback(async () => {
    const meta = await invoke('get-runtime-diagnostics-meta')
    const system = await invoke('get-system-diagnostics')
    return {
      generated_at: new Date().toISOString(),
      runtime: meta,
      system,
      install_state: {
        engine_setup_in_progress: engineSetupInProgress,
        setup_progress: setupProgress,
        engine_setup_error: engineSetupError
      },
      logs: installLogs
    }
  }, [engineSetupError, engineSetupInProgress, installLogs, setupProgress])

  const handleExportInstallDiagnostics = async () => {
    if (isExportingInstallDiagnostics) return

    setIsExportingInstallDiagnostics(true)
    setInstallExportStatus(null)
    try {
      const report = await buildDiagnosticsPayload()

      const result = await invoke('export-loading-diagnostics', JSON.stringify(report, null, 2))
      if (result.canceled) {
        setInstallExportStatus('Export canceled')
      } else {
        setInstallExportStatus('Diagnostics exported')
      }
    } catch (exportErr) {
      const message = exportErr instanceof Error ? exportErr.message : 'Export failed'
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
      setInstallExportStatus(message || 'Abort requested')
    } catch (abortErr) {
      const message = abortErr instanceof Error ? abortErr.message : 'Failed to abort install'
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
      <div className="w-[135.11cqh] max-w-[92vw] pointer-events-auto">
        <ServerLogDisplay
          variant="loading-inline"
          title="WORLD ENGINE INSTALL"
          externalLogs={installLogs}
          showProgress={engineSetupInProgress}
          progressMessage={
            engineSetupInProgress
              ? setupProgress || 'Installing World Engine...'
              : engineSetupError
                ? 'World Engine installation failed.'
                : 'World Engine installation complete.'
          }
          errorMessage={engineSetupError}
          reportContext={{
            flow: 'engine-install',
            engine_setup_in_progress: engineSetupInProgress,
            setup_progress: setupProgress,
            engine_setup_error: engineSetupError
          }}
          buildDiagnosticsPayload={buildDiagnosticsPayload}
          showExportAction={!engineSetupInProgress && !!engineSetupError}
          onExportAction={() => void handleExportInstallDiagnostics()}
          isExportingAction={isExportingInstallDiagnostics}
          exportActionLabel="Export Logs"
          showDismiss={false}
          headerAction={
            engineSetupInProgress ? (
              <div className="flex items-center gap-[0.8cqh]">
                <button
                  type="button"
                  className="loading-inline-logs-close"
                  onClick={() => void handleAbortInstall()}
                  disabled={isAbortingInstall}
                  aria-label="Abort engine install"
                >
                  {isAbortingInstall ? 'Aborting...' : 'Abort'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-[0.8cqh]">
                <button
                  type="button"
                  className="loading-inline-logs-close"
                  onClick={onClose}
                  aria-label="Close install logs"
                >
                  Close
                </button>
              </div>
            )
          }
        />
        {installExportStatus && (
          <div className="mt-[0.45cqh] text-right font-serif text-[2cqh] leading-[1.1] text-[rgba(245,249,255,0.78)]">
            {installExportStatus}
          </div>
        )}
      </div>
    </div>
  )
}

export default EngineInstallModal
