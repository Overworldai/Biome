import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { SeedRecord } from '../types/app'
import SceneCard from './SceneCard'

type Region = 'pinned' | 'unpinned'
// Track the hovered card + which half the cursor is on. This preserves the
// visual intent of the cursor: "right half of rightmost-of-row-1" renders on
// row 1, "left half of first-of-row-2" renders on row 2 — even though those
// two cases would collapse to the same insert-index.
type DropTarget = { region: Region; hoveredFilename: string; side: 'left' | 'right' }

interface SceneGridProps {
  pinnedSeeds: SeedRecord[]
  unpinnedSeeds: SeedRecord[]
  thumbnails: Record<string, string>
  selectCooldown: boolean
  onSelect: (filename: string) => void
  onTogglePin: (filename: string) => void
  onRemove: (seed: SeedRecord) => void
  onMoveScene?: (filename: string, targetRegion: Region, targetIdx: number) => void
  className?: string
  before?: ReactNode
  emptyState?: ReactNode
}

const SCENE_DRAG_MIME = 'application/x-biome-scene'
const INDICATOR_TRANSITION = { duration: 0.14, ease: [0.22, 1, 0.36, 1] as const }
// Layout animation that plays when scene order changes (i.e. after drop).
// Cards between the source and destination slide to close the gap while the
// dragged card glides into its new slot.
const REORDER_TRANSITION = { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const }
// Indicator width in px; matches w-[0.32cqh] visually closely enough without
// having to resolve the container unit at runtime.
const INDICATOR_WIDTH_PX = 4
// Auto-scroll while dragging: cursor within this many px of the container
// top/bottom triggers scrolling, with speed ramping up as the cursor nears
// the edge.
const AUTO_SCROLL_EDGE_PX = 48
const AUTO_SCROLL_MAX_SPEED_PX = 16

