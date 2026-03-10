import { useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke } from '../bridge'
import Button from './ui/Button'

const MAX_ERROR_MESSAGE_CHARS = 220
const MAX_REPORT_LOG_LINES = 220
const MAX_GITHUB_BODY_CHARS = 1200
const MAX_GITHUB_LOG_LINES = 10
const MAX_GITHUB_LOG_CHARS = 450
const DISCORD_HELP_URL = 'https://discord.gg/overworld'
const GITHUB_NEW_ISSUE_URL = 'https://github.com/Overworldai/Biome/issues/new'

type ReportContext = Record<string, unknown>

function sanitizeText(text: string): string {
  return text
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/g, 'C:\\Users\\<redacted>')
    .replace(/\/Users\/[^/\r\n]+/g, '/Users/<redacted>')
    .replace(/\/home\/[^/\r\n]+/g, '/home/<redacted>')
}

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
  externalLogs = null,
  pollLogFileTail = false,
  logTailLines = 300,
  logTailIntervalMs = 700,
  title = null,
  onLogsChange,
  reportContext,
  buildDiagnosticsPayload,
  showExportAction = false,
  onExportAction,
  isExportingAction = false,
  exportActionLabel = 'Export Logs'
}: {
  errorMessage?: string | null
  showProgress?: boolean
  progressMessage?: string | null
  headerAction?: ReactNode
  externalLogs?: string[] | null
  pollLogFileTail?: boolean
  logTailLines?: number
  logTailIntervalMs?: number
  title?: string | null
  onLogsChange?: (logs: string[]) => void
  reportContext?: ReportContext
  buildDiagnosticsPayload?: () => Promise<Record<string, unknown>>
  showExportAction?: boolean
  onExportAction?: () => void
  isExportingAction?: boolean
  exportActionLabel?: string
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [reportActionStatus, setReportActionStatus] = useState<string | null>(null)
  const [isCopyingReport, setIsCopyingReport] = useState(false)
  const [isOpeningIssue, setIsOpeningIssue] = useState(false)

  useEffect(() => {
    if (externalLogs !== null) return

    if (!pollLogFileTail) {
      setLogs([])
      return
    }

    let mounted = true
    const poll = async () => {
      try {
        const lines = await invoke('read-server-log-tail', logTailLines)
        if (!mounted) return
        setLogs(lines.map((line) => String(line ?? '')))
      } catch {
        // Ignore poll failures; next interval may recover.
      }
    }

    void poll()
    const intervalId = window.setInterval(() => {
      void poll()
    }, logTailIntervalMs)

    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [externalLogs, pollLogFileTail, logTailLines, logTailIntervalMs])

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

  const visibleLogs = externalLogs ?? logs
  const displayErrorMessage =
    errorMessage && errorMessage.length > MAX_ERROR_MESSAGE_CHARS
      ? `${errorMessage.slice(0, MAX_ERROR_MESSAGE_CHARS).trimEnd()}...`
      : errorMessage

  useEffect(() => {
    onLogsChange?.(visibleLogs)
  }, [visibleLogs, onLogsChange])

  useEffect(() => {
    const el = containerRef.current
    if (el && autoScrollRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [visibleLogs])

  const buildDiagnosticsFallbackPayload = async (): Promise<Record<string, unknown>> => {
    const runtimeMeta = await invoke('get-runtime-diagnostics-meta')
    const system = await invoke('get-system-diagnostics')
    const trimmedLogs = visibleLogs.slice(-MAX_REPORT_LOG_LINES).map((line) => sanitizeText(String(line ?? '')))
    const safeError = errorMessage ? sanitizeText(errorMessage) : null
    const safeProgress = progressMessage ? sanitizeText(progressMessage) : null

    const report = {
      generated_at: new Date().toISOString(),
      runtime: runtimeMeta,
      system,
      context: reportContext ?? {},
      ui_state: {
        title,
        show_progress: showProgress,
        progress_message: safeProgress
      },
      error_message: safeError,
      logs: trimmedLogs
    }

    return report
  }

  const handleCopyBugReport = async () => {
    if (isCopyingReport) return
    setIsCopyingReport(true)
    setReportActionStatus(null)

    try {
      const payload = buildDiagnosticsPayload
        ? await buildDiagnosticsPayload()
        : await buildDiagnosticsFallbackPayload()
      const reportText = JSON.stringify(payload, null, 2)
      await copyToClipboard(reportText)
      setReportActionStatus('Diagnostics copied')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to copy diagnostics'
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
      const payload = buildDiagnosticsPayload
        ? await buildDiagnosticsPayload()
        : await buildDiagnosticsFallbackPayload()
      const reportText = JSON.stringify(payload, null, 2)
      let copiedDiagnostics = false
      try {
        await copyToClipboard(reportText)
        copiedDiagnostics = true
      } catch {
        copiedDiagnostics = false
      }

      const firstLine = (errorMessage || progressMessage || 'Runtime error').split('\n')[0]?.trim() || 'Runtime error'
      const issueTitle = `[Auto Bug Report] ${firstLine.slice(0, 76)}`
      const runtime = payload.runtime as Record<string, unknown> | undefined
      const appVersion = String(runtime?.app_version ?? 'unknown')
      const platform = String(runtime?.platform ?? 'unknown')
      const recentLogsRaw = visibleLogs.slice(-MAX_GITHUB_LOG_LINES).join('\n')
      const recentLogsTrimmed =
        recentLogsRaw.length > MAX_GITHUB_LOG_CHARS
          ? `${recentLogsRaw.slice(0, MAX_GITHUB_LOG_CHARS)}\n... (truncated)`
          : recentLogsRaw

      const issueBody = [
        '## What happened',
        '<please describe what you were doing and what failed>',
        '',
        '## Environment',
        `- App version: ${appVersion}`,
        `- Platform: ${platform}`,
        '',
        '## Reproduction steps',
        '1. ',
        '2. ',
        '3. ',
        '',
        '## Recent logs',
        '```text',
        recentLogsTrimmed || '<none>',
        '```',
        '',
        '## Full diagnostics',
        copiedDiagnostics
          ? '- Full diagnostics JSON has been copied to clipboard. Paste it below before submitting.'
          : '- Click "Copy Report" in-app and paste diagnostics JSON below.',
        '',
        '```json',
        '<paste full diagnostics JSON here>',
        '```'
      ].join('\n')

      const clippedIssueBody =
        issueBody.length > MAX_GITHUB_BODY_CHARS
          ? `${issueBody.slice(0, MAX_GITHUB_BODY_CHARS)}\n... (truncated)`
          : issueBody

      const url = `${GITHUB_NEW_ISSUE_URL}?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(clippedIssueBody)}`
      window.open(url, '_blank', 'noopener,noreferrer')
      setReportActionStatus(
        copiedDiagnostics ? 'Opened GitHub issue form and copied diagnostics' : 'Opened GitHub issue form'
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open issue form'
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
            <span className="font-serif text-[2.13cqh] tracking-[0.02em] text-text-primary">{title}</span>
          </div>
          {headerAction}
        </div>
      )}
      <div
        className="server-log-content flex-1 px-[1.78cqh] py-[0.8cqh] overflow-y-auto font-mono text-[1.78cqh] leading-relaxed [scrollbar-color:rgba(255,255,255,0.34)_transparent]"
        ref={containerRef}
      >
        {visibleLogs.length === 0 ? (
          <div className="italic text-text-muted">Waiting for server output...</div>
        ) : (
          visibleLogs.map((line, index) => (
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
                <Button
                  variant="secondary"
                  className="text-[2.13cqh] px-[1.4cqh] py-[0.4cqh]"
                  onClick={onExportAction}
                  disabled={isExportingAction}
                  title="Export diagnostics JSON"
                >
                  {isExportingAction ? 'Exporting...' : exportActionLabel}
                </Button>
              )}
              <Button
                variant="secondary"
                className="text-[2.13cqh] px-[1.4cqh] py-[0.4cqh]"
                onClick={() => void handleCopyBugReport()}
                disabled={isCopyingReport}
                title="Copy diagnostics JSON for bug reports"
              >
                {isCopyingReport ? 'Copying...' : 'Copy Report'}
              </Button>
            </div>
            <div className="flex items-center gap-[0.8cqh]">
              <Button
                variant="primary"
                className="text-[2.13cqh] px-[1.4cqh] py-[0.4cqh]"
                onClick={() => void handleOpenGithubIssue()}
                disabled={isOpeningIssue}
                title="Open prefilled issue on GitHub"
              >
                {isOpeningIssue ? 'Opening...' : 'Report on GitHub'}
              </Button>
              <Button
                variant="primary"
                className="text-[2.13cqh] px-[1.4cqh] py-[0.4cqh]"
                onClick={() => window.open(DISCORD_HELP_URL, '_blank', 'noopener,noreferrer')}
                title="Ask for help in Discord"
              >
                Ask on Discord
              </Button>
            </div>
          </div>
          {reportActionStatus && <div className="font-serif text-[1.7cqh] text-text-muted">{reportActionStatus}</div>}
        </div>
      )}
    </div>
  )
}

export default ServerLogDisplay
