import { useMemo, useState } from 'react'
import type { SeedRecord } from '../types/app'
import SceneGrid from './SceneGrid'
import SocialCtaRow from './SocialCtaRow'
import ViewLabel from './ui/ViewLabel'
import MenuButton from './ui/MenuButton'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT, VIEW_DESCRIPTION, VIEW_HEADING } from '../styles'
import { ALLOW_USER_SCENES } from '../constants'
import { useTranslation } from 'react-i18next'
import { useSettings } from '../hooks/useSettings'

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
  generateState: 'idle' | 'loading' | 'error'
  generateError: string | null
  onGenerateScene: (prompt: string) => void
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
  showUnlockHint,
  generateState,
  generateError,
  onGenerateScene
}: PauseMainViewProps) => {
  const { t } = useTranslation()
  const { settings } = useSettings()
  const sceneEditEnabled = settings.experimental?.scene_edit_enabled ?? false
  const isGenerating = generateState === 'loading'
  const suffix = ALLOW_USER_SCENES ? t('app.pause.pinnedScenes.uploadSuffix') : t('app.pause.pinnedScenes.pinSuffix')
  const pinnedSceneIds = useMemo(() => pinnedScenes.map((s) => s.filename), [pinnedScenes])
  const [promptText, setPromptText] = useState('')

  return (
    <div className="absolute inset-0 p-[3.8%_4%]">
      <SocialCtaRow />

      <section
        className={`absolute top-[var(--edge-top-xl)] left-[var(--edge-left)] w-[77%] flex flex-col ${isGenerating ? 'pointer-events-none opacity-60' : ''}`}
      >
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
        {sceneEditEnabled && (
          <>
            <div className="flex items-center gap-[1.5cqh] mt-[2cqh]">
              <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
              <span className="font-serif text-caption text-text-muted">{t('app.pause.generateScene.divider')}</span>
              <div className="flex-1 h-px bg-[var(--color-border-subtle)]" />
            </div>
            <div className="mt-[1.5cqh] relative">
              {generateState === 'error' && generateError && (
                <p className="m-0 font-serif text-caption text-red-400 mb-[0.8cqh]">{generateError}</p>
              )}
              <input
                type="text"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                disabled={isGenerating}
                placeholder={t('app.pause.generateScene.placeholder')}
                className={`${SETTINGS_CONTROL_BASE} ${SETTINGS_CONTROL_TEXT} w-full outline-none focus:ring-1 focus:ring-border-medium disabled:opacity-50`}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const trimmed = promptText.trim()
                    if (trimmed && !isGenerating) {
                      onGenerateScene(trimmed)
                    }
                  }
                }}
                onKeyUp={(e) => e.stopPropagation()}
              />
              {isGenerating && (
                <div className="absolute right-[1.2cqh] top-1/2 -translate-y-1/2 h-[2cqh] w-[2cqh] animate-spin rounded-full border-[0.3cqh] border-text-muted border-t-text-primary" />
              )}
            </div>
          </>
        )}
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
        <MenuButton
          variant="secondary"
          label="app.buttons.reset"
          className="w-full px-0"
          onClick={onResetAndResume}
          disabled={isGenerating}
        />
        <MenuButton
          variant="secondary"
          label="app.buttons.scenes"
          className="w-full px-0"
          onClick={() => onNavigate('scenes')}
          disabled={isGenerating}
        />
        <MenuButton
          variant="secondary"
          label="app.buttons.settings"
          className="w-full px-0"
          onClick={() => onNavigate('settings')}
          disabled={isGenerating}
        />
        <MenuButton
          variant="primary"
          label="app.buttons.resume"
          className="w-full px-0"
          onClick={requestPointerLock}
          disabled={isGenerating}
        />
      </div>
    </div>
  )
}

export default PauseMainView
