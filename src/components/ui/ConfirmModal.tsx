import { CONFIRM_BUTTON_BASE } from '../../styles'

type ConfirmModalProps = {
  title: string
  description: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  cancelLabel?: string
}

const ConfirmModal = ({
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel'
}: ConfirmModalProps) => (
  <div
    className="absolute inset-0 z-[3] flex items-center justify-center bg-[var(--color-overlay-scrim)] backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
  >
    <div className="select-none border border-[var(--color-border-medium)] bg-[var(--color-surface-modal)] text-[var(--color-text-primary)] w-[58.33cqh] p-[1.8cqh_2.84cqh]">
      <h3 className="m-0 mb-[0.2cqh] font-serif font-medium text-[3.91cqh]">{title}</h3>
      <p className="m-0 font-serif text-[var(--color-text-modal-muted)] text-[2.4cqh]">{description}</p>
      <div className="flex justify-end mt-[1.4cqh] gap-[1.42cqh]">
        <button
          type="button"
          className={`${CONFIRM_BUTTON_BASE} border border-[var(--color-border-medium)] bg-[var(--color-surface-btn-ghost)] text-[var(--color-text-primary)]`}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`${CONFIRM_BUTTON_BASE} bg-[var(--color-surface-btn-hover)] text-[var(--color-text-inverse)]`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
)

export default ConfirmModal
