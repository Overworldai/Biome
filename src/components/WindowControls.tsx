import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useWindow } from '../hooks/useWindow'

const CONTROLS_HIDE_DELAY_MS = 1000
const NEAR_CONTROLS_PADDING_PX = 60
const TOP_DRAG_HOVER_ZONE_PX = 64

const WindowControls = () => {
  const { minimize, close } = useWindow()
  const dragRegionStyle = {
    WebkitAppRegion: 'drag',
    WebkitUserSelect: 'none',
    userSelect: 'none'
  } as CSSProperties
  const noDragRegionStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties
  const controlsRef = useRef<HTMLDivElement | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const [isPointerNearControls, setIsPointerNearControls] = useState(false)
  const [isPointerNearTopZone, setIsPointerNearTopZone] = useState(false)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const clearHideTimer = () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }

    const startHideTimer = () => {
      clearHideTimer()
      hideTimerRef.current = window.setTimeout(() => {
        setIsVisible(false)
      }, CONTROLS_HIDE_DELAY_MS)
    }

    // Ensure controls are visible on startup for discoverability.
    setIsVisible(true)
    startHideTimer()

    const onMouseMove = (event: MouseEvent) => {
      const controlsEl = controlsRef.current
      if (!controlsEl) return

      const rect = controlsEl.getBoundingClientRect()
      const isNear =
        event.clientX >= rect.left - NEAR_CONTROLS_PADDING_PX &&
        event.clientX <= rect.right + NEAR_CONTROLS_PADDING_PX &&
        event.clientY >= rect.top - NEAR_CONTROLS_PADDING_PX &&
        event.clientY <= rect.bottom + NEAR_CONTROLS_PADDING_PX
      // the alternative of doing direct hovering checks doesn't work for drag regions
      const isNearTop = event.clientY <= TOP_DRAG_HOVER_ZONE_PX

      setIsPointerNearControls((current) => (current === isNear ? current : isNear))
      setIsPointerNearTopZone((current) => (current === isNearTop ? current : isNearTop))
    }

    window.addEventListener('mousemove', onMouseMove, { passive: true })

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      clearHideTimer()
    }
  }, [])

  useEffect(() => {
    if (isPointerNearControls || isPointerNearTopZone) {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
      setIsVisible(true)
      return
    }

    if (hideTimerRef.current === null) {
      hideTimerRef.current = window.setTimeout(() => {
        setIsVisible(false)
      }, CONTROLS_HIDE_DELAY_MS)
    }
  }, [isPointerNearControls, isPointerNearTopZone])

  return (
    <div className="absolute top-0 left-0 right-0 h-10 z-[9998]" style={dragRegionStyle}>
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="h-full w-full bg-[linear-gradient(to_bottom,rgba(7,10,18,0.42)_0%,rgba(7,10,18,0.2)_38%,rgba(7,10,18,0)_100%)]" />
      </div>
      <div
        ref={controlsRef}
        className={`absolute top-1.5 right-1.5 z-[9999] flex flex-row gap-1 transition-opacity duration-700 ease-out ${
          isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={noDragRegionStyle}
      >
        <button
          type="button"
          className="flex items-center justify-center w-[23px] h-4 m-0 p-0 rounded-sm text-[9px] leading-none cursor-pointer bg-[rgba(8,12,20,0.28)] text-text-secondary font-serif border border-[rgba(245,251,255,0.8)] transition-[background,color] duration-[160ms] ease-in-out hover:bg-[rgba(245,251,255,0.9)] hover:text-[rgba(15,20,32,0.95)]"
          onClick={minimize}
          aria-label="Minimize"
          style={noDragRegionStyle}
        >
          &#x2014;
        </button>
        <button
          type="button"
          className="flex items-center justify-center w-[23px] h-4 m-0 p-0 rounded-sm text-[9px] leading-none cursor-pointer bg-[rgba(8,12,20,0.28)] text-text-secondary font-serif border border-[rgba(245,251,255,0.8)] transition-[background,color] duration-[160ms] ease-in-out hover:bg-[rgba(220,50,50,0.9)] hover:text-white"
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
