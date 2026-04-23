import type { DragEvent } from 'react'
import type { SeedRecord } from '../types/app'
import { useUISound } from '../hooks/useUISound'
import { useAudio } from '../context/audioContextValue'
import { useInputModality } from '../lib/inputModality'
import { useTranslation } from 'react-i18next'

const ACTION_BASE =
  'w-[5cqh] h-[5cqh] grid place-items-center bg-[var(--color-surface-btn-secondary)] text-[2.54cqh] leading-none rounded-[2px] cursor-pointer transition-[color,border-color] duration-[140ms] ease-in-out border'

const ACTION_DELETE = 'text-error-muted border-error/50 hover:text-[var(--color-error-bright)] hover:border-error'

const CARD_STATE_SAFE = 'cursor-pointer hover:border-white'
const CARD_STATE_UNSAFE = 'cursor-not-allowed border-border-unsafe bg-surface-unsafe'

const DeleteIcon = () => (
  <svg
    className="h-[66%] w-[66%]"
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
  selectCooldown?: boolean
  onSelect: (filename: string) => void
  onRemove?: (seed: SeedRecord) => void
  draggable?: boolean
  isBeingDragged?: boolean
  onDragStart?: (filename: string, event: DragEvent<HTMLButtonElement>) => void
  onDragOver?: (filename: string, event: DragEvent<HTMLButtonElement>) => void
  onDrop?: (filename: string, event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void
}

const SceneCard = ({
  seed,
  thumbnailSrc,
  selectCooldown,
  onSelect,
  onRemove,
  draggable = false,
  isBeingDragged = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: SceneCardProps) => {
  const { t } = useTranslation()
  const { playHover, playClick } = useUISound()
  const { play } = useAudio()
  const modality = useInputModality()
  const isUnsafe = seed.is_safe === false
  // Gamepad users can't reliably reach the nested delete action with spatial
  // nav (the parent scene card is what's focused). Hide it in gamepad mode.
  const hideSecondaryActions = modality === 'gamepad'

  return (
    <button
      type="button"
      draggable={draggable}
      className={`
        group/scene relative aspect-video w-full overflow-hidden rounded-card border border-border-subtle
        bg-surface-card p-0 transition-[opacity,border-color] duration-140 ease-out
        ${isUnsafe ? CARD_STATE_UNSAFE : CARD_STATE_SAFE}
        ${isBeingDragged ? 'opacity-40' : ''}
      `}
      title={seed.filename}
      aria-disabled={isUnsafe}
      onMouseEnter={() => !isUnsafe && playHover()}
      onClick={() => {
        if (isUnsafe) return
        if (!selectCooldown) play('portal_swoosh')
        onSelect(seed.filename)
      }}
      onDragStart={draggable && onDragStart ? (e) => onDragStart(seed.filename, e) : undefined}
      onDragOver={onDragOver ? (e) => onDragOver(seed.filename, e) : undefined}
      onDrop={onDrop ? (e) => onDrop(seed.filename, e) : undefined}
      onDragEnd={onDragEnd}
    >
      <img
        draggable={false}
        className={`
          block size-full object-cover
          ${isUnsafe ? 'brightness-[0.45] contrast-[0.8] grayscale' : ''}
        `}
        src={thumbnailSrc || ''}
        alt={seed.filename}
      />
      {isUnsafe && (
        <span
          className="
            absolute top-1 left-1 bg-surface-badge px-[0.58cqh] py-[0.18cqh] text-[1.11cqh] font-semibold
            tracking-[0.08em] text-text-inverse uppercase
          "
        >
          {t('app.pause.sceneCard.unsafe')}
        </span>
      )}
      <span
        className={`
          absolute top-1 right-1 flex flex-col gap-0.5 opacity-0 transition-opacity duration-140 ease-in-out
          ${
            hideSecondaryActions
              ? ''
              : `
                group-focus-within/scene:opacity-100
                group-hover/scene:opacity-100
              `
          }
        `}
      >
        {seed.source !== 'default' && onRemove && !hideSecondaryActions && (
          <span
            role="button"
            tabIndex={0}
            className={`
              ${ACTION_BASE}
              ${ACTION_DELETE}
            `}
            title={t('app.pause.sceneCard.removeScene')}
            onMouseEnter={playHover}
            onClick={(event) => {
              event.stopPropagation()
              playClick()
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
