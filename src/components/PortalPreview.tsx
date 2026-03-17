import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import PortalSparks from './PortalSparks'

type PortalPreviewProps = {
  videoElement: HTMLVideoElement | null
  hoverContent?: ReactNode
  isHovered?: boolean
  visible: boolean
  isShrinking: boolean
  isEntering: boolean
  isSettingsOpen?: boolean
  glowRgb: [number, number, number]
  portalSceneGlowRgb: [number, number, number]
  onShrinkComplete: () => void
}

const PortalPreview = ({
  videoElement,
  hoverContent = null,
  isHovered = false,
  visible,
  isShrinking,
  isEntering,
  isSettingsOpen = false,
  glowRgb,
  portalSceneGlowRgb,
  onShrinkComplete
}: PortalPreviewProps) => {
  const coreRef = useRef<HTMLDivElement>(null)
  const portalVideoRef = useRef<HTMLDivElement>(null)

  // Mount the shared video element into the portal container
  useEffect(() => {
    const container = portalVideoRef.current
    if (!container || !videoElement) return
    container.replaceChildren(videoElement)
    videoElement.play().catch(() => {})
  }, [videoElement])

  if (!visible || (!videoElement && !hoverContent)) return null

  const portalStyle: CSSProperties = {
    ['--portal-glow-rgb' as string]: glowRgb.join(', ')
  }

  return (
    <div
      className={`portal-preview absolute inset-0 ${isHovered ? 'hovered' : ''} ${isEntering ? 'entering' : ''} ${isShrinking ? 'shrinking' : ''} ${isSettingsOpen ? 'blur-[0.56cqh] saturate-[0.86]' : ''}`}
      style={portalStyle}
    >
      <div className="portal-preview-shell absolute inset-0 isolate z-[2] p-[9%] pb-[2%]">
        <div
          ref={coreRef}
          className="portal-preview-core relative w-full h-full overflow-hidden z-1"
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.animationName === 'portalCorePreShrink') {
              onShrinkComplete()
            }
          }}
        >
          {videoElement && (
            <div
              ref={portalVideoRef}
              className="portal-preview-image absolute rounded-[inherit] origin-center opacity-100"
            />
          )}
          {hoverContent && (
            <div
              className={`absolute inset-0 rounded-[inherit] transition-opacity duration-400 ${isHovered ? 'opacity-90' : 'opacity-0'}`}
            >
              {hoverContent}
            </div>
          )}
        </div>
      </div>
      <PortalSparks
        glowRgb={glowRgb}
        hoverGlowRgb={portalSceneGlowRgb}
        isHovered={isHovered}
        visible={true}
        coreRef={coreRef}
      />
    </div>
  )
}

export default PortalPreview
