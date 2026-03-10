import Modal from './Modal'
import Button from './Button'

type ConfirmModalProps = {
  title: string
  description: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  cancelLabel?: string
}

const MODAL_BUTTON = 'p-[0.5cqh_1.78cqh] text-[2.49cqh]'

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
      <Button variant="secondary" className={MODAL_BUTTON} onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button variant="primary" className={MODAL_BUTTON} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  </Modal>
)

export default ConfirmModal
