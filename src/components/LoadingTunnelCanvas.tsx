import { useEffect, useRef } from 'react'
import { invoke } from '../bridge'

type QualityMode = 'auto' | 'high' | 'medium' | 'low'

type LoadingTunnelCanvasProps = {
  intensity?: number
  qualityMode?: QualityMode
  mouseReactive?: boolean
  baseImageSrc?: string | null
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const LoadingTunnelCanvas = ({
  intensity = 1,
  qualityMode: _qualityMode = 'auto',
  mouseReactive = true,
  baseImageSrc = null
}: LoadingTunnelCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const resizeRef = useRef<ResizeObserver | null>(null)
  const centerRef = useRef({ x: 0, y: 0 })
  const targetRef = useRef({ x: 0, y: 0 })
  const mouseRef = useRef({ nx: 0, ny: 0 })
  const visibleRef = useRef(true)
  const baseImageRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    let cancelled = false

    const setImageFromSrc = (src: string) => {
      const image = new Image()
      image.src = src
      image.onload = () => {
        if (!cancelled) {
          baseImageRef.current = image
        }
      }
    }

    const loadBaseImage = async () => {
      if (baseImageSrc) {
        setImageFromSrc(baseImageSrc)
        return
      }

      try {
        const base64 = await invoke('read-loading-tunnel-as-base64')
        if (cancelled || !base64) return
        setImageFromSrc(`data:image/png;base64,${base64}`)
      } catch {
        baseImageRef.current = null
      }
    }

    loadBaseImage()
    return () => {
      cancelled = true
    }
  }, [baseImageSrc])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const syncSize = () => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.floor(rect.width))
      const height = Math.max(1, Math.floor(rect.height))
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      centerRef.current = { x: width * 0.5, y: height * 0.5 }
      targetRef.current = { ...centerRef.current }
      return { ctx, width, height }
    }

    let state = syncSize()
    if (!state) return

    const draw = () => {
      if (!state) return
      const { ctx, width, height } = state

      const mx = mouseReactive ? mouseRef.current.nx : 0
      const my = mouseReactive ? mouseRef.current.ny : 0
      const maxOffsetX = width * 0.08
      const maxOffsetY = height * 0.07
      targetRef.current.x = width * 0.5 + mx * maxOffsetX
      targetRef.current.y = height * 0.5 + my * maxOffsetY

      const lerp = clamp(0.06 + intensity * 0.03, 0.06, 0.14)
      centerRef.current.x += (targetRef.current.x - centerRef.current.x) * lerp
      centerRef.current.y += (targetRef.current.y - centerRef.current.y) * lerp

      const vx = centerRef.current.x
      const vy = centerRef.current.y

      ctx.clearRect(0, 0, width, height)

      const baseImage = baseImageRef.current
      if (baseImage) {
        const imageMotionX = (vx - width * 0.5) * 0.08
        const imageMotionY = (vy - height * 0.5) * 0.08
        const bleed = Math.max(width, height) * 0.06
        ctx.drawImage(baseImage, -bleed + imageMotionX, -bleed + imageMotionY, width + bleed * 2, height + bleed * 2)
      } else {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, width, height)
      }
    }

    const frame = () => {
      if (!visibleRef.current) return
      draw()
      rafRef.current = window.requestAnimationFrame(frame)
    }

    const handleMouseMove = (event: MouseEvent) => {
      const nx = (event.clientX / window.innerWidth - 0.5) * 2
      const ny = (event.clientY / window.innerHeight - 0.5) * 2
      mouseRef.current = { nx: clamp(nx, -1, 1), ny: clamp(ny, -1, 1) }
    }

    const handleVisibility = () => {
      visibleRef.current = !document.hidden
      if (!visibleRef.current && rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      } else if (visibleRef.current && rafRef.current == null) {
        rafRef.current = window.requestAnimationFrame(frame)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('visibilitychange', handleVisibility)

    resizeRef.current = new ResizeObserver(() => {
      state = syncSize()
    })
    resizeRef.current.observe(canvas)

    rafRef.current = window.requestAnimationFrame(frame)

    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current)
      }
      if (resizeRef.current) {
        resizeRef.current.disconnect()
      }
      window.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [intensity, mouseReactive])

  return (
    <div className="absolute inset-0 z-[7] pointer-events-none blur-[2px] scale-[1.02] origin-center" aria-hidden="true">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
    </div>
  )
}

export default LoadingTunnelCanvas
