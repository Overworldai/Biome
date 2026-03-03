import { useRef, type ChangeEvent } from 'react'
import type { SeedRecord } from '../types/app'
import SceneCard from './SceneCard'
import MenuButton from './ui/MenuButton'
import { HEADING_BASE } from '../styles'

interface PauseScenesViewProps {
  seeds: SeedRecord[]
  thumbnails: Record<string, string>
  pinnedSceneIds: string[]
  uploadingImage: boolean
  uploadError: string | null
  onSceneSelect: (filename: string) => void
  onTogglePin: (filename: string) => void
  onRemoveScene: (seed: SeedRecord) => void
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onClipboardUpload: () => void
  onBack: () => void
}

const PauseScenesView = ({
  seeds,
  thumbnails,
  pinnedSceneIds,
  uploadingImage,
  uploadError,
  onSceneSelect,
  onTogglePin,
  onRemoveScene,
  onImageUpload,
  onClipboardUpload,
  onBack
}: PauseScenesViewProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="overlay-darken absolute inset-0 p-[3.8%_4%] z-[2]">
      <section className="absolute top-[var(--edge-top-xl)] left-[var(--edge-left)] w-[70%] z-[3] flex flex-col">
        <h2 className={`${HEADING_BASE} text-heading text-text-primary font-normal text-left`}>Scenes</h2>
        <p className="m-0 font-serif text-caption text-text-muted max-w-[103.12cqh] text-left">
          All of your {seeds.length} {seeds.length === 1 ? 'scene' : 'scenes'}. Add more by using the + button, or by
          drag/pasting them in.
        </p>
        {uploadError && <p className="!mt-[0.6cqh] !text-[rgba(255,180,180,0.92)]">{uploadError}</p>}
        <input ref={fileInputRef} type="file" accept="image/*" onChange={onImageUpload} style={{ display: 'none' }} />
        <div className="pause-scene-scroll pause-scene-scroll-main mt-[1.1cqh] relative z-[4]">
          <div className="pause-scene-grid w-full">
            <button
              type="button"
              className={`pause-scene-add-card grid grid-cols-2 ${uploadingImage ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={(event) => event.preventDefault()}
            >
              <span
                className="grid place-items-center font-serif text-small text-text-secondary cursor-pointer"
                onClick={() => void onClipboardUpload()}
                title="Paste image from clipboard"
              >
                <svg
                  className="w-[2.67cqh] h-[2.67cqh]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <rect x="9" y="3" width="6" height="4" rx="1" />
                  <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
                  <rect x="12" y="10" width="8" height="10" rx="1" />
                </svg>
              </span>
              <span
                className="grid place-items-center font-serif text-small text-text-secondary cursor-pointer border-l border-[rgba(245,249,255,0.35)]"
                onClick={() => fileInputRef.current?.click()}
                title="Browse for image file"
              >
                <svg
                  className="w-[2.67cqh] h-[2.67cqh]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
            {seeds.map((seed) => (
              <SceneCard
                key={`scene-${seed.filename}`}
                seed={seed}
                thumbnailSrc={thumbnails[seed.filename]}
                isPinned={pinnedSceneIds.includes(seed.filename)}
                pinVariant="toggle"
                onSelect={onSceneSelect}
                onTogglePin={onTogglePin}
                onRemove={onRemoveScene}
              />
            ))}
          </div>
        </div>
      </section>
      <MenuButton
        variant="primary"
        className="absolute right-[var(--edge-right)] bottom-[var(--edge-bottom)] w-btn-w px-0"
        onClick={onBack}
      >
        Back
      </MenuButton>
    </div>
  )
}

export default PauseScenesView
