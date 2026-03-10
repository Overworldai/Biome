import type { CSSProperties, ReactNode } from 'react'
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
  label: string
  hoverBg?: string
  children: ReactNode
}) => (
  <button
    type="button"
    className={`flex items-center justify-center w-[35px] h-6 m-0 p-0 rounded-sm text-[14px] leading-none cursor-pointer bg-surface-btn-secondary text-text-primary font-serif border border-border-light outline-0 transition-[background-color,color,border-color] duration-[160ms] ease-in-out ${hoverBg} hover:border-transparent`}
    onClick={onClick}
    aria-label={label}
    style={noDragRegionStyle}
  >
    {children}
  </button>
)

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
    <div className="absolute top-0 left-0 right-0 h-10 z-[9998]" style={dragRegionStyle}>
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
          hidden ? 'opacity-0' : 'opacity-50'
        }`}
      >
        <div className="h-full w-full bg-[linear-gradient(to_bottom,rgba(7,10,18,0.42)_0%,rgba(7,10,18,0.2)_38%,rgba(7,10,18,0)_100%)]" />
      </div>
      <div
        className={`absolute top-1.5 right-1.5 z-[9999] flex flex-row gap-1 transition-opacity duration-300 ${
          hidden ? 'opacity-0 pointer-events-none' : 'opacity-50 hover:opacity-100 pointer-events-auto'
        }`}
        style={noDragRegionStyle}
      >
        <WindowControlButton onClick={minimize} label="Minimize">
          &#x2014;
        </WindowControlButton>
        <WindowControlButton onClick={toggleMaximize} label="Maximize">
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
        <WindowControlButton onClick={close} label="Close" hoverBg="hover:bg-danger hover:text-white">
          &#x2715;
        </WindowControlButton>
      </div>
    </div>
  )
}

export default WindowControls
