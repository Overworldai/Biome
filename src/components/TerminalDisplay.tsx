import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke, listen } from '../bridge'
import { usePortal } from '../context/PortalContext'
import { useStreaming } from '../context/StreamingContext'
import { useConfig } from '../hooks/useConfig'
import { INTERACTIVE_TRANSITION } from '../styles'
import OverlayModal from './ui/OverlayModal'
import ServerLogDisplay from './ServerLogDisplay'

type TerminalDisplayProps = {
  onCancel?: (options?: { shutdownHosted?: boolean }) => void
  keepVisible?: boolean
}

const TerminalDisplay = ({ onCancel, keepVisible = false }: TerminalDisplayProps) => {
  const { state, states } = usePortal()
  const { connectionState, statusStage, engineError, error, cancelConnection, endpointUrl } = useStreaming()
  const { isServerMode, getUrl } = useConfig()
  const [showLogsModal, setShowLogsModal] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [logCursor, setLogCursor] = useState<number | null>(null)
  const [logError, setLogError] = useState<string | null>(null)
  const [fallbackStage, setFallbackStage] = useState<{ id: string; label: string; percent: number } | null>(null)

  const currentStage = statusStage ?? fallbackStage
  const progressPercent = currentStage ? Math.max(0, Math.min(100, Math.round(currentStage.percent))) : 0
  const statusText = useMemo(() => {
    if (engineError || error) return 'Error'
    if (currentStage?.label) return currentStage.label
    if (connectionState === 'connecting') return 'Connecting...'
    return 'Starting...'
  }, [connectionState, currentStage?.label, engineError, error])

  const resolveHostedBaseUrl = useCallback(() => {
    if (endpointUrl) {
      if (endpointUrl.startsWith('http://') || endpointUrl.startsWith('https://')) return endpointUrl
      if (endpointUrl.startsWith('ws://')) return `http://${endpointUrl.slice(5)}`
      if (endpointUrl.startsWith('wss://')) return `https://${endpointUrl.slice(6)}`
      return `http://${endpointUrl}`
    }
    return getUrl()
  }, [endpointUrl, getUrl])

  useEffect(() => {
    if (!showLogsModal || !isServerMode) return
    setLogLines([])
    setLogCursor(null)
    setLogError(null)
  }, [isServerMode, showLogsModal])

  useEffect(() => {
    if (!showLogsModal || !isServerMode) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let cursor = logCursor

    const pollLogs = async () => {
      try {
        const result = await invoke('fetch-server-admin-logs', resolveHostedBaseUrl(), cursor, 200)
        if (cancelled) return
        if (result.lines.length > 0) {
          setLogLines((prev) => [...prev, ...result.lines].slice(-500))
        }
        cursor = result.next_cursor
        setLogCursor(cursor)
        setLogError(null)
      } catch (err) {
        if (cancelled) return
        setLogError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) {
          timer = setTimeout(pollLogs, 1000)
        }
      }
    }

    void pollLogs()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [isServerMode, resolveHostedBaseUrl, showLogsModal])

  useEffect(() => {
    const unlisten = listen('server-stage', (payload) => {
      if (typeof payload.id !== 'string' || typeof payload.label !== 'string' || typeof payload.percent !== 'number') {
        return
      }
      setFallbackStage({
        id: payload.id,
        label: payload.label,
        percent: Math.max(0, Math.min(100, Math.round(payload.percent)))
      })
    })
    return () => unlisten()
  }, [])

  if (state !== states.LOADING && !keepVisible) return null

  return (
    <>
      <div className="terminal-display absolute z-55 flex flex-col items-center top-auto bottom-[var(--edge-bottom)] left-1/2 -translate-x-1/2 gap-[1.6cqh] opacity-100 !animate-none w-[135.11cqh] pb-[8.2cqh]">
        <div className="flex flex-col items-center gap-[0.55cqh] w-[135.11cqh]">
          <div
            className="flex items-center font-serif text-[4.62cqh] font-normal tracking-[0.01em] normal-case text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.45)] max-w-[117.35cqh] text-center"
            id="terminal-status"
          >
            <span className="text-white">{statusText}</span>
          </div>

          <div className="flex items-center w-[135.11cqh] mx-auto justify-center">
            <div className="relative overflow-hidden w-full h-[0.9cqh] m-0 border border-[rgba(255,255,255,0.78)] bg-[rgba(255,255,255,0.08)] before:hidden">
              <div
                className="absolute left-0 top-0 h-full bg-[linear-gradient(90deg,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.95)_70%,rgba(255,255,255,0.82)_100%)]"
                style={{ width: `${progressPercent}%`, transition: 'width 220ms ease' }}
              />
            </div>
          </div>
        </div>

        <div className="absolute left-1/2 bottom-0 -translate-x-1/2 flex items-center gap-[1.2cqh]">
          <button
            className={`mt-0 !animate-none leading-[1.1] whitespace-nowrap font-serif text-[3.2cqh] tracking-[0.02em] normal-case text-[rgba(235,245,255,0.98)] border border-[rgba(170,205,255,0.85)] bg-[rgba(10,34,60,0.55)] rounded-none py-[0.55cqh] px-[2.8cqh] cursor-pointer outline-0 outline-[rgba(170,205,255,0.98)] ${INTERACTIVE_TRANSITION} duration-150 hover:text-white hover:border-[rgba(205,225,255,0.98)] hover:bg-[rgba(20,56,92,0.66)] hover:outline-2`}
            onClick={() => {
              setShowLogsModal(true)
            }}
          >
            Show Logs
          </button>
          <button
            className={`mt-0 !animate-none leading-[1.1] whitespace-nowrap font-serif text-[3.73cqh] tracking-[0.02em] normal-case text-[rgba(255,235,235,0.98)] border border-[rgba(255,110,110,0.9)] bg-[rgba(130,0,0,0.56)] rounded-none py-[0.55cqh] px-[3.91cqh] cursor-pointer outline-0 outline-[rgba(255,170,170,0.98)] ${INTERACTIVE_TRANSITION} duration-150 hover:text-white hover:border-[rgba(255,170,170,0.98)] hover:bg-[rgba(180,8,8,0.68)] hover:outline-2`}
            onClick={() => {
              if (isServerMode) {
                setShowCancelModal(true)
                return
              }
              if (onCancel) {
                onCancel()
                return
              }
              void cancelConnection()
            }}
          >
            Cancel
          </button>
        </div>
      </div>

      <OverlayModal
        open={showLogsModal}
        title="Engine Logs"
        onClose={() => setShowLogsModal(false)}
        widthClassName="w-[128cqh]"
      >
        {isServerMode ? (
          <ServerLogDisplay
            variant="loading-inline"
            disableLiveIpc={true}
            externalLogs={logLines}
            errorMessage={logError}
            title="HOSTED SERVER OUTPUT"
          />
        ) : (
          <ServerLogDisplay variant="loading-inline" />
        )}
      </OverlayModal>

      <OverlayModal
        open={showCancelModal}
        title="Cancel Loading"
        onClose={() => setShowCancelModal(false)}
        actions={
          <>
            <button
              type="button"
              className="border border-[rgba(245,251,255,0.7)] bg-[rgba(8,12,20,0.18)] text-[rgba(245,251,255,0.95)] font-serif text-[2.4cqh] px-[1.8cqh] py-[0.45cqh]"
              onClick={() => setShowCancelModal(false)}
            >
              Keep Loading
            </button>
            <button
              type="button"
              className="border border-[rgba(255,180,180,0.8)] bg-[rgba(130,0,0,0.4)] text-[rgba(255,235,235,0.98)] font-serif text-[2.4cqh] px-[1.8cqh] py-[0.45cqh]"
              onClick={() => {
                setShowCancelModal(false)
                if (onCancel) {
                  onCancel()
                  return
                }
                void cancelConnection()
              }}
            >
              Cancel Only
            </button>
            <button
              type="button"
              className="border border-[rgba(255,120,120,0.95)] bg-[rgba(150,0,0,0.62)] text-[rgba(255,245,245,0.98)] font-serif text-[2.4cqh] px-[1.8cqh] py-[0.45cqh]"
              onClick={() => {
                setShowCancelModal(false)
                if (onCancel) {
                  onCancel({ shutdownHosted: true })
                  return
                }
                void cancelConnection({ shutdownHosted: true })
              }}
            >
              Cancel + Shutdown Hosted
            </button>
          </>
        }
      >
        <p className="m-0 font-serif text-[2.4cqh] text-[rgba(233,242,255,0.88)]">
          Choose whether to only cancel this client connection, or also request shutdown of the hosted server.
        </p>
      </OverlayModal>
    </>
  )
}

export default TerminalDisplay
