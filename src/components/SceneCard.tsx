import type { SeedRecord } from '../types/app'

const ACTION_BASE =
  'w-[5cqh] h-[5cqh] grid place-items-center bg-[var(--color-action-bg)] text-[2.54cqh] leading-none rounded-[2px] cursor-pointer transition-[background,color,border-color] duration-[140ms] ease-in-out border'

const ACTION_PINNED =
  'text-[var(--color-action-pinned)] border-[var(--color-action-pinned-border)] hover:bg-[var(--color-action-pinned-hover-bg)] hover:text-[var(--color-action-pinned-hover)] hover:border-[var(--color-action-pinned-hover-border)]'

const ACTION_UNPINNED =
  'text-[var(--color-action-unpin)] border-[var(--color-action-unpin-border)] hover:bg-[var(--color-action-unpin-hover-bg)] hover:text-[var(--color-action-unpin-hover)] hover:border-[var(--color-action-unpin-hover-border)]'

const ACTION_DELETE =
  'text-[var(--color-action-delete)] border-[var(--color-action-delete-border)] hover:bg-[var(--color-action-delete-hover-bg)] hover:text-[var(--color-action-delete-hover)] hover:border-[var(--color-action-delete-hover-border)]'

const PinnedIcon = () => (
  <svg
    className="w-[66%] h-[66%]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="10.6" r="4.1" />
    <circle cx="12" cy="10.6" r="1.55" fill="currentColor" stroke="none" />
    <path d="M12 14.7v2.35" />
    <path d="M10.98 16.9L12 19.1 13.02 16.95z" fill="currentColor" stroke="none" />
  </svg>
)

const UnpinnedIcon = () => (
  <svg
    className="w-[66%] h-[66%]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <g transform="rotate(-36 12 12)">
      <rect x="9.25" y="4.1" width="5.5" height="5.6" rx="1.2" />
      <path d="M7.5 9.7h9l-4.5 4.55z" />
      <path d="M12 14.2v5.1" />
      <path d="M10.92 19.1L12 22 13.08 19.15z" fill="currentColor" stroke="none" />
    </g>
  </svg>
)

const DeleteIcon = () => (
  <svg
    className="w-[66%] h-[66%]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <rect x="6.5" y="6.5" width="11" height="13" rx="1.5" />
    <path d="M10 10v6" />
    <path d="M14 10v6" />
  </svg>
)

interface SceneCardProps {
  seed: SeedRecord
  thumbnailSrc?: string
  isPinned: boolean
  pinVariant: 'pinned-only' | 'toggle'
  onSelect: (filename: string) => void
  onTogglePin: (filename: string) => void
  onRemove?: (seed: SeedRecord) => void
}

const SceneCard = ({ seed, thumbnailSrc, isPinned, pinVariant, onSelect, onTogglePin, onRemove }: SceneCardProps) => {
  const isUnsafe = !seed.is_safe

  return (
    <button
      type="button"
      className={`w-full aspect-video rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-0 overflow-hidden group/scene relative ${
        isUnsafe ? 'cursor-not-allowed border-[rgba(184,188,198,0.72)] bg-[rgba(42,47,56,0.62)]' : 'cursor-pointer'
      }`}
      title={seed.filename}
      aria-disabled={isUnsafe}
      onClick={() => {
        if (isUnsafe) return
        onSelect(seed.filename)
      }}
    >
      <img
        className={`w-full h-full object-cover block ${isUnsafe ? 'grayscale brightness-[0.45] contrast-[0.8]' : ''}`}
        src={thumbnailSrc || ''}
        alt={seed.filename}
      />
      {isUnsafe && (
        <span className="absolute left-1 top-1 px-[0.58cqh] py-[0.18cqh] text-[1.11cqh] font-semibold tracking-[0.08em] uppercase text-[rgba(16,20,28,0.95)] bg-[rgba(214,218,228,0.92)]">
          Unsafe
        </span>
      )}
      <span className="absolute top-1 right-1 flex flex-col gap-0.5 opacity-0 transition-opacity duration-[140ms] ease-in-out group-hover/scene:opacity-100 group-focus-within/scene:opacity-100">
        {!isUnsafe && (
          <span
            role="button"
            tabIndex={0}
            className={`${ACTION_BASE} ${isPinned ? ACTION_PINNED : ACTION_UNPINNED}`}
            title={isPinned ? 'Unpin scene' : 'Pin scene'}
            onClick={(event) => {
              event.stopPropagation()
              onTogglePin(seed.filename)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                onTogglePin(seed.filename)
              }
            }}
          >
            {pinVariant === 'pinned-only' || isPinned ? <PinnedIcon /> : <UnpinnedIcon />}
          </span>
        )}
        {!seed.is_default && onRemove && (
          <span
            role="button"
            tabIndex={0}
            className={`${ACTION_BASE} ${ACTION_DELETE}`}
            title="Remove scene"
            onClick={(event) => {
              event.stopPropagation()
              void onRemove(seed)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                void onRemove(seed)
              }
            }}
          >
            <DeleteIcon />
          </span>
        )}
      </span>
    </button>
  )
}

export default SceneCard
