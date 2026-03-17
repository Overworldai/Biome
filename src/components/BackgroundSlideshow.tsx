import { useEffect, useRef, type CSSProperties } from 'react'

type BackgroundSlideshowProps = {
  getVideoElement: (index: number) => HTMLVideoElement | null
  currentIndex: number
  nextIndex: number
  blurCqh: number
  isTransitioning: boolean
  transitionKey: number
  onTransitionComplete: () => void
}

const BackgroundSlideshow = ({
  getVideoElement,
  currentIndex,
  nextIndex,
  blurCqh,
  isTransitioning,
  transitionKey,
  onTransitionComplete
}: BackgroundSlideshowProps) => {
  const currentContainerRef = useRef<HTMLDivElement>(null)
  const transitionContainerRef = useRef<HTMLDivElement>(null)

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
    ['--app-background-blur' as string]: `${blurCqh}cqh`
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
