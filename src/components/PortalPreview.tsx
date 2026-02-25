import { useEffect, useState, type CSSProperties } from 'react'

type PortalPreviewProps = {
  image: string | null
  visible: boolean
  isShrinking: boolean
  isEntering: boolean
  glowRgb: string
  onHoverChange: (hovered: boolean) => void
  onClick: () => void
  onShrinkComplete: () => void
}

const PortalPreview = ({
  image,
  visible,
  isShrinking,
  isEntering,
  glowRgb,
  onHoverChange,
  onClick,
  onShrinkComplete
}: PortalPreviewProps) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const centerX = window.innerWidth * 0.5
      const centerY = window.innerHeight * 0.5
      const x = ((event.clientX - centerX) / centerX) * 7
      const y = ((event.clientY - centerY) / centerY) * 6
      setOffset({ x, y })
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  if (!visible || !image) return null

  const portalStyle: CSSProperties = {
    ['--portal-offset-x' as string]: `${offset.x}px`,
    ['--portal-offset-y' as string]: `${offset.y}px`,
    ['--portal-glow-rgb' as string]: glowRgb
  }

  return (
    <div
      className={`portal-preview ${isEntering ? 'entering' : ''} ${isShrinking ? 'shrinking' : ''}`}
      style={portalStyle}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label="Portal preview"
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
    >
      <div className="portal-preview-shell">
        <div
          className="portal-preview-core"
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.animationName === 'portalCorePreShrink') {
              onShrinkComplete()
            }
          }}
        >
          <div className="portal-preview-image" style={{ backgroundImage: `url("${image}")` }} />
        </div>
      </div>
    </div>
  )
}

export default PortalPreview
