import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { PARALLAX_ENABLED } from '../constants'

type BackgroundSlideshowProps = {
  getVideoElement: (index: number) => HTMLVideoElement | null
  currentIndex: number
  nextIndex: number
  blurPx: number
  isTransitioning: boolean
  transitionKey: number
  onTransitionComplete: () => void
}

const BackgroundSlideshow = ({
  getVideoElement,
  currentIndex,
  nextIndex,
  blurPx,
  isTransitioning,
  transitionKey,
  onTransitionComplete
}: BackgroundSlideshowProps) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const currentContainerRef = useRef<HTMLDivElement>(null)
  const transitionContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!PARALLAX_ENABLED) return

    const handleMouseMove = (event: MouseEvent) => {
      const centerX = window.innerWidth * 0.5
      const centerY = window.innerHeight * 0.5
      // Smaller range than portal parallax to keep background subtle.
      const x = ((event.clientX - centerX) / centerX) * 2.4
      const y = ((event.clientY - centerY) / centerY) * 2
      setOffset({ x, y })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Mount current video element
  useEffect(() => {
    const container = currentContainerRef.current
    const el = getVideoElement(currentIndex)
    if (!container || !el) return
    container.replaceChildren(el)
    el.play().catch(() => {})
  }, [currentIndex, getVideoElement])

  // Mount transition video element
  useEffect(() => {
    if (!isTransitioning) return
    const container = transitionContainerRef.current
    const el = getVideoElement(nextIndex)
    if (!container || !el) return
    container.replaceChildren(el)
    el.play().catch(() => {})
  }, [isTransitioning, transitionKey, nextIndex, getVideoElement])

  const backgroundStyle: CSSProperties = {
    ['--app-background-blur' as string]: `${blurPx}px`,
    ['--bg-parallax-x' as string]: `${offset.x}px`,
    ['--bg-parallax-y' as string]: `${offset.y}px`
  }

  return (
    <div className="absolute inset-0 overflow-hidden -z-10 bg-darkest" style={backgroundStyle} aria-hidden="true">
      <div ref={currentContainerRef} className="app-background-slide active" />
      {isTransitioning && (
        <div
          ref={transitionContainerRef}
          key={`transition-${transitionKey}`}
          className="app-background-transition-slide"
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.animationName === 'portalBgReveal') {
              onTransitionComplete()
            }
          }}
        />
      )}
      <div className="app-background-scrim" />
    </div>
  )
}

export default BackgroundSlideshow
