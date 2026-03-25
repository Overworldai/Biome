import { useEffect, useRef, useState } from 'react'

const DEFAULT_GLOW_RGB: [number, number, number] = [140, 206, 244]

const usePortalGlowSample = (visible: boolean, videoElement: HTMLVideoElement | null): [number, number, number] => {
  const colorSampleCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [glowRgb, setGlowRgb] = useState<[number, number, number]>(DEFAULT_GLOW_RGB)

  useEffect(() => {
    if (!visible || !videoElement) return

    const samplerCanvas = colorSampleCanvasRef.current ?? document.createElement('canvas')
    samplerCanvas.width = 16
    samplerCanvas.height = 16
    colorSampleCanvasRef.current = samplerCanvas
    const context = samplerCanvas.getContext('2d', { willReadFrequently: true })
    if (!context) return

    let cancelled = false

    const sampleOnce = () => {
      if (videoElement.readyState < 2) return

      try {
        context.clearRect(0, 0, samplerCanvas.width, samplerCanvas.height)
        context.drawImage(videoElement, 0, 0, samplerCanvas.width, samplerCanvas.height)
        const pixels = context.getImageData(0, 0, samplerCanvas.width, samplerCanvas.height).data

        let r = 0
        let g = 0
        let b = 0
        let count = 0
        let fallbackR = 0
        let fallbackG = 0
        let fallbackB = 0
        let fallbackCount = 0

        for (let i = 0; i < pixels.length; i += 4) {
          const alpha = pixels[i + 3]
          if (alpha < 8) continue

          const pr = pixels[i]
          const pg = pixels[i + 1]
          const pb = pixels[i + 2]

          fallbackR += pr
          fallbackG += pg
          fallbackB += pb
          fallbackCount += 1

          const maxChannel = Math.max(pr, pg, pb)
          const minChannel = Math.min(pr, pg, pb)
          const chroma = maxChannel - minChannel
          const saturation = maxChannel === 0 ? 0 : chroma / maxChannel
          const luminance = (maxChannel + minChannel) / 510

          if (saturation < 0.16 || luminance > 0.82) continue

          r += pr
          g += pg
          b += pb
          count += 1
        }

        if (cancelled) return

        const effectiveCount = count > 0 ? count : fallbackCount
        if (effectiveCount === 0) return

        const sourceR = count > 0 ? r : fallbackR
        const sourceG = count > 0 ? g : fallbackG
        const sourceB = count > 0 ? b : fallbackB

        const avgR = sourceR / effectiveCount
        const avgG = sourceG / effectiveCount
        const avgB = sourceB / effectiveCount

        const tunedR = Math.min(232, Math.round(avgR * 1.06))
        const tunedG = Math.min(232, Math.round(avgG * 1.06))
        const tunedB = Math.min(232, Math.round(avgB * 1.06))
        setGlowRgb([tunedR, tunedG, tunedB])
      } catch {
        // Ignore transient frame-read failures while the video is warming up.
      }
    }

    let frameId = 0
    const handleReady = () => {
      frameId = requestAnimationFrame(sampleOnce)
    }

    if (videoElement.readyState >= 2) {
      handleReady()
    } else {
      videoElement.addEventListener('loadeddata', handleReady, { once: true })
      videoElement.addEventListener('canplay', handleReady, { once: true })
    }

    return () => {
      cancelled = true
      videoElement.removeEventListener('loadeddata', handleReady)
      videoElement.removeEventListener('canplay', handleReady)
      cancelAnimationFrame(frameId)
    }
  }, [videoElement, visible])

  return glowRgb
}

export default usePortalGlowSample
