import type { DragEvent, ReactNode } from 'react'
import { useUISound } from '../hooks/useUISound'

type DragButtonHandler = (event: DragEvent<HTMLButtonElement>) => void

interface SceneCardBaseProps {
  children: ReactNode
  /** Extra classes for state-specific styling (hover, unsafe, disabled, dragged). */
  className?: string
  title?: string
  /** HTML disabled — blocks clicks and focus. Use for transient states like "uploading". */
  disabled?: boolean
  /** Soft disable — preserves focus/drag but mutes hover sound. Use for "unsafe" scenes. */
  ariaDisabled?: boolean
  draggable?: boolean
  onClick?: () => void
  onDragStart?: DragButtonHandler
  onDragOver?: DragButtonHandler
  onDrop?: DragButtonHandler
  onDragEnd?: DragButtonHandler
}

const SCENE_CARD_SHELL =
  'group/scene relative aspect-video w-full overflow-hidden rounded-card border border-border-subtle bg-surface-card p-0 transition-[opacity,border-color] duration-140 ease-out'

const SceneCardBase = ({
  children,
  className,
  title,
  disabled,
  ariaDisabled,
  draggable,
  onClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: SceneCardBaseProps) => {
  const { playHover } = useUISound()

  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={ariaDisabled}
      draggable={draggable}
      title={title}
      onClick={onClick}
      onMouseEnter={() => {
        if (disabled || ariaDisabled) return
        playHover()
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`
        ${SCENE_CARD_SHELL}
        ${className ?? ''}
      `}
    >
      {children}
    </button>
  )
}

export default SceneCardBase
