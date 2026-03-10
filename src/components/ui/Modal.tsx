import type { ReactNode } from 'react'

type ModalProps = {
  title: string
  children: ReactNode
  /** If provided, clicking the backdrop closes the modal. */
  onBackdropClick?: () => void
}

const Modal = ({ title, children, onBackdropClick }: ModalProps) => (
  <div
    className="absolute inset-0 z-[3] flex items-center justify-center bg-[var(--color-overlay-scrim)] backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    onClick={onBackdropClick}
  >
    <div
      className="select-none border border-[var(--color-border-medium)] backdrop-blur-xl text-[var(--color-text-primary)] w-[70cqh] p-[2.16cqh_3.41cqh]"
      onClick={onBackdropClick ? (e) => e.stopPropagation() : undefined}
    >
      <h3 className="m-0 mb-[0.24cqh] font-serif font-medium text-[4.69cqh]">{title}</h3>
      {children}
    </div>
  </div>
)

export default Modal
