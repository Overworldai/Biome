import { useRef, type CSSProperties, type ReactNode } from 'react'
import { usePortalMediaMount } from '../hooks/usePortalMediaMount'
import PortalSparks from './PortalSparks'
import { PORTAL_ENTER_DURATION_MS, PORTAL_SHRINK_DURATION_MS, PORTAL_SHRINK_END_SCALE } from '../lib/portalAnimation'

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
  sparkGlowRgb: [number, number, number]
  /** Override the CSS shrink-animation duration. Defaults to
   *  `PORTAL_SHRINK_DURATION_MS` (the main-menu background-cycle value).
   *  Callers use the override for faster externally-driven closes (e.g. the
   *  Settings panel's `PORTAL_SHRINK_FAST_DURATION_MS`). */
  shrinkDurationMs?: number
  onShrinkComplete: () => void
  onInitialPreviewReady: () => void
  onMediaReady: () => void
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
  sparkGlowRgb,
  shrinkDurationMs,
  onShrinkComplete,
  onInitialPreviewReady,
  onMediaReady
}: PortalPreviewProps) => {
  const coreRef = useRef<HTMLDivElement>(null)
  const { portalVideoRef, isPortalMediaReady, hasHadInitialReady } = usePortalMediaMount(
    videoElement,
    onInitialPreviewReady,
    onMediaReady
  )

  if (!visible || (!videoElement && !hoverContent)) return null

  // CSS vars that app.css' portal-preview rules read. Values come from
  // `lib/portalAnimation.ts`, which is the single source of truth for all
  // portal timings and target states. The CSS fallbacks in app.css mirror
  // these defaults as a safety net only.
  const portalStyle: CSSProperties = {
    ['--portal-glow-rgb' as string]: glowRgb.join(', '),
    ['--portal-border-rgb' as string]: glowRgb.join(', '),
    ['--portal-enter-duration-ms' as string]: String(PORTAL_ENTER_DURATION_MS),
    ['--portal-shrink-duration' as string]: `${shrinkDurationMs ?? PORTAL_SHRINK_DURATION_MS}ms`,
    ['--portal-shrink-end-scale' as string]: String(PORTAL_SHRINK_END_SCALE),
    opacity: isPortalMediaReady ? 1 : 0,
    visibility: isPortalMediaReady ? 'visible' : 'hidden',
    // Skip the CSS opacity transition for the very first appearance so the
    // portal is fully visible the instant the window opens.
    ...(!hasHadInitialReady && { transition: 'none' })
  }

  return (
    <div
      className={`
        portal-preview absolute inset-0
        ${isHovered ? 'hovered' : ''}
        ${isEntering ? 'entering' : ''}
        ${isShrinking ? 'shrinking' : ''}
        ${isSettingsOpen ? 'blur-[0.56cqh] saturate-[0.86]' : ''}
      `}
      style={portalStyle}
    >
      <div className="portal-preview-frame-shell absolute inset-0 p-[9%]">
        <div className="relative size-full overflow-visible">
          <div className="portal-preview-core-ring-fade portal-preview-core-ring-fade-1 absolute" />
          <div className="portal-preview-core-ring-fade portal-preview-core-ring-fade-2 absolute" />
        </div>
      </div>
      <div className="portal-preview-shell absolute inset-0 p-[9%]">
        <div className="portal-preview-halo-layer absolute" />
        <div
          ref={coreRef}
          className="portal-preview-core relative z-1 size-full overflow-hidden"
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.animationName === 'portalCorePreShrink') {
              onShrinkComplete()
            }
          }}
        >
          <div className="portal-preview-core-overlay absolute inset-0" />
          <div className="portal-preview-core-ring absolute" />
          {videoElement && (
            <div className="portal-preview-media-rotate absolute inset-0 rounded-[inherit]">
              <div ref={portalVideoRef} className="portal-preview-image absolute origin-center rounded-[inherit]" />
            </div>
          )}
          {hoverContent && (
            <div
              className={`
                pointer-events-none absolute inset-0 z-1 rounded-[inherit] transition-opacity duration-400
                ${isHovered ? 'opacity-90' : 'opacity-0'}
              `}
            >
              {hoverContent}
            </div>
          )}
        </div>
      </div>
      <PortalSparks
        glowRgb={sparkGlowRgb}
        hoverGlowRgb={portalSceneGlowRgb}
        isHovered={isHovered}
        visible={true}
        coreRef={coreRef}
      />
    </div>
  )
}

export default PortalPreview
