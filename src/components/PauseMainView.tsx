import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { SeedRecord } from '../types/app'
import SceneGrid from './SceneGrid'
import SceneCardAddButton from './SceneCardAddButton'
import SceneAuthoringPrompt from './SceneAuthoringPrompt'
import SocialCtaRow from './SocialCtaRow'
import MenuButton from './ui/MenuButton'
import Slider from './ui/Slider'
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
  onNavigateSettings: () => void
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onImageDrop: (files: File[]) => void
  requestPointerLock: () => void
  isGenerating: boolean
  generateError: string | null
  lastAddedFilename: string | null
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
  onNavigateSettings,
  onImageUpload,
  onImageDrop,
  requestPointerLock,
  isGenerating,
  generateError,
  lastAddedFilename,
  onGenerateScene
}: PauseMainViewProps) => {
  const { t } = useTranslation()
  const { settings, saveSettings } = useSettings()
  const sceneAuthoringEnabled = settings.scene_authoring_enabled ?? false
  const sceneGridColumns = settings.scene_grid_columns

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
          absolute top-(--edge-top) right-(--edge-right) bottom-[11cqh] left-(--edge-left) flex flex-col
          ${isGenerating ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <div className="flex items-end justify-between gap-[2cqh]">
          <div className="min-w-0 flex-1">
            <h2 className={VIEW_HEADING}>{t('app.pause.scenes.title')}</h2>
            <p
              className={`
                ${VIEW_DESCRIPTION}
                max-w-full
              `}
            >
              {t(ALLOW_USER_SCENES ? 'app.pause.scenes.sceneSubtitleWithUserScenes' : 'app.pause.scenes.sceneSubtitle')}
            </p>
          </div>
          <div className="w-[30cqh] shrink-0">
            <Slider
              variant="discrete"
              min={3}
              max={7}
              value={sceneGridColumns}
              onChange={(value) => void saveSettings({ ...settings, scene_grid_columns: value })}
              label="app.pause.scenes.scenesPerRow"
              suffix={String(sceneGridColumns)}
            />
          </div>
        </div>
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
          autoScrollTo={lastAddedFilename}
          columns={sceneGridColumns}
          before={
            ALLOW_USER_SCENES && (
              <SceneCardAddButton
                onClick={() => fileInputRef.current?.click()}
                title={t('app.buttons.browseForImageFile')}
                disabled={uploadingImage}
              />
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

      {lastAddedFilename && (
        <p
          className="
            pointer-events-none absolute bottom-(--edge-bottom) left-(--edge-left) m-0 flex h-[5.2cqh] items-center
            font-serif text-body text-text-primary
          "
        >
          {t('app.pause.unpauseToPlay')}
        </p>
      )}

      <div className="absolute right-(--edge-right) bottom-(--edge-bottom) flex gap-[1.1cqh]">
        <MenuButton
          variant="secondary"
          label="app.buttons.settings"
          onClick={onNavigateSettings}
          disabled={isGenerating}
        />
        <MenuButton variant="primary" label="app.buttons.resume" onClick={requestPointerLock} disabled={isGenerating} />
      </div>
    </div>
  )
}

export default PauseMainView
