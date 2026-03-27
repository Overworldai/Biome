import { useEffect, useRef, type RefObject } from 'react'
import { PortalSparksRenderer } from '../lib/portalSparksRenderer'

type PortalSparksProps = {
  glowRgb: [number, number, number]
  hoverGlowRgb: [number, number, number]
  isHovered: boolean
  visible: boolean
  coreRef: RefObject<HTMLDivElement | null>
}

// The core is rotated by -8deg. We know the base (un-transformed) size from
// offsetWidth/offsetHeight, and the AABB from getBoundingClientRect(). During
// CSS transform: scale(s), offsetWidth/offsetHeight stay constant but the AABB
// shrinks. We recover the visual size by computing the current scale from the
// ratio of measured AABB to the expected AABB of the un-scaled rotated element.
const TILT_RAD = (-8 * Math.PI) / 180
const COS_TILT = Math.abs(Math.cos(TILT_RAD))
const SIN_TILT = Math.abs(Math.sin(TILT_RAD))

function measureCore(canvas: HTMLCanvasElement, core: HTMLDivElement) {
  const canvasRect = canvas.getBoundingClientRect()
  const coreRect = core.getBoundingClientRect()
  if (canvasRect.width === 0 || canvasRect.height === 0) return null

  const coreCx = coreRect.left + coreRect.width / 2 - canvasRect.left
  const coreCy = coreRect.top + coreRect.height / 2 - canvasRect.top

  // Base layout size (ignores transforms)
  const baseW = core.offsetWidth
  const baseH = core.offsetHeight

  // Expected AABB of the rotated element at scale=1
  const expectedAABBW = baseW * COS_TILT + baseH * SIN_TILT
  // Actual AABB from getBoundingClientRect (reflects transform: scale)
  const scale = expectedAABBW > 0 ? coreRect.width / expectedAABBW : 1

  const coreW = baseW * scale
  const coreH = baseH * scale

  return { coreW, coreH, coreCx, coreCy }
}

const PortalSparks = ({ glowRgb, hoverGlowRgb, isHovered, visible, coreRef }: PortalSparksProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<PortalSparksRenderer | null>(null)
  const rafRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)
  const lastCoreSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })

  // Update glow color — use portal scene color on hover, background color otherwise
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return

    const rgb = isHovered ? hoverGlowRgb : glowRgb
    renderer.setGlowColor(rgb[0], rgb[1], rgb[2])
    renderer.setIntensity(isHovered ? 1.5 : 1.0)
    renderer.setColorBoost(isHovered ? 1.0 : 0.0)
  }, [glowRgb, hoverGlowRgb, isHovered])

  // Init renderer, ResizeObserver, rAF loop
  useEffect(() => {
    if (!visible) return

    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new PortalSparksRenderer(canvas)
    rendererRef.current = renderer

    // Apply initial glow color
    const rgb = isHovered ? hoverGlowRgb : glowRgb
    renderer.setGlowColor(rgb[0], rgb[1], rgb[2])
    renderer.setIntensity(isHovered ? 1.5 : 1.0)

    // Resize handler — rebuilds backing store and edge map (shape detection)
    const syncSize = () => {
      const canvasRect = canvas.getBoundingClientRect()
      if (canvasRect.width === 0 || canvasRect.height === 0) return
      const dpr = window.devicePixelRatio || 1
      renderer.resizeCanvas(canvasRect.width, canvasRect.height, dpr)

      const core = coreRef.current
      if (core) {
        const m = measureCore(canvas, core)
        if (m) {
          renderer.updateEdgeMap(m.coreW, m.coreH, m.coreCx, m.coreCy)
          lastCoreSizeRef.current = { w: m.coreW, h: m.coreH }
        }
      }
    }

    syncSize()

    const parent = canvas.parentElement
    const ro = new ResizeObserver(syncSize)
    if (parent) ro.observe(parent)

    // Animation loop — re-measures core each frame to track bobbing and size changes
    lastTimeRef.current = 0
    const tick = (now: number) => {
      const dt = lastTimeRef.current > 0 ? (now - lastTimeRef.current) / 1000 : 0.016
      lastTimeRef.current = now

      // Track portal bobbing/hover scale by re-measuring each frame.
      // CSS transforms (like hover scale) don't trigger ResizeObserver,
      // so we must also update canvasW/canvasH from the live rect.
      const canvasRect = canvas.getBoundingClientRect()
      if (canvasRect.width > 0 && canvasRect.height > 0) {
        const dpr = window.devicePixelRatio || 1
        renderer.resizeCanvas(canvasRect.width, canvasRect.height, dpr)
      }
      const core = coreRef.current
      if (core) {
        const m = measureCore(canvas, core)
        if (m) {
          // If the core size changed (e.g. shrink animation), scale existing
          // particles to match and rebuild edge map for new spawns.
          // Only scale particles inward (shrinking), not outward (expanding)
          // to avoid a burst of particles when the portal spawns in.
          const prev = lastCoreSizeRef.current
          if (Math.abs(m.coreW - prev.w) > 1 || Math.abs(m.coreH - prev.h) > 1) {
            if (prev.w > 0 && prev.h > 0 && m.coreW < prev.w) {
              renderer.scaleParticles(m.coreW / prev.w, m.coreH / prev.h)
            }
            renderer.updateEdgeMap(m.coreW, m.coreH, m.coreCx, m.coreCy)
            lastCoreSizeRef.current = { w: m.coreW, h: m.coreH }
          } else {
            renderer.updateEdgeCenter(m.coreCx, m.coreCy)
          }
        }
      }

      renderer.render(dt)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    // Pause rAF when the page is hidden so particles freeze in place
    // instead of draining (throttled rAF would age them out).
    // Mirrors the pattern used by VortexContext.
    const handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      } else {
        lastTimeRef.current = 0
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      renderer.dispose()
      rendererRef.current = null
    }
    // Only re-init when visibility changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  if (!visible) return null

  return <canvas ref={canvasRef} className="portal-sparks-canvas" />
}

export default PortalSparks
