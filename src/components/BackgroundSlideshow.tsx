import { useEffect, useState, type CSSProperties } from 'react'

type BackgroundSlideshowProps = {
  images: string[]
  currentIndex: number
  nextIndex: number
  blurPx: number
  isTransitioning: boolean
  transitionKey: number
  onTransitionComplete: () => void
}

const BackgroundSlideshow = ({
  images,
  currentIndex,
  nextIndex,
  blurPx,
  isTransitioning,
  transitionKey,
  onTransitionComplete
}: BackgroundSlideshowProps) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
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

  const backgroundStyle: CSSProperties = {
    ['--app-background-blur' as string]: `${blurPx}px`,
    ['--bg-parallax-x' as string]: `${offset.x}px`,
    ['--bg-parallax-y' as string]: `${offset.y}px`
  }

  const currentImage = images[currentIndex]
  const nextImage = images[nextIndex]

  return (
    <div className="absolute inset-0 overflow-hidden -z-10 bg-darkest" style={backgroundStyle} aria-hidden="true">
      {currentImage && (
        <div
          key={`current-${currentIndex}`}
          className="app-background-slide active"
          style={{ backgroundImage: `url("${currentImage}")` }}
        />
      )}
      {isTransitioning && nextImage && (
        <div
          key={`transition-${transitionKey}`}
          className="app-background-transition-slide"
          style={{ backgroundImage: `url("${nextImage}")` }}
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
