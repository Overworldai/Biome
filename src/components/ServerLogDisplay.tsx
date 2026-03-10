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

// Determine log line color class based on content
const getLogClass = (line: string): string => {
  if (line.includes('[ERROR]') || line.includes('FATAL') || line.includes('Error:')) {
    return 'text-text-error'
  }
  if (line.includes('[WARNING]') || line.includes('Warning:')) {
    return 'text-warm/90'
  }
  if (line.includes('[INFO]')) {
    return 'text-hud/90'
  }
  if (line.includes('100%') || line.includes('SERVER READY') || line.includes('complete')) {
    return 'text-hot/90'
  }
  return ''
}

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
  showDismiss = false,
  onDismiss,
  errorMessage = null,
  showProgress = false,
  progressMessage = null,
  headerAction = null,
  variant = 'default',
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
  showDismiss?: boolean
  onDismiss?: () => void
  errorMessage?: string | null
  showProgress?: boolean
  progressMessage?: string | null
  headerAction?: ReactNode
  variant?: 'default' | 'loading-inline'
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
  const isLoadingInline = variant === 'loading-inline'
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
        variant,
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
    <div
      className={`select-text flex flex-col overflow-hidden ${isLoadingInline ? 'static w-full h-full max-h-[70vh] border border-border-subtle bg-surface-modal opacity-100 !animate-none' : 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] max-h-[50%] z-100 bg-[rgba(8,12,16,0.95)] border border-warm/30 rounded-[1.42cqh] opacity-0 animate-[serverLogFadeIn_0.3s_ease_forwards] shadow-[0_0_30px_rgba(0,0,0,0.6),0_0_15px_rgba(255,200,100,0.1)]'}`}
    >
      {(!isLoadingInline || title || headerAction) && (
        <div
          className={`flex items-center gap-[1.42cqh] px-[2.13cqh] py-[0.8cqh] ${isLoadingInline ? 'bg-white/8 border-b border-white/20 justify-between' : 'bg-warm/8 border-b border-warm/20'}`}
        >
          <div className="flex items-center gap-[1.42cqh]">
            <span
              className={`font-mono text-[2.13cqh] tracking-wider ${isLoadingInline ? 'font-serif tracking-[0.02em] text-text-primary' : 'uppercase text-warm/90'}`}
            >
              {title ?? (showProgress ? 'INSTALLING WORLD ENGINE' : 'ENGINE OUTPUT')}
            </span>
            {!isLoadingInline && (
              <span
                className={`w-[1.07cqh] h-[1.07cqh] rounded-full bg-warm/90 ${showDismiss ? 'bg-error-muted !animate-none' : 'animate-[indicatorPulse_1s_ease-in-out_infinite]'}`}
              />
            )}
          </div>
          {headerAction}
        </div>
      )}
      {progressMessage && !isLoadingInline && (
        <div className="flex items-center gap-[1.78cqh] px-[2.13cqh] py-[0.8cqh] bg-hud/8 border-b border-hud/20">
          {showProgress ? (
            <div className="animate-spin w-[2.13cqh] h-[2.13cqh] border-2 border-hud/30 border-t-hud/90 rounded-full" />
          ) : (
            <div
              className={`w-[1.42cqh] h-[1.42cqh] rounded-full ${errorMessage ? 'bg-error/90' : 'bg-hot/90'}`}
              aria-hidden="true"
            />
          )}
          <span className={`font-mono text-[1.96cqh] ${errorMessage ? 'text-error/90' : 'text-hud/90'}`}>
            {progressMessage}
          </span>
        </div>
      )}
      {displayErrorMessage && (
        <div className="flex flex-col gap-[0.4cqh] px-[2.13cqh] py-[0.8cqh] bg-error/10 border-b border-error/30">
          <div className={`${isLoadingInline ? 'font-serif' : 'font-mono'} text-[1.96cqh] text-error/90`}>
            {displayErrorMessage}
          </div>
          <div className={`${isLoadingInline ? 'font-serif' : 'font-mono'} text-[1.6cqh] text-white/50 italic`}>
            Open Settings to reinstall the engine.
          </div>
          <div className="flex items-center gap-[0.8cqh] pt-[0.25cqh]">
            {showExportAction && onExportAction && (
              <Button
                variant="ghost"
                className="text-[1.8cqh] px-[1.2cqh] py-[0.25cqh]"
                onClick={onExportAction}
                disabled={isExportingAction}
                title="Export diagnostics JSON"
              >
                {isExportingAction ? 'Exporting...' : exportActionLabel}
              </Button>
            )}
            <Button
              variant="ghost"
              className="text-[1.8cqh] px-[1.2cqh] py-[0.25cqh]"
              onClick={() => void handleCopyBugReport()}
              disabled={isCopyingReport}
              title="Copy diagnostics JSON for bug reports"
            >
              {isCopyingReport ? 'Copying...' : 'Copy Report'}
            </Button>
            <Button
              variant="ghost"
              className="text-[1.8cqh] px-[1.2cqh] py-[0.25cqh]"
              onClick={() => void handleOpenGithubIssue()}
              disabled={isOpeningIssue}
              title="Open prefilled issue on GitHub"
            >
              {isOpeningIssue ? 'Opening...' : 'Report on GitHub'}
            </Button>
            <Button
              variant="ghost"
              className="text-[1.8cqh] px-[1.2cqh] py-[0.25cqh]"
              onClick={() => window.open(DISCORD_HELP_URL, '_blank', 'noopener,noreferrer')}
              title="Ask for help in Discord"
            >
              Ask on Discord
            </Button>
          </div>
          {reportActionStatus && <div className="font-serif text-[1.7cqh] text-text-muted">{reportActionStatus}</div>}
        </div>
      )}
      <div
        className={`server-log-content flex-1 px-[1.78cqh] py-[0.8cqh] overflow-y-auto font-mono text-[1.78cqh] leading-relaxed ${isLoadingInline ? '[scrollbar-color:rgba(255,255,255,0.34)_transparent]' : ''}`}
        ref={containerRef}
      >
        {visibleLogs.length === 0 ? (
          <div className={`italic ${isLoadingInline ? 'text-text-muted' : 'text-warm/50'}`}>
            Waiting for server output...
          </div>
        ) : (
          visibleLogs.map((line, index) => (
            <div
              key={index}
              className={`whitespace-pre-wrap break-all ${isLoadingInline ? 'text-text-modal-muted' : `text-[rgba(200,200,200,0.9)] ${getLogClass(line)}`}`}
            >
              {line}
            </div>
          ))
        )}
      </div>
      {progressMessage && isLoadingInline && (
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
      {showDismiss && (
        <Button
          variant="danger"
          className="mx-[2.13cqh] my-[1cqh] px-[2.67cqh] py-[0.6cqh] text-[1.78cqh] tracking-wider"
          onClick={onDismiss}
        >
          DISMISS
        </Button>
      )}
    </div>
  )
}

export default ServerLogDisplay
