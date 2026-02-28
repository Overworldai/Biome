import type { CSSProperties } from 'react'
import { useWindow } from '../hooks/useWindow'
import { useStreaming } from '../context/StreamingContext'
import { WINDOW_CONTROL_BASE } from '../styles'

const WindowControls = () => {
  const { minimize, close } = useWindow()
  const { isStreaming, isPaused } = useStreaming()
  const dragRegionStyle = {
    WebkitAppRegion: 'drag',
    WebkitUserSelect: 'none',
    userSelect: 'none'
  } as CSSProperties
  const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties

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
          hidden ? 'opacity-0 pointer-events-none' : 'opacity-50 pointer-events-auto'
        }`}
        style={noDragRegionStyle}
      >
        <button
          type="button"
          className={`${WINDOW_CONTROL_BASE} outline-0 outline-[rgba(245,251,255,0.8)] transition-[background-color,color,outline-width] duration-[160ms] ease-in-out hover:bg-[rgba(245,251,255,0.9)] hover:text-[rgba(15,20,32,0.95)] hover:outline-2`}
          onClick={minimize}
          aria-label="Minimize"
          style={noDragRegionStyle}
        >
          &#x2014;
        </button>
        <button
          type="button"
          className={`${WINDOW_CONTROL_BASE} outline-0 outline-[rgba(220,50,50,0.9)] transition-[background-color,color,outline-width] duration-[160ms] ease-in-out hover:bg-[rgba(220,50,50,0.9)] hover:text-white hover:outline-2`}
          onClick={close}
          aria-label="Close"
          style={noDragRegionStyle}
        >
          &#x2715;
        </button>
      </div>
    </div>
  )
}

export default WindowControls
