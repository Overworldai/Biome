import { useEffect, useState, type CSSProperties } from 'react'
import { PARALLAX_ENABLED } from '../constants'

type PortalPreviewProps = {
  image: string | null
  hoverImage?: string | null
  isHovered?: boolean
  visible: boolean
  isShrinking: boolean
  isEntering: boolean
  isSettingsOpen?: boolean
  glowRgb: string
  onHoverChange: (hovered: boolean) => void
  onClick: () => void
  onShrinkComplete: () => void
}

const PortalPreview = ({
  image,
  hoverImage = null,
  isHovered = false,
  visible,
  isShrinking,
  isEntering,
  isSettingsOpen = false,
  glowRgb,
  onHoverChange,
  onClick,
  onShrinkComplete
}: PortalPreviewProps) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!PARALLAX_ENABLED) return

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

  if (!visible || (!image && !hoverImage)) return null

  const portalStyle: CSSProperties = {
    ['--portal-offset-x' as string]: `${offset.x}px`,
    ['--portal-offset-y' as string]: `${offset.y}px`,
    ['--portal-glow-rgb' as string]: glowRgb
  }

  return (
    <div
      className={`portal-preview absolute top-1/2 z-8 w-[22cqw] h-[27cqw] max-w-[200px] max-h-[250px] cursor-pointer ${isEntering ? 'entering' : ''} ${isShrinking ? 'shrinking' : ''} ${isSettingsOpen ? 'left-[20%] blur-[4px] saturate-[0.86] pointer-events-none' : 'left-1/2 pointer-events-auto'}`}
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
      <div className="portal-preview-shell absolute inset-0 isolate p-[9%]">
        <div
          className="portal-preview-core relative w-full h-full overflow-hidden z-1"
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.animationName === 'portalCorePreShrink') {
              onShrinkComplete()
            }
          }}
        >
          {image && (
            <div
              className={`portal-preview-image absolute rounded-[inherit] origin-center ${isHovered && hoverImage ? 'opacity-0' : 'opacity-100'}`}
              style={{ backgroundImage: `url("${image}")` }}
            />
          )}
          {hoverImage && (
            <div
              className={`portal-preview-image absolute rounded-[inherit] origin-center ${isHovered ? 'opacity-100' : 'opacity-0'}`}
              style={{ backgroundImage: `url("${hoverImage}")` }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default PortalPreview
