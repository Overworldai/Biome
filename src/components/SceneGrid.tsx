import type { ReactNode } from 'react'
import type { SeedRecord } from '../types/app'
import SceneCard from './SceneCard'

interface SceneGridProps {
  seeds: SeedRecord[]
  thumbnails: Record<string, string>
  pinnedSceneIds: string[]
  pinVariant: 'pinned-only' | 'toggle'
  selectCooldown: boolean
  onSelect: (filename: string) => void
  onTogglePin: (filename: string) => void
  onRemove: (seed: SeedRecord) => void
  className?: string
  before?: ReactNode
  emptyState?: ReactNode
}

const SceneGrid = ({
  seeds,
  thumbnails,
  pinnedSceneIds,
  pinVariant,
  selectCooldown,
  onSelect,
  onTogglePin,
  onRemove,
  className,
  before,
  emptyState
}: SceneGridProps) => (
  <div className={`styled-scrollbar overflow-y-auto pr-[0.8cqh] max-h-[62cqh] mt-[1.1cqh] ${className ?? ''}`}>
    <div className="grid grid-cols-[repeat(auto-fill,25.78cqh)] gap-[1.28cqh] w-full">
      {before}
      {seeds.length > 0
        ? seeds.map((seed) => (
            <SceneCard
              key={seed.filename}
              seed={seed}
              thumbnailSrc={thumbnails[seed.filename]}
              isPinned={pinnedSceneIds.includes(seed.filename)}
              pinVariant={pinVariant}
              selectCooldown={selectCooldown}
              onSelect={onSelect}
              onTogglePin={onTogglePin}
              onRemove={onRemove}
            />
          ))
        : emptyState}
    </div>
  </div>
)

export default SceneGrid
