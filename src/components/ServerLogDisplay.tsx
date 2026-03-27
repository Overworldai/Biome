import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../i18n'
import RawButton from './ui/RawButton'

const MAX_ERROR_MESSAGE_CHARS = 220
const MAX_GITHUB_BODY_CHARS = 1200
const MAX_GITHUB_LOG_LINES = 10
const MAX_GITHUB_LOG_CHARS = 450
const DISCORD_HELP_URL = 'https://discord.gg/overworld'
const GITHUB_NEW_ISSUE_URL = 'https://github.com/Overworldai/Biome/issues/new'

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text)
  }

  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      const copied = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (!copied) {
        reject(new Error('Clipboard copy command failed'))
        return
      }
      resolve()
    } catch (error) {
      reject(error)
    }
  })
}

const ServerLogDisplay = ({
  errorMessage = null,
  showProgress = false,
  progressMessage = null,
  headerAction = null,
  logs = [],
  title = null,
  buildDiagnosticsPayload,
  showExportAction = false,
  onExportAction,
  isExportingAction = false,
  exportActionLabel,
  actionStatus = null
}: {
  errorMessage?: string | null
  showProgress?: boolean
  progressMessage?: string | null
  headerAction?: ReactNode
  logs?: string[]
  title?: TranslationKey | null
  buildDiagnosticsPayload: () => Promise<Record<string, unknown>>
  showExportAction?: boolean
  onExportAction?: () => void
  isExportingAction?: boolean
  exportActionLabel?: TranslationKey
  actionStatus?: string | null
}) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [reportActionStatus, setReportActionStatus] = useState<string | null>(null)
  const [isCopyingReport, setIsCopyingReport] = useState(false)
  const [isOpeningIssue, setIsOpeningIssue] = useState(false)

  const autoScrollRef = useRef(true)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => {
      autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const displayErrorMessage =
    errorMessage && errorMessage.length > MAX_ERROR_MESSAGE_CHARS
      ? `${errorMessage.slice(0, MAX_ERROR_MESSAGE_CHARS).trimEnd()}...`
      : errorMessage

  useEffect(() => {
    const el = containerRef.current
    if (el && autoScrollRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [logs])

  const handleCopyBugReport = async () => {
    if (isCopyingReport) return
    setIsCopyingReport(true)
    setReportActionStatus(null)

    try {
      const payload = await buildDiagnosticsPayload()
      const reportText = JSON.stringify(payload, null, 2)
      await copyToClipboard(reportText)
      setReportActionStatus(t('app.loading.terminal.diagnosticsCopied'))
    } catch (error) {
      const message = error instanceof Error ? error.message : t('app.loading.terminal.failedToCopyDiagnostics')
      setReportActionStatus(message)
    } finally {
      setIsCopyingReport(false)
    }
  }

  const handleOpenGithubIssue = async () => {
    if (isOpeningIssue) return
    setIsOpeningIssue(true)
    setReportActionStatus(null)

    try {
      const payload = await buildDiagnosticsPayload()
      const reportText = JSON.stringify(payload, null, 2)
      let copiedDiagnostics = false
      try {
        await copyToClipboard(reportText)
        copiedDiagnostics = true
      } catch {
        copiedDiagnostics = false
      }

      const runtimeErrorLabel = t('app.loading.terminal.runtimeError')
      const firstLine =
        (errorMessage || progressMessage || runtimeErrorLabel).split('\n')[0]?.trim() || runtimeErrorLabel
      const issueTitle = `[Auto Bug Report] ${firstLine.slice(0, 76)}`
      const runtime = payload.runtime as Record<string, unknown> | undefined
      const appVersion = String(runtime?.app_version ?? 'unknown')
      const platform = String(runtime?.platform ?? 'unknown')
      const recentLogsRaw = logs.slice(-MAX_GITHUB_LOG_LINES).join('\n')
      const recentLogsTrimmed =
        recentLogsRaw.length > MAX_GITHUB_LOG_CHARS
          ? `${recentLogsRaw.slice(0, MAX_GITHUB_LOG_CHARS)}\n... (truncated)`
          : recentLogsRaw

      const issueBody = [
        `## ${t('app.loading.terminal.whatHappened')}`,
        t('app.loading.terminal.whatHappenedPlaceholder'),
        '',
        `## ${t('app.loading.terminal.environment')}`,
        `- ${t('app.loading.terminal.appVersion')}: ${appVersion}`,
        `- ${t('app.loading.terminal.platform')}: ${platform}`,
        '',
        `## ${t('app.loading.terminal.reproductionSteps')}`,
        '1. ',
        '2. ',
        '3. ',
        '',
        `## ${t('app.loading.terminal.recentLogs')}`,
        '```text',
        recentLogsTrimmed || '<none>',
        '```',
        '',
        `## ${t('app.loading.terminal.fullDiagnostics')}`,
        copiedDiagnostics
          ? `- ${t('app.loading.terminal.fullDiagnosticsCopied')}`
          : `- ${t('app.loading.terminal.fullDiagnosticsPaste')}`,
        '',
        '```json',
        t('app.loading.terminal.pasteDiagnosticsJson'),
        '```'
      ].join('\n')

      const clippedIssueBody =
        issueBody.length > MAX_GITHUB_BODY_CHARS
          ? `${issueBody.slice(0, MAX_GITHUB_BODY_CHARS)}\n... (truncated)`
          : issueBody

      const url = `${GITHUB_NEW_ISSUE_URL}?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(clippedIssueBody)}`
      window.open(url, '_blank', 'noopener,noreferrer')
      setReportActionStatus(
        copiedDiagnostics
          ? t('app.loading.terminal.openedGithubIssueFormAndCopiedDiagnostics')
          : t('app.loading.terminal.openedGithubIssueForm')
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : t('app.loading.terminal.failedToOpenIssueForm')
      setReportActionStatus(message)
    } finally {
      setIsOpeningIssue(false)
    }
  }

  return (
    <div className="select-text flex flex-col overflow-hidden static w-full h-full max-h-[70vh] border border-border-subtle bg-surface-modal opacity-100 !animate-none">
      {(title || headerAction) && (
        <div className="flex items-center gap-[1.42cqh] px-[2.13cqh] py-[0.8cqh] bg-white/8 border-b border-white/20 justify-between">
          <div className="flex items-center gap-[1.42cqh]">
            <span className="font-serif text-[2.13cqh] tracking-[0.02em] text-text-primary">
              {title ? t(title) : null}
            </span>
          </div>
          {headerAction}
        </div>
      )}
      <div
        className="server-log-content flex-1 px-[1.78cqh] py-[0.8cqh] overflow-y-auto font-mono text-[1.78cqh] leading-relaxed [scrollbar-color:rgba(255,255,255,0.34)_transparent]"
        ref={containerRef}
      >
        {logs.length === 0 ? (
          <div className="italic text-text-muted">{t('app.loading.terminal.waitingForServerOutput')}</div>
        ) : (
          logs.map((line, index) => (
            <div key={index} className="whitespace-pre-wrap break-all text-text-modal-muted">
              {line}
            </div>
          ))
        )}
      </div>
      {progressMessage && (
        <div className="flex items-center gap-[1.78cqh] px-[2.13cqh] py-[0.8cqh] bg-white/5 border-t border-white/10">
          {showProgress ? (
            <div className="animate-spin w-[2.13cqh] h-[2.13cqh] border-2 border-white/20 border-t-white/80 rounded-full" />
          ) : (
            <div
              className={`w-[1.42cqh] h-[1.42cqh] rounded-full ${errorMessage ? 'bg-error/90' : 'bg-hot/90'}`}
              aria-hidden="true"
            />
          )}
          <span className={`font-serif text-[1.96cqh] ${errorMessage ? 'text-error/90' : 'text-text-muted'}`}>
            {progressMessage}
          </span>
        </div>
      )}
      {displayErrorMessage && (
        <div className="flex flex-col gap-[0.4cqh] px-[2.13cqh] py-[0.8cqh] bg-white/5 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-[0.8cqh]">
              {showExportAction && onExportAction && (
                <RawButton
                  variant="secondary"
                  autoShrinkLabel
                  className="text-[2.13cqh] px-[1.4cqh] py-[0.4cqh]"
                  onClick={onExportAction}
                  disabled={isExportingAction}
                  title={t('app.loading.terminal.exportDiagnosticsJson')}
                >
                  {exportActionLabel ? (isExportingAction ? `${t(exportActionLabel)}...` : t(exportActionLabel)) : null}
                </RawButton>
              )}
              <RawButton
                variant="secondary"
                autoShrinkLabel
                className="text-[2.13cqh] px-[1.4cqh] py-[0.4cqh]"
                onClick={() => void handleCopyBugReport()}
                disabled={isCopyingReport}
                title={t('app.loading.terminal.copyDiagnosticsJsonForBugReports')}
              >
                {isCopyingReport ? t('app.loading.terminal.copying') : t('app.buttons.copyReport')}
              </RawButton>
              {(reportActionStatus || actionStatus) && (
                <span className="ml-[0.4cqh] font-serif text-[2.13cqh] text-text-muted whitespace-nowrap">
                  {reportActionStatus || actionStatus}
                </span>
              )}
            </div>
            <div className="flex items-center gap-[0.8cqh]">
              <RawButton
                variant="primary"
                autoShrinkLabel
                className="text-[2.13cqh] px-[1.4cqh] py-[0.4cqh]"
                onClick={() => void handleOpenGithubIssue()}
                disabled={isOpeningIssue}
                title={t('app.loading.terminal.openPrefilledIssueOnGithub')}
              >
                {isOpeningIssue ? t('app.loading.terminal.opening') : t('app.buttons.reportOnGithub')}
              </RawButton>
              <RawButton
                variant="primary"
                autoShrinkLabel
                className="text-[2.13cqh] px-[1.4cqh] py-[0.4cqh]"
                onClick={() => window.open(DISCORD_HELP_URL, '_blank', 'noopener,noreferrer')}
                title={t('app.loading.terminal.askForHelpInDiscord')}
              >
                {t('app.buttons.askOnDiscord')}
              </RawButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ServerLogDisplay
