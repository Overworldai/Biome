import type { ReactNode } from 'react'

type OverlayModalProps = {
  open: boolean
  title: string
  onClose?: () => void
  children: ReactNode
  actions?: ReactNode
  widthClassName?: string
}

const OverlayModal = ({
  open,
  title,
  onClose,
  children,
  actions,
  widthClassName = 'w-[95.11cqh]'
}: OverlayModalProps) => {
  if (!open) return null

  return (
    <div className="absolute inset-0 z-[210] flex items-center justify-center bg-[rgba(2,6,16,0.55)] backdrop-blur-sm">
      <div
        className={`max-h-[82cqh] ${widthClassName} border border-[rgba(245,251,255,0.66)] bg-[rgba(8,12,20,0.92)] text-[rgba(246,249,255,0.95)] p-[1.6cqh_2cqh] flex flex-col gap-[1.2cqh]`}
      >
        <div className="flex items-center justify-between gap-[1cqh]">
          <h3 className="m-0 font-serif font-medium text-[3.56cqh]">{title}</h3>
          {onClose && (
            <button
              type="button"
              className="border border-[rgba(245,251,255,0.7)] bg-[rgba(8,12,20,0.18)] text-[rgba(245,251,255,0.95)] font-serif text-[2.22cqh] px-[1.2cqh] py-[0.25cqh]"
              onClick={onClose}
            >
              Close
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        {actions && <div className="flex items-center justify-end gap-[1.2cqh]">{actions}</div>}
      </div>
    </div>
  )
}

export default OverlayModal
