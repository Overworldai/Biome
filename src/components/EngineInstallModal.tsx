import { useState } from 'react'
import { invoke } from '../bridge'
import { useStreaming } from '../context/StreamingContext'
import ServerLogDisplay from './ServerLogDisplay'

type EngineInstallModalProps = {
  onClose: () => void
}

const EngineInstallModal = ({ onClose }: EngineInstallModalProps) => {
  const { engineSetupInProgress, setupProgress, engineSetupError } = useStreaming()
  const [installLogs, setInstallLogs] = useState<string[]>([])
  const [isExportingInstallDiagnostics, setIsExportingInstallDiagnostics] = useState(false)
  const [installExportStatus, setInstallExportStatus] = useState<string | null>(null)

  const handleExportInstallDiagnostics = async () => {
    if (isExportingInstallDiagnostics) return

    setIsExportingInstallDiagnostics(true)
    setInstallExportStatus(null)
    try {
      const meta = await invoke('get-runtime-diagnostics-meta')
      const report = {
        generated_at: new Date().toISOString(),
        runtime: meta,
        install_state: {
          engine_setup_in_progress: engineSetupInProgress,
          setup_progress: setupProgress,
          engine_setup_error: engineSetupError
        },
        logs: installLogs
      }

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

  return (
    <div className="absolute inset-0 z-[12] pointer-events-none flex items-center justify-center bg-[var(--color-overlay-scrim)] backdrop-blur-sm">
      <div className="w-[135.11cqh] max-w-[92vw] pointer-events-auto">
        <ServerLogDisplay
          variant="loading-inline"
          title="WORLD ENGINE INSTALL"
          showProgress={engineSetupInProgress}
          progressMessage={
            engineSetupInProgress
              ? setupProgress || 'Installing World Engine...'
              : engineSetupError
                ? 'World Engine installation failed.'
                : 'World Engine installation complete.'
          }
          errorMessage={engineSetupError}
          showDismiss={false}
          onLogsChange={setInstallLogs}
          headerAction={
            !engineSetupInProgress ? (
              <div className="flex items-center gap-[0.8cqh]">
                {engineSetupError && (
                  <button
                    type="button"
                    className="loading-inline-logs-close"
                    onClick={() => void handleExportInstallDiagnostics()}
                    disabled={isExportingInstallDiagnostics}
                    title="Export installation logs and environment diagnostics"
                  >
                    {isExportingInstallDiagnostics ? 'Exporting...' : 'Export Logs'}
                  </button>
                )}
                <button
                  type="button"
                  className="loading-inline-logs-close"
                  onClick={onClose}
                  aria-label="Close install logs"
                >
                  Close
                </button>
              </div>
            ) : null
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
