import { CONFIRM_BUTTON_BASE } from '../../styles'
import Modal from './Modal'

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
  <Modal title={title}>
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
  </Modal>
)

export default ConfirmModal
