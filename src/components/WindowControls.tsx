import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../i18n'
import { useWindow } from '../hooks/useWindow'
import { useStreaming } from '../context/StreamingContext'
const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties

const WindowControlButton = ({
  onClick,
  label,
  hoverBg = 'hover:bg-surface-btn-hover hover:text-text-inverse',
  children
}: {
  onClick: () => void
  label: TranslationKey
  hoverBg?: string
  children: ReactNode
}) => {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      tabIndex={-1}
      className={`
        m-0 flex h-6 w-[35px] cursor-pointer items-center justify-center rounded-sm border border-border-light
        bg-surface-btn-secondary p-0 font-serif text-[14px] leading-none text-text-primary outline-0
        transition-[background-color,color,border-color] duration-160 ease-in-out
        ${hoverBg}
        hover:border-transparent
      `}
      onClick={onClick}
      aria-label={t(label)}
      style={noDragRegionStyle}
    >
      {children}
    </button>
  )
}

const WindowControls = () => {
  const { minimize, toggleMaximize, close } = useWindow()
  const { isStreaming, isPaused } = useStreaming()
  const dragRegionStyle = {
    WebkitAppRegion: 'drag',
    WebkitUserSelect: 'none',
    userSelect: 'none'
  } as CSSProperties

  const hidden = isStreaming && !isPaused

  return (
    <div className="absolute inset-x-0 top-0 z-9998 h-10" style={dragRegionStyle}>
      <div
        className={`
          pointer-events-none absolute inset-0 transition-opacity duration-300
          ${hidden ? 'opacity-0' : 'opacity-50'}
        `}
      >
        <div
          className="
            size-full bg-[linear-gradient(to_bottom,rgba(7,10,18,0.42)_0%,rgba(7,10,18,0.2)_38%,rgba(7,10,18,0)_100%)]
          "
        />
      </div>
      <div
        className={`
          absolute top-1.5 right-1.5 z-9999 flex flex-row gap-1 transition-opacity duration-300
          ${
            hidden
              ? 'pointer-events-none opacity-0'
              : `
                pointer-events-auto opacity-50
                hover:opacity-100
              `
          }
        `}
        style={noDragRegionStyle}
      >
        <WindowControlButton onClick={minimize} label="app.window.minimize">
          &#x2014;
        </WindowControlButton>
        <WindowControlButton onClick={toggleMaximize} label="app.window.maximize">
          <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true" className="block">
            <rect
              x="2.25"
              y="2.25"
              width="7.5"
              height="7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              rx="0.5"
            />
          </svg>
        </WindowControlButton>
        <WindowControlButton onClick={close} label="app.window.close" hoverBg="hover:bg-danger hover:text-white">
          &#x2715;
        </WindowControlButton>
      </div>
    </div>
  )
}

export default WindowControls
