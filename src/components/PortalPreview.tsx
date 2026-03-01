import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { PARALLAX_ENABLED } from '../constants'

type PortalPreviewProps = {
  image: string | null
  hoverContent?: ReactNode
  isHovered?: boolean
  visible: boolean
  isShrinking: boolean
  isEntering: boolean
  isSettingsOpen?: boolean
  glowRgb: string
  onShrinkComplete: () => void
}

const PortalPreview = ({
  image,
  hoverContent = null,
  isHovered = false,
  visible,
  isShrinking,
  isEntering,
  isSettingsOpen = false,
  glowRgb,
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

  if (!visible || (!image && !hoverContent)) return null

  const portalStyle: CSSProperties = {
    ['--portal-offset-x' as string]: `${offset.x}px`,
    ['--portal-offset-y' as string]: `${offset.y}px`,
    ['--portal-glow-rgb' as string]: glowRgb
  }

  return (
    <div
      className={`portal-preview absolute inset-0 ${isHovered ? 'hovered' : ''} ${isEntering ? 'entering' : ''} ${isShrinking ? 'shrinking' : ''} ${isSettingsOpen ? 'blur-[4px] saturate-[0.86]' : ''}`}
      style={portalStyle}
    >
      <div className="portal-preview-shell absolute inset-0 isolate p-[9%] pb-[2%]">
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
              className="portal-preview-image absolute rounded-[inherit] origin-center opacity-100"
              style={{ backgroundImage: `url("${image}")` }}
            />
          )}
          {/* Vortex overlay: rendered at 70% opacity on hover so the scene image
              darkens underneath the additive-blended streaks. The vortex canvas is
              physically reparented here by VortexHost when this component mounts. */}
          {hoverContent && (
            <div
              className={`absolute inset-0 rounded-[inherit] transition-opacity duration-200 ${isHovered ? 'opacity-70' : 'opacity-0'}`}
            >
              {hoverContent}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default PortalPreview
