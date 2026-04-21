import { forwardRef, useCallback, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SETTINGS_MUTED_TEXT } from '../../styles'
import { buildDiagnosticsPayload } from '../../lib/diagnosticsPayload'
import { ENGINE_MODES, type Settings } from '../../types/settings'
import { useStreaming } from '../../context/streamingContextValue'
import SettingsSection from '../ui/SettingsSection'
import SettingsRow from '../ui/SettingsRow'
import SettingsCheckbox from '../ui/SettingsCheckbox'
import Button from '../ui/Button'

export type DebugTabHandle = {
  collectDraft: () => Partial<Settings>
}

type DebugTabProps = {
  settings: Settings
  active: boolean
}

const DebugTab = forwardRef<DebugTabHandle, DebugTabProps>(({ settings, active }, ref) => {
  const { t } = useTranslation()
  const { connection } = useStreaming()
  const [menuPerformanceStats, setMenuPerformanceStats] = useState(settings.debug_overlays.performance_stats)
  const [menuInputOverlay, setMenuInputOverlay] = useState(settings.debug_overlays.input)
  const [menuFrameTimeline, setMenuFrameTimeline] = useState(settings.debug_overlays.frame_timeline)
  const [menuActionLogging, setMenuActionLogging] = useState(settings.debug_overlays.action_logging)
  const [menuVideoRecording, setMenuVideoRecording] = useState(settings.debug_overlays.video_recording)
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<string | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      collectDraft: () => ({
        debug_overlays: {
          performance_stats: menuPerformanceStats,
          input: menuInputOverlay,
          frame_timeline: menuFrameTimeline,
          action_logging: menuActionLogging,
          video_recording: menuVideoRecording
        }
      })
    }),
    [menuPerformanceStats, menuInputOverlay, menuFrameTimeline, menuActionLogging, menuVideoRecording]
  )

  const handleCopyDiagnostics = useCallback(async () => {
    setDiagnosticsStatus(null)
    try {
      const isServerMode = settings.engine_mode === ENGINE_MODES.SERVER
      const payload = await buildDiagnosticsPayload({
        connection,
        error: { message: null },
        logs: [],
        session: {
          engineMode: isServerMode ? 'server' : 'standalone',
          requestedModel: settings.engine_model ?? null,
          requestedQuant: settings.engine_quant ?? null
        }
      })
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      setDiagnosticsStatus(t('app.settings.debugMetrics.copiedToClipboard'))
    } catch {
      setDiagnosticsStatus(t('app.settings.debugMetrics.copyFailed'))
    }
  }, [connection, settings.engine_mode, settings.engine_model, settings.engine_quant, t])

  return (
    <div className={active ? 'flex flex-col gap-[2.3cqh]' : 'hidden'}>
      <SettingsSection title="app.settings.debugMetrics.title" description="app.settings.debugMetrics.description">
        <div className="flex flex-col gap-[1cqh]">
          <SettingsRow
            label={t('app.settings.debugMetrics.diagnostics')}
            hint={t('app.settings.debugMetrics.diagnosticsDescription')}
            align="start"
          >
            <div className="flex items-center gap-[1.2cqh]">
              <Button
                variant="secondary"
                autoShrinkLabel
                label="app.buttons.copy"
                className="px-[1.4cqh] py-[0.2cqh] text-[2cqh]"
                onClick={() => void handleCopyDiagnostics()}
              />
              {diagnosticsStatus && (
                <span
                  className={`
                    font-serif text-[2cqh]
                    ${SETTINGS_MUTED_TEXT}
                  `}
                >
                  {diagnosticsStatus}
                </span>
              )}
            </div>
          </SettingsRow>
          <SettingsCheckbox
            label="app.settings.debugMetrics.performanceStats"
            description="app.settings.debugMetrics.performanceStatsDescription"
            checked={menuPerformanceStats}
            onChange={setMenuPerformanceStats}
          />
          <SettingsCheckbox
            label="app.settings.debugMetrics.inputOverlay"
            description="app.settings.debugMetrics.inputOverlayDescription"
            checked={menuInputOverlay}
            onChange={setMenuInputOverlay}
          />
          <SettingsCheckbox
            label="app.settings.debugMetrics.frameTimeline"
            description="app.settings.debugMetrics.frameTimelineDescription"
            checked={menuFrameTimeline}
            onChange={setMenuFrameTimeline}
          />
          <SettingsCheckbox
            label="app.settings.debugMetrics.actionLogging"
            description="app.settings.debugMetrics.actionLoggingDescription"
            checked={menuActionLogging}
            onChange={setMenuActionLogging}
          />
          <SettingsCheckbox
            label="app.settings.debugMetrics.videoRecording"
            description="app.settings.debugMetrics.videoRecordingDescription"
            checked={menuVideoRecording}
            onChange={setMenuVideoRecording}
          />
        </div>
      </SettingsSection>
    </div>
  )
})

DebugTab.displayName = 'DebugTab'

export default DebugTab
