/**
 * VortexHost — thin wrapper that claims the shared vortex canvas into its DOM position.
 *
 * Mount this component wherever you want the particle tunnel to appear. It claims
 * the shared canvas on mount (reparenting it into its container div) and releases
 * it on unmount. The `mode` prop controls particle density:
 * - 'portal': fewer particles (800) for the small hover preview
 * - 'loading': more particles (1320) for the full-screen loading background
 *
 * Only one VortexHost can own the canvas at a time — claiming it automatically
 * moves it away from any previous owner.
 */
import { useRef, useEffect } from 'react'
import { useVortex } from '../context/VortexContext'

type VortexHostProps = {
  mode: 'portal' | 'loading'
}

const VortexHost = ({ mode }: VortexHostProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const { claimCanvas, releaseCanvas } = useVortex()

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    claimCanvas(el, mode)
    return () => releaseCanvas()
  }, [mode, claimCanvas, releaseCanvas])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full"
      style={{ position: 'relative' }}
      aria-hidden="true"
    />
  )
}

export default VortexHost