const SceneGrid = ({
  pinnedSeeds,
  unpinnedSeeds,
  thumbnails,
  selectCooldown,
  onSelect,
  onTogglePin,
  onRemove,
  onMoveScene,
  className,
  before,
  emptyState
}: SceneGridProps) => {
  const [draggedFilename, setDraggedFilename] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const outerRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const cursorYRef = useRef<number | null>(null)
  const autoScrollRafRef = useRef<number | null>(null)

  const pinnedIds = useMemo(() => pinnedSeeds.map((s) => s.filename), [pinnedSeeds])
  const unpinnedIds = useMemo(() => unpinnedSeeds.map((s) => s.filename), [unpinnedSeeds])
  const draggedIsPinned = draggedFilename ? pinnedIds.includes(draggedFilename) : false

  const seedMap = useMemo(() => {
    const m = new Map<string, SeedRecord>()
    pinnedSeeds.forEach((s) => m.set(s.filename, s))
    unpinnedSeeds.forEach((s) => m.set(s.filename, s))
    return m
  }, [pinnedSeeds, unpinnedSeeds])

  const isEmpty = pinnedIds.length === 0 && unpinnedIds.length === 0
  const totalCount = pinnedIds.length + unpinnedIds.length
  const canDrag = onMoveScene !== undefined && totalCount > 1

  // Indicator is rendered at the wrapper level (outside the scroll container)
  // so it can sit in the gap past the leftmost/rightmost cards without being
  // clipped by overflow. The wrapper uses clip-path to clip vertically only,
  // so content above/below the scroll area stays safe.
  const [indicatorPos, setIndicatorPos] = useState<{ left: number; top: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const wrapper = wrapperRef.current
    const grid = gridRef.current
    if (!dropTarget || !outer || !wrapper || !grid) {
      setIndicatorPos(null)
      return
    }

    const compute = () => {
      const card = grid.querySelector<HTMLElement>(`[data-scene-filename="${CSS.escape(dropTarget.hoveredFilename)}"]`)
      if (!card) {
        setIndicatorPos(null)
        return
      }
      const cardRect = card.getBoundingClientRect()
      const wrapperRect = wrapper.getBoundingClientRect()
      const gapPx = parseFloat(window.getComputedStyle(grid).columnGap) || 0
      const halfGap = gapPx / 2
      const halfWidth = INDICATOR_WIDTH_PX / 2

      const left =
        dropTarget.side === 'left'
          ? cardRect.left - wrapperRect.left - halfGap - halfWidth
          : cardRect.right - wrapperRect.left + halfGap - halfWidth
      const top = cardRect.top - wrapperRect.top
      setIndicatorPos({ left, top, height: cardRect.height })
    }

    compute()
    outer.addEventListener('scroll', compute)
    return () => outer.removeEventListener('scroll', compute)
  }, [dropTarget])

  const stopAutoScroll = () => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current)
      autoScrollRafRef.current = null
    }
    cursorYRef.current = null
  }

  const startAutoScroll = () => {
    if (autoScrollRafRef.current !== null) return
    const tick = () => {
      const outer = outerRef.current
      const y = cursorYRef.current
      if (outer && y !== null) {
        const rect = outer.getBoundingClientRect()
        let delta = 0
        if (y < rect.top + AUTO_SCROLL_EDGE_PX) {
          const intensity = Math.min(1, (rect.top + AUTO_SCROLL_EDGE_PX - y) / AUTO_SCROLL_EDGE_PX)
          delta = -intensity * AUTO_SCROLL_MAX_SPEED_PX
        } else if (y > rect.bottom - AUTO_SCROLL_EDGE_PX) {
          const intensity = Math.min(1, (y - (rect.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX)
          delta = intensity * AUTO_SCROLL_MAX_SPEED_PX
        }
        if (delta !== 0) outer.scrollTop += delta
      }
      autoScrollRafRef.current = requestAnimationFrame(tick)
    }
    autoScrollRafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => stopAutoScroll, [])

  const resetDrag = () => {
    setDraggedFilename(null)
    setDropTarget(null)
    stopAutoScroll()
  }

  const seedInitialTarget = (filename: string): DropTarget | null => {
    const inPinned = pinnedIds.indexOf(filename)
    const [region, regionIds] =
      inPinned !== -1 ? (['pinned', pinnedIds] as const) : (['unpinned', unpinnedIds] as const)
    const idx = regionIds.indexOf(filename)
    if (idx === -1) return null
    const withoutDragged = regionIds.filter((f) => f !== filename)
    if (withoutDragged.length === 0) return null
    // Seed on the card adjacent to the dragged scene so the preview stays
    // anchored at the drag's original position until the cursor moves.
    if (idx < withoutDragged.length) {
      return { region, hoveredFilename: withoutDragged[idx], side: 'left' }
    }
    return { region, hoveredFilename: withoutDragged[withoutDragged.length - 1], side: 'right' }
  }

  const handleDragStart = (filename: string, event: DragEvent<HTMLButtonElement>) => {
    setDraggedFilename(filename)
    setDropTarget(seedInitialTarget(filename))
    cursorYRef.current = event.clientY
    startAutoScroll()
    event.dataTransfer.setData(SCENE_DRAG_MIME, filename)
    event.dataTransfer.effectAllowed = 'move'
  }

  const pinnedEndTarget = (): DropTarget | null => {
    const lastPinned = pinnedIds.filter((f) => f !== draggedFilename).at(-1)
    if (!lastPinned) return null
    return { region: 'pinned', hoveredFilename: lastPinned, side: 'right' }
  }

  const handleCardDragOver = (hoveredFilename: string, region: Region, event: DragEvent<HTMLButtonElement>) => {
    if (!draggedFilename) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    cursorYRef.current = event.clientY

    // Pinned stays pinned: clamp to end of pinned if cursor strays into unpinned cards.
    if (draggedIsPinned && region === 'unpinned') {
      const target = pinnedEndTarget()
      if (target) setDropTarget(target)
      return
    }

    // Hovering the dragged card itself — leave the seeded target in place.
    if (hoveredFilename === draggedFilename) return

    const rect = event.currentTarget.getBoundingClientRect()
    const side: 'left' | 'right' = event.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
    setDropTarget({ region, hoveredFilename, side })
  }

  const resolveInsertIdx = (target: DropTarget): number => {
    const regionIds = target.region === 'pinned' ? pinnedIds : unpinnedIds
    const withoutDragged = regionIds.filter((f) => f !== draggedFilename)
    const hoveredIdx = withoutDragged.indexOf(target.hoveredFilename)
    if (hoveredIdx === -1) return withoutDragged.length
    return target.side === 'left' ? hoveredIdx : hoveredIdx + 1
  }

  const commitDrop = (event: DragEvent) => {
    if (!draggedFilename || !dropTarget || !onMoveScene) {
      resetDrag()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onMoveScene(draggedFilename, dropTarget.region, resolveInsertIdx(dropTarget))
    resetDrag()
  }

  const handleCardDrop = (_filename: string, event: DragEvent<HTMLButtonElement>) => commitDrop(event)

  // Gaps between cards don't receive events, so the grid-level handler fires
  // there too. Guard with the last-card measurement so the fallback only
  // targets "end of region" when the cursor is genuinely past all cards.
  const handleGridDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggedFilename) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    cursorYRef.current = event.clientY

    const grid = gridRef.current
    if (!grid) return
    const tiles = grid.querySelectorAll<HTMLElement>('[data-scene-tile]')
    if (tiles.length === 0) return
    const lastRect = tiles[tiles.length - 1].getBoundingClientRect()
    const pastLastCard =
      event.clientY > lastRect.bottom || (event.clientY >= lastRect.top && event.clientX > lastRect.right)
    if (!pastLastCard) return

    if (draggedIsPinned) {
      const target = pinnedEndTarget()
      if (target) setDropTarget(target)
      return
    }

    const lastUnpinned = unpinnedIds.filter((f) => f !== draggedFilename).at(-1)
    if (lastUnpinned) {
      setDropTarget({ region: 'unpinned', hoveredFilename: lastUnpinned, side: 'right' })
    }
  }

  const handleGridDrop = (event: DragEvent<HTMLDivElement>) => commitDrop(event)

  const renderCard = (filename: string, region: Region) => {
    const record = seedMap.get(filename)
    if (!record) return null
    return (
      <motion.div
        key={filename}
        layout
        transition={REORDER_TRANSITION}
        data-scene-tile
        data-scene-filename={filename}
        className="relative w-full"
      >
        <SceneCard
          seed={record}
          thumbnailSrc={thumbnails[filename]}
          isPinned={region === 'pinned'}
          pinVariant="toggle"
          selectCooldown={selectCooldown}
          onSelect={onSelect}
          onTogglePin={onTogglePin}
          onRemove={onRemove}
          draggable={canDrag}
          isBeingDragged={draggedFilename === filename}
          onDragStart={canDrag ? handleDragStart : undefined}
          onDragOver={canDrag ? (f, e) => handleCardDragOver(f, region, e) : undefined}
          onDrop={canDrag ? handleCardDrop : undefined}
          onDragEnd={canDrag ? resetDrag : undefined}
        />
      </motion.div>
    )
  }

  return (
    <div
      ref={wrapperRef}
      className={`
        relative mt-[1.1cqh] min-h-0 flex-1 [clip-path:inset(0_-100vw)]
        ${className ?? ''}
      `}
    >
      <div
        ref={outerRef}
        className="styled-scrollbar absolute inset-0 overflow-y-auto pr-[0.8cqh]"
        onDragOver={canDrag ? handleGridDragOver : undefined}
        onDrop={canDrag ? handleGridDrop : undefined}
      >
        <div ref={gridRef} className="grid w-full grid-cols-[repeat(auto-fill,25.78cqh)] gap-[1.28cqh]">
          {before}
          {/* `display: contents` wrapper so the default-focus marker only covers
              scene tiles (not the user-scenes "paste / browse" buttons in `before`)
              without breaking the grid layout. */}
          <div data-default-focus className="contents">
            {isEmpty ? (
              emptyState
            ) : (
              <>
                {pinnedIds.map((f) => renderCard(f, 'pinned'))}
                {unpinnedIds.map((f) => renderCard(f, 'unpinned'))}
              </>
            )}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {indicatorPos && (
          <motion.div
            key="drop-indicator"
            initial={{ opacity: 0, left: indicatorPos.left, top: indicatorPos.top, height: indicatorPos.height }}
            animate={{ opacity: 1, left: indicatorPos.left, top: indicatorPos.top, height: indicatorPos.height }}
            exit={{ opacity: 0 }}
            transition={INDICATOR_TRANSITION}
            className="pointer-events-none absolute z-10 w-[0.32cqh] rounded-[0.16cqh] bg-text-primary"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export default SceneGrid
