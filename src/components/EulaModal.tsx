import { useEffect, useRef, useState } from 'react'
import { CONFIRM_BUTTON_BASE } from '../styles'

type EulaModalProps = {
  eulaText: string
  isLoadingText: boolean
  isSaving: boolean
  saveError: string | null
  onAccept: () => void
  onDecline: () => void
}

const EulaModal = ({ eulaText, isLoadingText, isSaving, saveError, onAccept, onDecline }: EulaModalProps) => {
  const termsRef = useRef<HTMLPreElement | null>(null)
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false)
  const isAcceptDisabled = isSaving || isLoadingText || !hasScrolledToBottom

  useEffect(() => {
    const el = termsRef.current
    if (!el || isLoadingText) {
      setHasScrolledToBottom(false)
      return
    }

    // If content does not overflow, treat as already reviewed.
    if (el.scrollHeight <= el.clientHeight) {
      setHasScrolledToBottom(true)
      return
    }

    setHasScrolledToBottom(false)
  }, [eulaText, isLoadingText])

  const handleTermsScroll = () => {
    const el = termsRef.current
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
    if (atBottom) {
      setHasScrolledToBottom(true)
    }
  }

  return (
    <div
      className="absolute inset-0 z-[300] flex items-center justify-center bg-[var(--color-overlay-scrim)] backdrop-blur-sm px-[2.5cqh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eula-title"
    >
      <div className="w-[92cqh] max-w-full border border-[var(--color-border-medium)] bg-[var(--color-surface-modal)] p-[2.2cqh] text-[var(--color-text-primary)]">
        <h2 id="eula-title" className="m-0 font-serif font-medium text-[4.2cqh]">
          Terms of Service
        </h2>
        <p className="m-[0.8cqh_0_1.2cqh] font-serif text-[2.2cqh] text-[var(--color-text-modal-muted)]">
          Accept the following to continue using Biome.
        </p>

        <pre
          ref={termsRef}
          onScroll={handleTermsScroll}
          className="m-0 h-[42cqh] overflow-y-auto whitespace-pre-wrap border border-[var(--color-border-medium)] bg-black/30 p-[1.4cqh] font-mono text-[1.7cqh] leading-[1.35] text-[var(--color-text-primary)]"
        >
          {isLoadingText ? 'Loading Terms of Service...' : eulaText}
        </pre>

        {saveError && <p className="m-[0.9cqh_0_0] font-serif text-[2cqh] text-[#ff8e8e]">{saveError}</p>}

        <div className="mt-[1.4cqh] flex justify-end gap-[1.2cqh]">
          <button
            type="button"
            className={`${CONFIRM_BUTTON_BASE} border border-[var(--color-border-medium)] bg-[var(--color-surface-btn-ghost)] text-[var(--color-text-primary)]`}
            onClick={onDecline}
            disabled={isSaving}
          >
            Decline and Exit
          </button>
          <button
            type="button"
            className={`${CONFIRM_BUTTON_BASE} ${
              isAcceptDisabled
                ? 'cursor-not-allowed pointer-events-none select-none border border-[var(--color-border-medium)] bg-[var(--color-surface-btn-ghost)] text-[var(--color-text-modal-muted)] opacity-70'
                : 'bg-[var(--color-surface-btn-hover)] text-[var(--color-text-inverse)]'
            }`}
            onClick={onAccept}
            disabled={isAcceptDisabled}
            aria-disabled={isAcceptDisabled}
          >
            {isSaving ? 'Saving...' : 'Accept and Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default EulaModal
