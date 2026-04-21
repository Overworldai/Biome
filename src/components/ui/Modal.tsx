import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import { FocusScope } from '../../context/FocusScopeContext'

type ModalProps = {
  title: TranslationKey
  children: ReactNode
  /** If provided, clicking the backdrop closes the modal. */
  onBackdropClick?: () => void
  /** Called when the user dismisses via the gamepad B button / Escape-equivalent
   *  gesture. Defaults to `onBackdropClick` when not explicitly passed. */
  onCancel?: () => void
}

const Modal = ({ title, children, onBackdropClick, onCancel }: ModalProps) => {
  const { t } = useTranslation()
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Stop mousedown from bubbling past the modal so ambient document-level
  // listeners (e.g. SettingsSelect's click-outside) don't fire when the user
  // interacts with the modal.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const stop = (e: Event) => e.stopPropagation()
    el.addEventListener('mousedown', stop)
    return () => el.removeEventListener('mousedown', stop)
  }, [])

  return createPortal(
    <div
      ref={wrapperRef}
      className="fixed inset-0 z-10000 flex items-center justify-center bg-overlay-scrim backdrop-blur-[0.56cqh]"
      role="dialog"
      aria-modal="true"
      onClick={onBackdropClick}
    >
      <FocusScope
        onCancel={onCancel ?? onBackdropClick}
        autoFocus
        className="
          max-h-[85vh] w-[min(70cqh,92vw)] overflow-y-auto border border-border-medium p-[2.16cqh_3.41cqh]
          text-(--color-text-primary) backdrop-blur-xl select-none
        "
      >
        <div onClick={onBackdropClick ? (e) => e.stopPropagation() : undefined}>
          <h3 className="m-0 mb-[0.24cqh] font-serif text-[4.69cqh] font-medium wrap-break-word">{t(title)}</h3>
          {children}
        </div>
      </FocusScope>
    </div>,
    document.body
  )
}

export default Modal
