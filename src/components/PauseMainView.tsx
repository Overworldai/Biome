import { useMemo } from 'react'
import type { SeedRecord } from '../types/app'
import SceneGrid from './SceneGrid'
import SocialCtaRow from './SocialCtaRow'
import ViewLabel from './ui/ViewLabel'
import MenuButton from './ui/MenuButton'
import { VIEW_DESCRIPTION, VIEW_HEADING } from '../styles'
import { ALLOW_USER_SCENES } from '../constants'
import { useTranslation } from 'react-i18next'

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
}: PauseMainViewProps) => {
  const { t } = useTranslation()
  const suffix = ALLOW_USER_SCENES ? t('app.pause.pinnedScenes.uploadSuffix') : t('app.pause.pinnedScenes.pinSuffix')
  const pinnedSceneIds = useMemo(() => pinnedScenes.map((s) => s.filename), [pinnedScenes])

  return (
    <div className="absolute inset-0 p-[3.8%_4%]">
      <SocialCtaRow />

      <section className="absolute top-[var(--edge-top-xl)] left-[var(--edge-left)] w-[77%] flex flex-col">
        <h2 className={VIEW_HEADING}>{t('app.pause.pinnedScenes.title')}</h2>
        <p className={VIEW_DESCRIPTION}>{t('app.pause.pinnedScenes.description', { suffix })}</p>
        <SceneGrid
          seeds={pinnedScenes}
          thumbnails={thumbnails}
          pinnedSceneIds={pinnedSceneIds}
          pinVariant="pinned-only"
          selectCooldown={selectCooldown}
          onSelect={onSceneSelect}
          onTogglePin={onTogglePin}
          onRemove={onRemoveScene}
          emptyState={
            <div
              className="w-full aspect-video rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-btn-secondary)] p-0 cursor-default overflow-hidden relative grid place-items-center"
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
          }
        />
      </section>

      <ViewLabel>
        <span className="inline-flex items-end gap-[1.42cqh]">
          <span>{t('app.pause.title')}</span>
          <span
            className={`self-end font-serif text-[2.13cqh] leading-[1.0] tracking-[0.03em] text-[rgba(245,249,255,0.62)] transition-opacity duration-120 ${
              showPauseLockoutTimer
                ? 'opacity-100 [animation:pauseUnlockHintPulse_1200ms_ease-out_forwards]'
                : 'opacity-0'
            }`}
          >
            {showPauseLockoutTimer ? t('app.pause.unlockIn', { seconds: pauseLockoutSecondsText }) : ''}
          </span>
        </span>
      </ViewLabel>

      <div className="absolute right-[var(--edge-right)] bottom-[var(--edge-bottom)] w-btn-w flex flex-col gap-[1.1cqh]">
        <MenuButton variant="secondary" label="app.buttons.reset" className="w-full px-0" onClick={onResetAndResume} />
        <MenuButton
          variant="secondary"
          label="app.buttons.scenes"
          className="w-full px-0"
          onClick={() => onNavigate('scenes')}
        />
        <MenuButton
          variant="secondary"
          label="app.buttons.settings"
          className="w-full px-0"
          onClick={() => onNavigate('settings')}
        />
        <MenuButton variant="primary" label="app.buttons.resume" className="w-full px-0" onClick={requestPointerLock} />
      </div>
    </div>
  )
}

export default PauseMainView
