/**
 * VortexContext — shared canvas + renderer for the particle tunnel effect
 *
 * Instead of creating separate WebGL contexts for the portal preview and loading
 * screen, this context manages a single persistent `<canvas>` element and
 * `VortexRenderer` instance. Components "claim" the canvas by reparenting it into
 * their DOM subtree via `claimCanvas()`, and release it on unmount.
 *
 * This approach:
 * - Uses only one WebGL context (avoids GPU resource waste)
 * - Preserves particle state across transitions (portal → loading is seamless)
 * - Handles resize correctly after reparenting (size cache is reset on claim,
 *   and a ResizeObserver + per-frame check ensures the canvas adapts to its
 *   new container dimensions)
 * - Pauses the rAF loop when no component owns the canvas or the tab is hidden
 */
import { createContext, useContext, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { VortexRenderer, VORTEX_PORTAL_COUNT, VORTEX_LOADING_COUNT } from '../lib/vortexRenderer'

type VortexMode = 'portal' | 'loading'

const PARTICLE_COUNTS: Record<VortexMode, number> = {
  portal: VORTEX_PORTAL_COUNT,
  loading: VORTEX_LOADING_COUNT
}

type VortexContextValue = {
  claimCanvas: (container: HTMLElement, mode: VortexMode) => void
  releaseCanvas: () => void
}

const VortexContext = createContext<VortexContextValue | null>(null)

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export function VortexProvider({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<VortexRenderer | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number>(0)
  const ownerRef = useRef<HTMLElement | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'
    canvasRef.current = canvas

    const renderer = new VortexRenderer(canvas)
    rendererRef.current = renderer

    const handleVisibility = () => {
      if (document.hidden) {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
      } else if (ownerRef.current && rafRef.current == null) {
        lastTimeRef.current = 0
        rafRef.current = requestAnimationFrame(frame)
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      resizeObserverRef.current?.disconnect()
      renderer.dispose()
    }
  }, [])

  const lastSizeRef = useRef({ w: 0, h: 0 })

  const syncSize = useCallback(() => {
    const canvas = canvasRef.current
    const renderer = rendererRef.current
    const owner = ownerRef.current
    if (!canvas || !renderer || !owner) return

    const rect = owner.getBoundingClientRect()
    const w = Math.max(1, Math.floor(rect.width))
    const h = Math.max(1, Math.floor(rect.height))
    if (w === lastSizeRef.current.w && h === lastSizeRef.current.h) return
    lastSizeRef.current = { w, h }
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2)
    renderer.resize(w, h, dpr)
  }, [])

  const frame = useCallback(
    (now: number) => {
      const renderer = rendererRef.current
      if (!renderer || !ownerRef.current) return

      const dt = lastTimeRef.current > 0 ? (now - lastTimeRef.current) / 1000 : 0.016
      lastTimeRef.current = now

      syncSize()

      renderer.render(dt)
      rafRef.current = requestAnimationFrame(frame)
    },
    [syncSize]
  )

  const claimCanvas = useCallback(
    (container: HTMLElement, mode: VortexMode) => {
      const canvas = canvasRef.current
      const renderer = rendererRef.current
      if (!canvas || !renderer) return

      ownerRef.current = container
      container.appendChild(canvas)

      renderer.setTargetCount(PARTICLE_COUNTS[mode])
      lastSizeRef.current = { w: 0, h: 0 }

      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = new ResizeObserver(() => syncSize())
      resizeObserverRef.current.observe(container)
      syncSize()

      if (rafRef.current == null && !document.hidden) {
        lastTimeRef.current = 0
        rafRef.current = requestAnimationFrame(frame)
      }
    },
    [syncSize, frame]
  )

  const releaseCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (canvas?.parentNode) {
      canvas.parentNode.removeChild(canvas)
    }
    ownerRef.current = null
    resizeObserverRef.current?.disconnect()

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  return <VortexContext.Provider value={{ claimCanvas, releaseCanvas }}>{children}</VortexContext.Provider>
}

export function useVortex() {
  const ctx = useContext(VortexContext)
  if (!ctx) throw new Error('useVortex must be used within VortexProvider')
  return ctx
}
