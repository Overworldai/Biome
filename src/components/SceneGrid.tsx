import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { SeedRecord } from '../types/app'
import type { NavDirection } from '../lib/focusNavigation'
import SceneCard from './SceneCard'

// Track the hovered card + which half the cursor is on. This preserves the
// visual intent of the cursor: "right half of rightmost-of-row-1" renders on
// row 1, "left half of first-of-row-2" renders on row 2 — even though those
// two cases would collapse to the same insert-index.
type DropTarget = { hoveredFilename: string; side: 'left' | 'right' }

interface SceneGridProps {
  scenes: SeedRecord[]
  thumbnails: Record<string, string>
  selectCooldown: boolean
  onSelect: (filename: string) => void
  onRemove: (seed: SeedRecord) => void
  onMoveScene?: (filename: string, targetIdx: number) => void
  className?: string
  before?: ReactNode
  emptyState?: ReactNode
  /** When set to a scene filename, the matching card is smooth-scrolled into
   *  view. Used after a generated scene is added so the user can see it. */
  autoScrollTo?: string | null
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
  scenes,
  thumbnails,
  selectCooldown,
  onSelect,
  onRemove,
  onMoveScene,
  className,
  before,
  emptyState,
  autoScrollTo
}: SceneGridProps) => {
  const [draggedFilename, setDraggedFilename] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  // Gamepad reorder renders the list in preview order (dragged tile actually
  // moves between slots + neighbours reflow via framer-motion `layout`) rather
  // than the mouse-drag visuals (faded source tile + standalone indicator).
  // Mouse drag keeps the indicator because the browser's native drag ghost
  // already shows where the source tile is; gamepad has no such cursor.
  const [isGamepadReorder, setIsGamepadReorder] = useState(false)
  // Mirror of the gamepad drag state, synchronously readable. The gamepad
  // path can fire `holdstart` and `holdmove` in the same rAF tick (d-pad
  // pressed before the 400ms threshold is promoted to an immediate capture);
  // handlers that read only from React state would see stale values because
  // the commit from the preceding setState hasn't happened yet.
  const gamepadDragRef = useRef<{ filename: string; target: DropTarget } | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const outerRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const cursorYRef = useRef<number | null>(null)
  const autoScrollRafRef = useRef<number | null>(null)

  const sceneIds = useMemo(() => scenes.map((s) => s.filename), [scenes])

  const isEmpty = sceneIds.length === 0
  const canDrag = onMoveScene !== undefined && sceneIds.length > 1

  // During gamepad reorder, rearrange the visible list so the dragged tile
  // renders at its preview position. Framer Motion's `layout` prop on each
  // card animates neighbours out of the way as the user presses the d-pad.
  const displayScenes = useMemo(() => {
    if (!isGamepadReorder || !draggedFilename || !dropTarget) return scenes
    const dragged = scenes.find((s) => s.filename === draggedFilename)
    if (!dragged) return scenes
    const rest = scenes.filter((s) => s.filename !== draggedFilename)
    const hoveredIdx = rest.findIndex((s) => s.filename === dropTarget.hoveredFilename)
    if (hoveredIdx === -1) return scenes
    const insertIdx = dropTarget.side === 'left' ? hoveredIdx : hoveredIdx + 1
    return [...rest.slice(0, insertIdx), dragged, ...rest.slice(insertIdx)]
  }, [isGamepadReorder, draggedFilename, dropTarget, scenes])

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

  // Scroll a specific card into view when `autoScrollTo` changes (e.g. the
  // pause menu has just had a generated scene added and we want the user to
  // find it). Uses the real card element so any grid row the card lands on
  // scrolls with it. Looked up by filename so it handles late-arriving cards
  // that weren't in the scenes array on the render the prop changed.
  useEffect(() => {
    if (!autoScrollTo) return
    const grid = gridRef.current
    if (!grid) return
    const card = grid.querySelector<HTMLElement>(`[data-scene-filename="${CSS.escape(autoScrollTo)}"]`)
    if (!card) return
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [autoScrollTo, scenes])

  // Gamepad hold-to-drag: hold A on a focused scene card to pick it up, then
  // d-pad moves the drop indicator. Release A to commit, B to cancel.
  // useGamepadNavigation dispatches the events; capture them by preventing
  // default on `gamepadholdstart`.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || !canDrag) return

    const filenameFromEvent = (e: Event): string | null => {
      const target = e.target instanceof HTMLElement ? e.target : null
      const tile = target?.closest<HTMLElement>('[data-scene-filename]')
      return tile?.dataset.sceneFilename ?? null
    }

    const insertIdxFor = (target: DropTarget, filename: string): number => {
      const withoutDragged = sceneIds.filter((f) => f !== filename)
      const hoveredIdx = withoutDragged.indexOf(target.hoveredFilename)
      if (hoveredIdx === -1) return withoutDragged.length
      return target.side === 'left' ? hoveredIdx : hoveredIdx + 1
    }

    const handleHoldStart = (e: Event) => {
      const filename = filenameFromEvent(e)
      if (!filename) return
      const initial = seedInitialTarget(filename)
      if (!initial) return
      e.preventDefault()
      gamepadDragRef.current = { filename, target: initial }
      setIsGamepadReorder(true)
      setDraggedFilename(filename)
      setDropTarget(initial)
    }

    const handleHoldMove = (e: Event) => {
      const state = gamepadDragRef.current
      if (!state) return
      const direction = (e as CustomEvent<{ direction: NavDirection }>).detail?.direction
      if (!direction) return
      const withoutDragged = sceneIds.filter((f) => f !== state.filename)
      const cols = getColumnCount()
      const currentIdx = insertIdxFor(state.target, state.filename)
      const deltaMap: Record<NavDirection, number> = { left: -1, right: 1, up: -cols, down: cols }
      const nextIdx = Math.max(0, Math.min(withoutDragged.length, currentIdx + deltaMap[direction]))
      if (nextIdx === currentIdx) return
      const nextTarget = dropTargetForInsertIdx(nextIdx, withoutDragged)
      if (!nextTarget) return
      gamepadDragRef.current = { filename: state.filename, target: nextTarget }
      setDropTarget(nextTarget)
      scrollDropTargetIntoView(nextTarget)
    }

    const handleHoldEnd = () => {
      const state = gamepadDragRef.current
      if (state && onMoveScene) {
        onMoveScene(state.filename, insertIdxFor(state.target, state.filename))
      }
      gamepadDragRef.current = null
      resetDrag()
    }

    const handleHoldCancel = () => {
      gamepadDragRef.current = null
      resetDrag()
    }

    wrapper.addEventListener('gamepadholdstart', handleHoldStart)
    wrapper.addEventListener('gamepadholdmove', handleHoldMove)
    wrapper.addEventListener('gamepadholdend', handleHoldEnd)
    wrapper.addEventListener('gamepadholdcancel', handleHoldCancel)
    return () => {
      wrapper.removeEventListener('gamepadholdstart', handleHoldStart)
      wrapper.removeEventListener('gamepadholdmove', handleHoldMove)
      wrapper.removeEventListener('gamepadholdend', handleHoldEnd)
      wrapper.removeEventListener('gamepadholdcancel', handleHoldCancel)
    }
    // Drag state is tracked in `gamepadDragRef` (synchronous), not in the deps;
    // seedInitialTarget / resetDrag / dropTargetForInsertIdx read only
    // `sceneIds` which is already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDrag, sceneIds, onMoveScene])

  const resetDrag = () => {
    setDraggedFilename(null)
    setDropTarget(null)
    setIsGamepadReorder(false)
    stopAutoScroll()
  }

  // Translate an insert-slot index (0..withoutDragged.length) back to a
  // {hoveredFilename, side} so the drop indicator can be driven programmatically
  // from gamepad input, not just from hover coordinates.
  const dropTargetForInsertIdx = (insertIdx: number, withoutDragged: string[]): DropTarget | null => {
    if (withoutDragged.length === 0) return null
    if (insertIdx < withoutDragged.length) {
      return { hoveredFilename: withoutDragged[insertIdx], side: 'left' }
    }
    return { hoveredFilename: withoutDragged[withoutDragged.length - 1], side: 'right' }
  }

  const seedInitialTarget = (filename: string): DropTarget | null => {
    const idx = sceneIds.indexOf(filename)
    if (idx === -1) return null
    const withoutDragged = sceneIds.filter((f) => f !== filename)
    // Seed on the card adjacent to the dragged scene so the preview stays
    // anchored at the drag's original position until the cursor moves.
    return dropTargetForInsertIdx(idx, withoutDragged)
  }

  // Column count is layout-dependent (`grid-cols-[repeat(auto-fill,...)]`).
  // Read it from the resolved `grid-template-columns` track list rather than
  // sampling tile positions — during reorder the tiles are mid-animation, so
  // their current bounding rects don't reflect the underlying row structure.
  const getColumnCount = (): number => {
    const grid = gridRef.current
    if (!grid) return 1
    const tracks = window
      .getComputedStyle(grid)
      .gridTemplateColumns.split(' ')
      .filter((s) => s && s !== 'none')
    return tracks.length || 1
  }

  const scrollDropTargetIntoView = (target: DropTarget) => {
    const outer = outerRef.current
    const grid = gridRef.current
    if (!outer || !grid) return
    const card = grid.querySelector<HTMLElement>(`[data-scene-filename="${CSS.escape(target.hoveredFilename)}"]`)
    if (!card) return
    const cardRect = card.getBoundingClientRect()
    const outerRect = outer.getBoundingClientRect()
    if (cardRect.top < outerRect.top) {
      outer.scrollBy({ top: cardRect.top - outerRect.top - 8, behavior: 'smooth' })
    } else if (cardRect.bottom > outerRect.bottom) {
      outer.scrollBy({ top: cardRect.bottom - outerRect.bottom + 8, behavior: 'smooth' })
    }
  }

  const handleDragStart = (filename: string, event: DragEvent<HTMLButtonElement>) => {
    setDraggedFilename(filename)
    setDropTarget(seedInitialTarget(filename))
    cursorYRef.current = event.clientY
    startAutoScroll()
    event.dataTransfer.setData(SCENE_DRAG_MIME, filename)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleCardDragOver = (hoveredFilename: string, event: DragEvent<HTMLButtonElement>) => {
    if (!draggedFilename) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    cursorYRef.current = event.clientY

    // Hovering the dragged card itself — leave the seeded target in place.
    if (hoveredFilename === draggedFilename) return

    const rect = event.currentTarget.getBoundingClientRect()
    const side: 'left' | 'right' = event.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
    setDropTarget({ hoveredFilename, side })
  }

  const resolveInsertIdx = (target: DropTarget): number => {
    const withoutDragged = sceneIds.filter((f) => f !== draggedFilename)
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
    onMoveScene(draggedFilename, resolveInsertIdx(dropTarget))
    resetDrag()
  }

  const handleCardDrop = (_filename: string, event: DragEvent<HTMLButtonElement>) => commitDrop(event)

  // Gaps between cards don't receive events, so the grid-level handler fires
  // there too. Guard with the last-card measurement so the fallback only
  // targets "end of list" when the cursor is genuinely past all cards.
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

    const lastScene = sceneIds.filter((f) => f !== draggedFilename).at(-1)
    if (lastScene) {
      setDropTarget({ hoveredFilename: lastScene, side: 'right' })
    }
  }

  const handleGridDrop = (event: DragEvent<HTMLDivElement>) => commitDrop(event)

  const renderCard = (scene: SeedRecord) => (
    <motion.div
      key={scene.filename}
      layout
      transition={REORDER_TRANSITION}
      data-scene-tile
      data-scene-filename={scene.filename}
      className="relative w-full"
    >
      <SceneCard
        seed={scene}
        thumbnailSrc={thumbnails[scene.filename]}
        selectCooldown={selectCooldown}
        onSelect={onSelect}
        onRemove={onRemove}
        draggable={canDrag}
        isBeingDragged={draggedFilename === scene.filename && !isGamepadReorder}
        onDragStart={canDrag ? handleDragStart : undefined}
        onDragOver={canDrag ? handleCardDragOver : undefined}
        onDrop={canDrag ? handleCardDrop : undefined}
        onDragEnd={canDrag ? resetDrag : undefined}
      />
    </motion.div>
  )

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
        // overflow-anchor:none — otherwise the browser pins the focused tile in
        // place when siblings shift above it, so during gamepad reorder the
        // dragged (focused) card appears stationary while the rest visibly slide.
        className="styled-scrollbar absolute inset-0 overflow-y-auto pr-[0.8cqh] [overflow-anchor:none]"
        onDragOver={canDrag ? handleGridDragOver : undefined}
        onDrop={canDrag ? handleGridDrop : undefined}
      >
        <div ref={gridRef} className="grid w-full grid-cols-[repeat(auto-fill,39cqh)] gap-[1.28cqh]">
          {before}
          {/* `display: contents` wrapper so the default-focus marker only covers
              scene tiles (not the user-scenes "paste / browse" buttons in `before`)
              without breaking the grid layout. */}
          <div data-default-focus className="contents">
            {isEmpty ? emptyState : displayScenes.map(renderCard)}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {indicatorPos && !isGamepadReorder && (
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
