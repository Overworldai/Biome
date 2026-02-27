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
    className="absolute inset-0 z-[3] flex items-center justify-center bg-[rgba(2,6,16,0.55)] backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
  >
    <div className="border border-[rgba(245,251,255,0.66)] bg-[rgba(8,12,20,0.92)] text-[rgba(246,249,255,0.95)] w-[min(420px,76cqw)] p-[1.8cqh_1.6cqw]">
      <h3 className="m-0 mb-[0.6cqh] font-serif font-medium text-[clamp(26px,2.2cqw,34px)]">{title}</h3>
      <p className="m-0 font-serif text-[rgba(233,242,255,0.82)] text-[clamp(16px,1.35cqw,21px)]">{description}</p>
      <div className="flex justify-end mt-[1.4cqh] gap-[0.8cqw]">
        <button
          type="button"
          className="cursor-pointer font-serif border border-[rgba(245,251,255,0.7)] bg-[rgba(8,12,20,0.18)] text-[rgba(245,251,255,0.95)] p-[0.5cqh_1cqw] text-[clamp(17px,1.4cqw,22px)]"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="cursor-pointer font-serif bg-[rgba(245,251,255,0.9)] text-[rgba(15,20,32,0.95)] p-[0.5cqh_1cqw] text-[clamp(17px,1.4cqw,22px)]"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
)

export default ConfirmModal
