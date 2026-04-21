import type { DragEvent } from 'react'
import type { SeedRecord } from '../types/app'
import { useUISound } from '../hooks/useUISound'
import { useAudio } from '../context/AudioContext'
import { useInputModality } from '../lib/inputModality'
import { useTranslation } from 'react-i18next'

const ACTION_BASE =
  'w-[5cqh] h-[5cqh] grid place-items-center bg-[var(--color-surface-btn-secondary)] text-[2.54cqh] leading-none rounded-[2px] cursor-pointer transition-[color,border-color] duration-[140ms] ease-in-out border'

const ACTION_PINNED = 'text-warm border-warm/70 hover:text-[var(--color-warm-bright)] hover:border-warm'

const ACTION_UNPINNED =
  'text-text-muted border-[var(--color-border-subtle)] hover:text-text-primary hover:border-border-light'

const ACTION_DELETE = 'text-error-muted border-error/50 hover:text-[var(--color-error-bright)] hover:border-error'

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
  selectCooldown?: boolean
  onSelect: (filename: string) => void
  onTogglePin: (filename: string) => void
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
  isPinned,
  pinVariant,
  selectCooldown,
  onSelect,
  onTogglePin,
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
  // Gamepad users can't reliably reach nested pin/delete actions with spatial
  // nav (the parent scene card is what's focused). Hide them in gamepad mode.
  const hideSecondaryActions = modality === 'gamepad'

  return (
    <button
      type="button"
      draggable={draggable}
      className={`w-full aspect-video rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-0 overflow-hidden group/scene relative transition-opacity duration-[120ms] ${
        isUnsafe ? 'cursor-not-allowed border-[rgba(184,188,198,0.72)] bg-[rgba(42,47,56,0.62)]' : 'cursor-pointer'
      } ${isBeingDragged ? 'opacity-40' : ''}`}
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
        className={`w-full h-full object-cover block ${isUnsafe ? 'grayscale brightness-[0.45] contrast-[0.8]' : ''}`}
        src={thumbnailSrc || ''}
        alt={seed.filename}
      />
      {isUnsafe && (
        <span className="absolute left-1 top-1 px-[0.58cqh] py-[0.18cqh] text-[1.11cqh] font-semibold tracking-[0.08em] uppercase text-[rgba(16,20,28,0.95)] bg-[rgba(214,218,228,0.92)]">
          {t('app.pause.sceneCard.unsafe')}
        </span>
      )}
      <span
        className={`absolute top-1 right-1 flex flex-col gap-0.5 opacity-0 transition-opacity duration-[140ms] ease-in-out ${hideSecondaryActions ? '' : 'group-hover/scene:opacity-100 group-focus-within/scene:opacity-100'}`}
      >
        {!isUnsafe && !hideSecondaryActions && (
          <span
            role="button"
            tabIndex={0}
            className={`${ACTION_BASE} ${isPinned ? ACTION_PINNED : ACTION_UNPINNED}`}
            title={isPinned ? t('app.pause.sceneCard.unpinScene') : t('app.pause.sceneCard.pinScene')}
            onMouseEnter={playHover}
            onClick={(event) => {
              event.stopPropagation()
              playClick()
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
        {!seed.is_default && onRemove && !hideSecondaryActions && (
          <span
            role="button"
            tabIndex={0}
            className={`${ACTION_BASE} ${ACTION_DELETE}`}
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
