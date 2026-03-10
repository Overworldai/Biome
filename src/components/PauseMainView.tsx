import type { SeedRecord } from '../types/app'
import SceneCard from './SceneCard'
import SocialCtaRow from './SocialCtaRow'
import ViewLabel from './ui/ViewLabel'
import MenuButton from './ui/MenuButton'
import { HEADING_BASE } from '../styles'

interface PauseMainViewProps {
  pinnedScenes: SeedRecord[]
  thumbnails: Record<string, string>
  selectCooldown: boolean
  onSceneSelect: (filename: string) => void
  onTogglePin: (filename: string) => void
  onRemoveScene: (seed: SeedRecord) => void
  onResetAndResume: () => void
  onNavigate: (view: 'scenes' | 'settings') => void
  requestPointerLock: () => void
  showPauseLockoutTimer: boolean
  pauseLockoutSecondsText: string
  showUnlockHint: boolean
}

const PauseMainView = ({
  pinnedScenes,
  thumbnails,
  selectCooldown,
  onSceneSelect,
  onTogglePin,
  onRemoveScene,
  onResetAndResume,
  onNavigate,
  requestPointerLock,
  showPauseLockoutTimer,
  pauseLockoutSecondsText,
  showUnlockHint
}: PauseMainViewProps) => (
  <div className="absolute inset-0 p-[3.8%_4%]">
    <SocialCtaRow />

    <section className="absolute top-[var(--edge-top-xl)] left-[var(--edge-left)] w-[77%] flex flex-col">
      <h2 className={`${HEADING_BASE} text-heading text-text-primary font-normal text-left`}>Pinned Scenes</h2>
      <p className="m-0 font-serif text-caption text-text-muted max-w-[103.12cqh] text-left">
        Your pinned scenes. Use the Scenes button to view, pin or upload more scenes.
      </p>
      <div className="pause-scene-scroll overflow-y-auto pr-[0.8cqh] max-h-[62cqh] mt-[1.1cqh]">
        <div className="grid grid-cols-[repeat(auto-fill,25.78cqh)] gap-[1.28cqh] w-full">
          {pinnedScenes.length > 0 ? (
            pinnedScenes.map((seed) => (
              <SceneCard
                key={`pinned-${seed.filename}`}
                seed={seed}
                thumbnailSrc={thumbnails[seed.filename]}
                isPinned={true}
                pinVariant="pinned-only"
                selectCooldown={selectCooldown}
                onSelect={onSceneSelect}
                onTogglePin={onTogglePin}
                onRemove={onRemoveScene}
              />
            ))
          ) : (
            <div
              className="w-full aspect-video rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-btn-ghost)] p-0 cursor-default overflow-hidden relative grid place-items-center"
              aria-hidden="true"
            >
              <svg
                className="w-[36%] h-[36%] text-[rgba(245,249,255,0.5)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.4" />
                <polyline points="21,15 16,10 5,21" />
              </svg>
            </div>
          )}
        </div>
      </div>
    </section>

    <ViewLabel>
      <span className="inline-flex items-end gap-[1.42cqh]">
        <span>Paused</span>
        <span
          className={`self-end font-serif text-[2.13cqh] leading-[1.0] tracking-[0.03em] text-[rgba(245,249,255,0.62)] transition-opacity duration-120 ${
            showPauseLockoutTimer
              ? 'opacity-100 [animation:pauseUnlockHintPulse_1200ms_ease-out_forwards]'
              : 'opacity-0'
          }`}
        >
          {showPauseLockoutTimer ? `unlock in ${pauseLockoutSecondsText}s` : ''}
        </span>
      </span>
    </ViewLabel>

    <div className="absolute right-[var(--edge-right)] bottom-[var(--edge-bottom)] w-btn-w flex flex-col gap-[1.1cqh]">
      <MenuButton variant="secondary" className="w-full px-0" onClick={onResetAndResume}>
        Reset
      </MenuButton>
      <MenuButton variant="secondary" className="w-full px-0" onClick={() => onNavigate('scenes')}>
        Scenes
      </MenuButton>
      <MenuButton variant="secondary" className="w-full px-0" onClick={() => onNavigate('settings')}>
        Settings
      </MenuButton>
      <MenuButton variant="primary" className="w-full px-0" onClick={requestPointerLock}>
        Resume
      </MenuButton>
    </div>
  </div>
)

export default PauseMainView
