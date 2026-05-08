import { useTranslation } from 'react-i18next'
import { STYLED_SCROLLBAR } from '../../styles'
import { propImageUrl, type PropEntry, type PropManifestState } from '../../hooks/scene/usePropManifest'

const slugToSubject = (slug: string): string => slug.replace(/_/g, ' ')

type PropTileGridProps = {
  visibleProps: PropEntry[]
  manifestState: PropManifestState
  disabled: boolean
  onSelect: (prop: PropEntry) => void
}

/** 3-column grid of prop thumbnails — image-only buttons that fire
 *  `onSelect` when clicked. Renders loading / error placeholders when
 *  the parent manifest fetch hasn't landed yet. The thumbnails are
 *  PNGs with alpha (rembg-cut), so the dark tile background shows
 *  through the model-baked white studio backdrop without needing a
 *  CSS luma key. */
const PropTileGrid = ({ visibleProps, manifestState, disabled, onSelect }: PropTileGridProps) => {
  const { t } = useTranslation()

  return (
    <div
      className={`
        ${STYLED_SCROLLBAR}
        grid min-w-0 flex-1 auto-rows-min grid-cols-3 content-start gap-[0.8cqh] overflow-y-auto pr-[0.3cqw]
      `}
    >
      {visibleProps.map((prop) => (
        <button
          key={prop.slug}
          type="button"
          onClick={() => onSelect(prop)}
          onMouseDown={(e) => e.preventDefault()}
          className="
            group relative aspect-square overflow-hidden bg-black/40 p-[0.6cqh] transition-colors
            hover:bg-black/60
            disabled:cursor-not-allowed disabled:opacity-50
          "
          disabled={disabled}
          title={slugToSubject(prop.slug)}
        >
          <img
            src={propImageUrl(prop.image)}
            alt={slugToSubject(prop.slug)}
            className="size-full object-contain"
            draggable={false}
          />
        </button>
      ))}
      {manifestState.status === 'loading' && (
        <span className="col-span-3 py-[2cqh] text-center font-serif text-[1.8cqh] text-text-muted">
          {t('app.sceneEdit.loadingProps', { defaultValue: 'Loading props…' })}
        </span>
      )}
      {manifestState.status === 'error' && (
        <span className="col-span-3 py-[2cqh] text-center font-serif text-[1.8cqh] text-red-400">
          {manifestState.message}
        </span>
      )}
    </div>
  )
}

export default PropTileGrid
