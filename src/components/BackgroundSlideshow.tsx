import { useEffect, useRef, type CSSProperties } from 'react'

type BackgroundSlideshowProps = {
  getVideoElement: (index: number) => HTMLVideoElement | null
  currentIndex: number
  nextIndex: number
  blurCqh: number
  isTransitioning: boolean
  transitionKey: number
  onTransitionComplete: () => void
  onInitialReady?: () => void
}

const BackgroundSlideshow = ({
  getVideoElement,
  currentIndex,
  nextIndex,
  blurCqh,
  isTransitioning,
  transitionKey,
  onTransitionComplete,
  onInitialReady
}: BackgroundSlideshowProps) => {
  const currentContainerRef = useRef<HTMLDivElement>(null)
  const transitionContainerRef = useRef<HTMLDivElement>(null)
  const hasNotifiedReadyRef = useRef(false)
  const onInitialReadyRef = useRef(onInitialReady)
  onInitialReadyRef.current = onInitialReady

  // Mount current video element
  useEffect(() => {
    const container = currentContainerRef.current
    const el = getVideoElement(currentIndex)
    if (!container || !el) return
    container.replaceChildren(el)
    el.play().catch(() => {})

    // Track readiness of the first background video for startup coordination.
    if (hasNotifiedReadyRef.current) return

    const notifyReady = () => {
      if (hasNotifiedReadyRef.current) return
      hasNotifiedReadyRef.current = true
      onInitialReadyRef.current?.()
    }

    if (el.readyState >= 2) {
      notifyReady()
    } else {
      el.addEventListener('loadeddata', notifyReady, { once: true })
      el.addEventListener('canplay', notifyReady, { once: true })
      return () => {
        el.removeEventListener('loadeddata', notifyReady)
        el.removeEventListener('canplay', notifyReady)
      }
    }
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
