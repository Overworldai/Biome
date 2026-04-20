import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TranslatableError, type TranslationKey } from '../i18n'
import type { DiagnosticsPayload } from '../types/ipc'
import Button from './ui/Button'
import { findFocusables, findInDirection, focusSmooth } from '../lib/focusNavigation'
import { getActiveScopeRoot } from '../context/FocusScopeContext'

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
        reject(new TranslatableError('app.loading.terminal.clipboardCopyFailed'))
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
  actionStatus = null,
  primaryAction = null
}: {
  errorMessage?: string | null
  showProgress?: boolean
  progressMessage?: string | null
  headerAction?: ReactNode
  logs?: string[]
  title?: TranslationKey | null
  buildDiagnosticsPayload: () => Promise<DiagnosticsPayload>
  showExportAction?: boolean
  onExportAction?: () => void
  isExportingAction?: boolean
  exportActionLabel?: TranslationKey
  actionStatus?: string | null
  /** Rendered at the far right of the footer action row.  Use for the one
   *  primary CTA of the surrounding screen (e.g. "Return to Main Menu") so
   *  all report/help buttons are secondary and the primary stands out. */
  primaryAction?: ReactNode
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
      const appVersion = payload.app.version
      const platform = payload.client.os
      const gpuName = payload.server?.gpu ?? 'unknown'
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
        `- GPU: ${gpuName}`,
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
          ? `- ${t('app.loading.terminal.fullDiagnosticsCopiedHint')}`
          : `- ${t('app.loading.terminal.fullDiagnosticsCopyHint')}`,
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
    <div
      className="
        static flex size-full max-h-[70vh] animate-none! flex-col overflow-hidden border border-border-subtle
        bg-surface-modal opacity-100 select-text
      "
    >
      {(title || headerAction) && (
        <div
          className="
            flex items-center justify-between gap-[1.42cqh] border-b border-white/20 bg-white/8 px-[2.13cqh] py-[0.8cqh]
          "
        >
          <div className="flex items-center gap-[1.42cqh]">
            <span className="font-serif text-[2.13cqh] tracking-[0.02em] text-text-primary">
              {title ? t(title) : null}
            </span>
          </div>
          {headerAction}
        </div>
      )}
      <div
        tabIndex={0}
        aria-label={t('app.loading.terminal.serverOutput', { defaultValue: 'Server log output' })}
        className="
          server-log-content flex-1 overflow-y-auto px-[1.78cqh] py-[0.8cqh] font-mono text-[1.78cqh] leading-relaxed
          [scrollbar-color:rgba(255,255,255,0.34)_transparent]
          focus:outline focus:outline-2 focus:outline-border-medium
        "
        ref={containerRef}
        onKeyDown={(e) => {
          // Allow gamepad d-pad (dispatched as arrow keys) to scroll the log pane.
          // At scroll boundaries and on Escape, release focus so the user can
          // navigate back out instead of getting stuck inside the logs.
          const el = e.currentTarget
          const moveOut = (direction: 'up' | 'down') => {
            const target = findInDirection(el, findFocusables(getActiveScopeRoot()), direction)
            if (target) focusSmooth(target)
            else el.blur()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            moveOut('up')
            return
          }
          if (e.key === 'ArrowUp') {
            if (el.scrollTop <= 0) {
              e.preventDefault()
              moveOut('up')
              return
            }
            e.preventDefault()
            el.scrollBy({ top: -el.clientHeight * 0.25, behavior: 'smooth' })
          } else if (e.key === 'ArrowDown') {
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
              e.preventDefault()
              moveOut('down')
              return
            }
            e.preventDefault()
            el.scrollBy({ top: el.clientHeight * 0.25, behavior: 'smooth' })
          }
        }}
      >
        {logs.length === 0 ? (
          <div className="text-text-muted italic">{t('app.loading.terminal.waitingForServerOutput')}</div>
        ) : (
          logs.map((line, index) => (
            <div key={index} className="break-all whitespace-pre-wrap text-text-modal-muted">
              {line}
            </div>
          ))
        )}
      </div>
      {progressMessage && (
        <div className="flex items-center gap-[1.78cqh] border-t border-white/10 bg-white/5 px-[2.13cqh] py-[0.8cqh]">
          {showProgress ? (
            <div className="h-[2.13cqh] w-[2.13cqh] animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          ) : (
            <div
              className={`
                h-[1.42cqh] w-[1.42cqh] rounded-full
                ${errorMessage ? 'bg-error/90' : 'bg-hot/90'}
              `}
              aria-hidden="true"
            />
          )}
          <span
            className={`
              font-serif text-[1.96cqh]
              ${errorMessage ? 'text-error/90' : 'text-text-muted'}
            `}
          >
            {progressMessage}
          </span>
        </div>
      )}
      {displayErrorMessage && (
        <div className="flex flex-col gap-[0.4cqh] border-t border-white/10 bg-white/5 px-[2.13cqh] py-[0.8cqh]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-[0.8cqh]">
              <Button
                variant="secondary"
                autoShrinkLabel
                label={isCopyingReport ? 'app.loading.terminal.copying' : 'app.buttons.copyReport'}
                className="px-[1.4cqh] py-[0.4cqh] text-[2.13cqh]"
                onClick={() => void handleCopyBugReport()}
                disabled={isCopyingReport}
                title={t('app.loading.terminal.copyDiagnosticsJsonForBugReports')}
              />
              {showExportAction && onExportAction && exportActionLabel && (
                <Button
                  variant="secondary"
                  autoShrinkLabel
                  label={exportActionLabel}
                  className="px-[1.4cqh] py-[0.4cqh] text-[2.13cqh]"
                  onClick={onExportAction}
                  disabled={isExportingAction}
                  title={t('app.loading.terminal.saveDiagnosticsJson')}
                />
              )}
              {(reportActionStatus || actionStatus) && (
                <span className="ml-[0.4cqh] font-serif text-[2.13cqh] whitespace-nowrap text-text-muted">
                  {reportActionStatus || actionStatus}
                </span>
              )}
            </div>
            <div className="flex items-center gap-[0.8cqh]">
              <Button
                variant={primaryAction ? 'secondary' : 'primary'}
                autoShrinkLabel
                label={isOpeningIssue ? 'app.loading.terminal.opening' : 'app.buttons.reportOnGithub'}
                className="px-[1.4cqh] py-[0.4cqh] text-[2.13cqh]"
                onClick={() => void handleOpenGithubIssue()}
                disabled={isOpeningIssue}
                title={t('app.loading.terminal.openPrefilledIssueOnGithub')}
              />
              <Button
                variant={primaryAction ? 'secondary' : 'primary'}
                autoShrinkLabel
                label="app.buttons.askOnDiscord"
                className="px-[1.4cqh] py-[0.4cqh] text-[2.13cqh]"
                onClick={() => window.open(DISCORD_HELP_URL, '_blank', 'noopener,noreferrer')}
                title={t('app.loading.terminal.askForHelpInDiscord')}
              />
              {primaryAction}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ServerLogDisplay
