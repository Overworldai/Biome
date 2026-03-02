import { useEffect, useRef, type RefObject } from 'react'
import { PortalSparksRenderer } from '../lib/portalSparksRenderer'

type PortalSparksProps = {
  glowRgb: string
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

const PortalSparks = ({ glowRgb, isHovered, visible, coreRef }: PortalSparksProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<PortalSparksRenderer | null>(null)
  const rafRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)
  const lastCoreSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })

  // Parse glowRgb and update renderer
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return

    const parts = glowRgb.split(',').map((s) => parseFloat(s.trim()))
    if (parts.length >= 3 && parts.every((n) => !isNaN(n))) {
      renderer.setGlowColor(parts[0], parts[1], parts[2])
    }
  }, [glowRgb])

  // Update intensity on hover/entering
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.setIntensity(isHovered ? 1.5 : 1.0)
  }, [isHovered])

  // Init renderer, ResizeObserver, rAF loop
  useEffect(() => {
    if (!visible) return

    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new PortalSparksRenderer(canvas)
    rendererRef.current = renderer

    // Apply initial glow color
    const parts = glowRgb.split(',').map((s) => parseFloat(s.trim()))
    if (parts.length >= 3 && parts.every((n) => !isNaN(n))) {
      renderer.setGlowColor(parts[0], parts[1], parts[2])
    }
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
    lastTimeRef.current = performance.now()
    const tick = (now: number) => {
      const dt = (now - lastTimeRef.current) / 1000
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

    return () => {
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
