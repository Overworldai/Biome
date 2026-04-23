import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { SeedRecord } from '../types/app'
import SceneGrid from './SceneGrid'
import SceneAuthoringPrompt from './SceneAuthoringPrompt'
import SocialCtaRow from './SocialCtaRow'
import ViewLabel from './ui/ViewLabel'
import MenuButton from './ui/MenuButton'
import RawSettingsButton from './ui/RawSettingsButton'
import { VIEW_DESCRIPTION, VIEW_HEADING } from '../styles'
import { ALLOW_USER_SCENES } from '../constants'
import { useTranslation } from 'react-i18next'
import { useSettings } from '../hooks/settingsContextValue'

interface PauseMainViewProps {
  scenes: SeedRecord[]
  thumbnails: Record<string, string>
  selectCooldown: boolean
  uploadingImage: boolean
  uploadError: string | null
  onSceneSelect: (filename: string) => void
  onRemoveScene: (seed: SeedRecord) => void
  onMoveScene: (filename: string, targetIdx: number) => void
  onResetAndResume: () => void
  onNavigateSettings: () => void
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onImageDrop: (files: File[]) => void
  requestPointerLock: () => void
  showPauseLockoutTimer: boolean
  pauseLockoutSecondsText: string
  isGenerating: boolean
  generateError: string | null
  onGenerateScene: (prompt: string) => void
}

const PauseMainView = ({
  scenes,
  thumbnails,
  selectCooldown,
  uploadingImage,
  uploadError,
  onSceneSelect,
  onRemoveScene,
  onMoveScene,
  onResetAndResume,
  onNavigateSettings,
  onImageUpload,
  onImageDrop,
  requestPointerLock,
  showPauseLockoutTimer,
  pauseLockoutSecondsText,
  isGenerating,
  generateError,
  onGenerateScene
}: PauseMainViewProps) => {
  const { t } = useTranslation()
  const { settings } = useSettings()
  const sceneAuthoringEnabled = settings.scene_authoring_enabled ?? false

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const [isDragActive, setIsDragActive] = useState(false)

  const hasImagePayload = (event: DragEvent<HTMLDivElement>): boolean => {
    const dt = event.dataTransfer
    if (!dt) return false

    // During dragenter/dragover, Chromium/Electron may expose only "Files"
    // in types and leave files[] empty until drop.
    const types = Array.from(dt.types || [])
    if (types.includes('Files')) return true

    if (dt.items && dt.items.length > 0) {
      return Array.from(dt.items).some((item) => item.kind === 'file')
    }

    if (dt.files && dt.files.length > 0) {
      return Array.from(dt.files).some((file) => file.type.startsWith('image/'))
    }

    return false
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasImagePayload(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current += 1
    setIsDragActive(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasImagePayload(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isDragActive) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragActive(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setIsDragActive(false)
    const files = Array.from(event.dataTransfer.files || [])
    if (files.length === 0) return
    onImageDrop(files)
  }

  return (
    <div
      className="absolute inset-0 p-[3.8%_4%]"
      {...(ALLOW_USER_SCENES
        ? {
            onDragEnter: handleDragEnter,
            onDragOver: handleDragOver,
            onDragLeave: handleDragLeave,
            onDrop: handleDrop
          }
        : {})}
    >
      <SocialCtaRow />

      {ALLOW_USER_SCENES && isDragActive && (
        <div
          className="
            pointer-events-none absolute inset-[2.4cqh] z-20 grid place-items-center border
            border-[rgba(245,249,255,0.86)] bg-[rgba(248,248,245,0.12)]
          "
          aria-hidden="true"
        >
          <span className="font-serif text-[3.11cqh] text-[rgba(245,249,255,0.95)]">
            {t('app.pause.scenes.dropImagesToAddScenes')}
          </span>
        </div>
      )}

      <section
        className={`
          absolute top-(--edge-top) bottom-[13cqh] left-(--edge-left) flex w-[77%] flex-col
          ${isGenerating ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <h2 className={VIEW_HEADING}>{t('app.pause.scenes.title')}</h2>
        <p className={VIEW_DESCRIPTION}>
          {t('app.pause.scenes.description', { count: scenes.length })}
          {ALLOW_USER_SCENES && ` ${t('app.pause.scenes.uploadHint')}`}
          {scenes.length > 1 && ` ${t('app.pause.scenes.reorderHint')}`}
        </p>
        {uploadError && <p className="m-0 mt-[0.6cqh] font-serif text-caption text-error-bright">{uploadError}</p>}
        {ALLOW_USER_SCENES && (
          <input ref={fileInputRef} type="file" accept="image/*" onChange={onImageUpload} style={{ display: 'none' }} />
        )}
        <SceneGrid
          scenes={scenes}
          thumbnails={thumbnails}
          selectCooldown={selectCooldown}
          onSelect={onSceneSelect}
          onRemove={onRemoveScene}
          onMoveScene={onMoveScene}
          before={
            ALLOW_USER_SCENES && (
              <div
                className={`
                  relative aspect-video w-full overflow-hidden border border-[rgba(245,249,255,0.84)]
                  bg-[rgba(248,248,245,0.14)] p-0
                  ${uploadingImage ? 'pointer-events-none opacity-60' : ''}
                `}
              >
                <RawSettingsButton
                  variant="secondary"
                  className="
                    grid size-full place-items-center rounded-none! border-0! p-0! outline-0!
                    hover:outline-0!
                    focus-visible:outline-2 focus-visible:outline-surface-btn-hover
                    active:bg-surface-btn-hover active:text-text-inverse
                  "
                  onClick={() => fileInputRef.current?.click()}
                  title={t('app.buttons.browseForImageFile')}
                >
                  <svg
                    className="h-[2.67cqh] w-[2.67cqh]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
                    <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </RawSettingsButton>
              </div>
            )
          }
        />
        {sceneAuthoringEnabled && (
          <SceneAuthoringPrompt
            isGenerating={isGenerating}
            generateError={generateError}
            onGenerate={onGenerateScene}
          />
        )}
      </section>

      <ViewLabel>
        <span className="inline-flex items-end gap-[1.42cqh]">
          <span>{t('app.pause.title')}</span>
          <span
            className={`
              self-end font-serif text-[2.13cqh] leading-none tracking-[0.03em] text-[rgba(245,249,255,0.62)]
              transition-opacity duration-120
              ${
                showPauseLockoutTimer
                  ? 'animate-[pauseUnlockHintPulse_1200ms_ease-out_forwards] opacity-100'
                  : 'opacity-0'
              }
            `}
          >
            {showPauseLockoutTimer ? t('app.pause.unlockIn', { seconds: pauseLockoutSecondsText }) : ''}
          </span>
        </span>
      </ViewLabel>

      <div className="absolute right-(--edge-right) bottom-(--edge-bottom) flex w-btn-w flex-col gap-[1.1cqh]">
        <MenuButton
          variant="secondary"
          label="app.buttons.reset"
          className="w-full px-0"
          onClick={onResetAndResume}
          disabled={isGenerating}
        />
        <MenuButton
          variant="secondary"
          label="app.buttons.settings"
          className="w-full px-0"
          onClick={onNavigateSettings}
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
