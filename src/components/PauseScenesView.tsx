import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { SeedRecord } from '../types/app'
import SceneCard from './SceneCard'
import MenuButton from './ui/MenuButton'
import RawSettingsButton from './ui/RawSettingsButton'
import { HEADING_BASE } from '../styles'
import { ALLOW_USER_SCENES } from '../constants'
import { useTranslation } from 'react-i18next'

interface PauseScenesViewProps {
  seeds: SeedRecord[]
  thumbnails: Record<string, string>
  pinnedSceneIds: string[]
  uploadingImage: boolean
  uploadError: string | null
  selectCooldown: boolean
  onSceneSelect: (filename: string) => void
  onTogglePin: (filename: string) => void
  onRemoveScene: (seed: SeedRecord) => void
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onImageDrop: (files: File[]) => void
  onClipboardUpload: () => void
  onBack: () => void
}

const PauseScenesView = ({
  seeds,
  thumbnails,
  pinnedSceneIds,
  uploadingImage,
  uploadError,
  selectCooldown,
  onSceneSelect,
  onTogglePin,
  onRemoveScene,
  onImageUpload,
  onImageDrop,
  onClipboardUpload,
  onBack
}: PauseScenesViewProps) => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const [isDragActive, setIsDragActive] = useState(false)

  useEffect(() => {
    if (!ALLOW_USER_SCENES) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const isPasteShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v'
      if (!isPasteShortcut) return

      const target = event.target as HTMLElement | null
      if (
        target &&
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)
      ) {
        return
      }

      event.preventDefault()
      void onClipboardUpload()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClipboardUpload])

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
      className="absolute inset-0 p-[3.8%_4%] z-[2]"
      {...(ALLOW_USER_SCENES
        ? {
            onDragEnter: handleDragEnter,
            onDragOver: handleDragOver,
            onDragLeave: handleDragLeave,
            onDrop: handleDrop
          }
        : {})}
    >
      {ALLOW_USER_SCENES && isDragActive && (
        <div
          className="absolute inset-[2.4cqh] z-[20] border border-[rgba(245,249,255,0.86)] bg-[rgba(248,248,245,0.12)] pointer-events-none grid place-items-center"
          aria-hidden="true"
        >
          <span className="font-serif text-[3.11cqh] text-[rgba(245,249,255,0.95)]">
            {t('app.pause.scenes.dropImagesToAddScenes')}
          </span>
        </div>
      )}
      <section className="absolute top-[var(--edge-top-xl)] left-[var(--edge-left)] w-[92%] z-[3] flex flex-col">
        <h2 className={`${HEADING_BASE} text-heading text-text-primary font-normal text-left`}>
          {t('app.pause.scenes.title')}
        </h2>
        <p className="m-0 font-serif text-caption text-text-muted max-w-[103.12cqh] text-left">
          {t('app.pause.scenes.description', { count: seeds.length })}
          {ALLOW_USER_SCENES && ` ${t('app.pause.scenes.uploadHint')}`}
        </p>
        {uploadError && (
          <p className="m-0 mt-[0.6cqh] font-serif text-caption text-[var(--color-error-bright)]">{uploadError}</p>
        )}
        {ALLOW_USER_SCENES && (
          <input ref={fileInputRef} type="file" accept="image/*" onChange={onImageUpload} style={{ display: 'none' }} />
        )}
        <div className="styled-scrollbar overflow-y-auto pr-[0.8cqh] max-h-[62cqh] mt-[1.1cqh] relative z-[4]">
          <div className="grid grid-cols-[repeat(auto-fill,25.78cqh)] gap-[1.28cqh] w-full">
            {ALLOW_USER_SCENES && (
              <div
                className={`relative w-full aspect-video border border-[rgba(245,249,255,0.84)] bg-[rgba(248,248,245,0.14)] p-0 overflow-hidden grid grid-cols-2 ${uploadingImage ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <span
                  className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-[rgba(245,249,255,0.4)] pointer-events-none z-[1]"
                  aria-hidden="true"
                />
                <RawSettingsButton
                  variant="secondary"
                  className="!rounded-none !border-0 !outline-0 hover:!outline-0 h-full w-full grid place-items-center !p-0 active:bg-[var(--color-surface-btn-hover)] active:text-[var(--color-text-inverse)] focus-visible:outline-2 focus-visible:outline-[var(--color-surface-btn-hover)]"
                  onClick={() => void onClipboardUpload()}
                  title={t('app.buttons.pasteImageFromClipboard')}
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
                </RawSettingsButton>
                <RawSettingsButton
                  variant="secondary"
                  className="!rounded-none !border-0 !outline-0 hover:!outline-0 h-full w-full grid place-items-center !p-0 active:bg-[var(--color-surface-btn-hover)] active:text-[var(--color-text-inverse)] focus-visible:outline-2 focus-visible:outline-[var(--color-surface-btn-hover)]"
                  onClick={() => fileInputRef.current?.click()}
                  title={t('app.buttons.browseForImageFile')}
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
                </RawSettingsButton>
              </div>
            )}
            {seeds.map((seed) => (
              <SceneCard
                key={`scene-${seed.filename}`}
                seed={seed}
                thumbnailSrc={thumbnails[seed.filename]}
                isPinned={pinnedSceneIds.includes(seed.filename)}
                pinVariant="toggle"
                selectCooldown={selectCooldown}
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
        label="app.buttons.back"
        className="absolute right-[var(--edge-right)] bottom-[var(--edge-bottom)] w-btn-w px-0"
        onClick={onBack}
      />
    </div>
  )
}

export default PauseScenesView
