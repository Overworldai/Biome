import type { SeedRecord } from '../types/app'

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

const SceneCard = ({ seed, thumbnailSrc, isPinned, pinVariant, onSelect, onTogglePin, onRemove }: SceneCardProps) => (
  <button
    type="button"
    className="pause-scene-card group/scene relative"
    title={seed.filename}
    onClick={() => onSelect(seed.filename)}
  >
    <img className="w-full h-full object-cover block" src={thumbnailSrc || ''} alt={seed.filename} />
    <span className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 transition-opacity duration-[140ms] ease-in-out group-hover/scene:opacity-100">
      <span
        role="button"
        tabIndex={0}
        className={`pause-scene-action ${isPinned ? 'is-pinned' : 'is-default'}`}
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
      {!seed.is_default && onRemove && (
        <span
          role="button"
          tabIndex={0}
          className="pause-scene-action is-delete"
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

export default SceneCard
