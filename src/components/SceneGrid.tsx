import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import type { SeedRecord } from '../types/app'
import SceneCard from './SceneCard'

type Region = 'pinned' | 'unpinned'
type DropTarget = { region: Region; idx: number }

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
const LAYOUT_TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }

const computePreview = (ids: string[], draggedFilename: string | null, target: DropTarget | null, region: Region) => {
  if (!draggedFilename) return ids
  const withoutDragged = ids.filter((id) => id !== draggedFilename)
  if (!target || target.region !== region) return withoutDragged
  const clamped = Math.max(0, Math.min(target.idx, withoutDragged.length))
  return [...withoutDragged.slice(0, clamped), draggedFilename, ...withoutDragged.slice(clamped)]
}

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

  const pinnedIds = useMemo(() => pinnedSeeds.map((s) => s.filename), [pinnedSeeds])
  const unpinnedIds = useMemo(() => unpinnedSeeds.map((s) => s.filename), [unpinnedSeeds])
  const draggedIsPinned = draggedFilename ? pinnedIds.includes(draggedFilename) : false

  const previewPinned = useMemo(
    () => computePreview(pinnedIds, draggedFilename, dropTarget, 'pinned'),
    [pinnedIds, draggedFilename, dropTarget]
  )
  const previewUnpinned = useMemo(
    () => computePreview(unpinnedIds, draggedFilename, dropTarget, 'unpinned'),
    [unpinnedIds, draggedFilename, dropTarget]
  )

  const seedMap = useMemo(() => {
    const m = new Map<string, SeedRecord>()
    pinnedSeeds.forEach((s) => m.set(s.filename, s))
    unpinnedSeeds.forEach((s) => m.set(s.filename, s))
    return m
  }, [pinnedSeeds, unpinnedSeeds])

  const isEmpty = pinnedIds.length === 0 && unpinnedIds.length === 0
  const totalCount = pinnedIds.length + unpinnedIds.length
  const showSeparator = previewPinned.length > 0 && previewUnpinned.length > 0
  const canDrag = onMoveScene !== undefined && totalCount > 1

  const resetDrag = () => {
    setDraggedFilename(null)
    setDropTarget(null)
  }

  const handleDragStart = (filename: string, event: DragEvent<HTMLButtonElement>) => {
    setDraggedFilename(filename)
    // Seed the drop target at the dragged scene's original position so the
    // preview keeps rendering it until the cursor reaches another card.
    const pinnedIdx = pinnedIds.indexOf(filename)
    if (pinnedIdx !== -1) {
      setDropTarget({ region: 'pinned', idx: pinnedIdx })
    } else {
      const unpinnedIdx = unpinnedIds.indexOf(filename)
      setDropTarget(unpinnedIdx === -1 ? null : { region: 'unpinned', idx: unpinnedIdx })
    }
    event.dataTransfer.setData(SCENE_DRAG_MIME, filename)
    event.dataTransfer.effectAllowed = 'move'
  }

  const pinnedEndTarget = (): DropTarget => ({
    region: 'pinned',
    idx: pinnedIds.filter((f) => f !== draggedFilename).length
  })

  const unpinnedStartTarget = (): DropTarget => ({ region: 'unpinned', idx: 0 })

  const handleCardDragOver = (hoveredFilename: string, region: Region, event: DragEvent<HTMLButtonElement>) => {
    if (!draggedFilename) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'

    // Pinned scenes stay pinned: clamp to end of pinned if cursor strays into unpinned cards.
    if (draggedIsPinned && region === 'unpinned') {
      setDropTarget(pinnedEndTarget())
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const isLeftHalf = event.clientX < rect.left + rect.width / 2
    const regionIds = (region === 'pinned' ? pinnedIds : unpinnedIds).filter((f) => f !== draggedFilename)
    const hoveredIdx = regionIds.indexOf(hoveredFilename)
    if (hoveredIdx === -1) return

    const insertIdx = isLeftHalf ? hoveredIdx : hoveredIdx + 1
    setDropTarget({ region, idx: insertIdx })
  }

  const handleSeparatorDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggedFilename) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    // Hovering the divider: pinned stays at end of pinned; unpinned snaps to start of unpinned.
    setDropTarget(draggedIsPinned ? pinnedEndTarget() : unpinnedStartTarget())
  }

  const commitDrop = (event: DragEvent) => {
    if (!draggedFilename || !dropTarget || !onMoveScene) {
      resetDrag()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onMoveScene(draggedFilename, dropTarget.region, dropTarget.idx)
    resetDrag()
  }

  const handleCardDrop = (_filename: string, event: DragEvent<HTMLButtonElement>) => commitDrop(event)
  const handleSeparatorDrop = (event: DragEvent<HTMLDivElement>) => commitDrop(event)

  const renderCard = (filename: string, region: Region) => {
    const seed = seedMap.get(filename)
    if (!seed) return null
    return (
      <motion.div
        key={filename}
        layout
        transition={LAYOUT_TRANSITION}
        className="w-full"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        <SceneCard
          seed={seed}
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
    <div className={`styled-scrollbar overflow-y-auto pr-[0.8cqh] flex-1 min-h-0 mt-[1.1cqh] ${className ?? ''}`}>
      <div className="grid grid-cols-[repeat(auto-fill,25.78cqh)] gap-[1.28cqh] w-full">
        {before}
        {/* `display: contents` wrapper so the default-focus marker only covers
            scene tiles (not the user-scenes "paste / browse" buttons in `before`)
            without breaking the grid layout. */}
        <div data-default-focus className="contents">
          {isEmpty ? (
            emptyState
          ) : (
            <>
              {previewPinned.map((f) => renderCard(f, 'pinned'))}
              {showSeparator && (
                <motion.div
                  layout
                  transition={LAYOUT_TRANSITION}
                  className="col-span-full h-px bg-border-subtle my-[0.6cqh]"
                  aria-hidden="true"
                  onDragOver={canDrag ? handleSeparatorDragOver : undefined}
                  onDrop={canDrag ? handleSeparatorDrop : undefined}
                />
              )}
              {previewUnpinned.map((f) => renderCard(f, 'unpinned'))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default SceneGrid
