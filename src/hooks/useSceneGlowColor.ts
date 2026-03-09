import { useEffect, useState } from 'react'

const DEFAULT_GLOW_RGB: [number, number, number] = [140, 206, 244]

const useSceneGlowColor = (
  getVideoElement: (index: number) => HTMLVideoElement | null,
  index: number
): [number, number, number] => {
  const [glowRgb, setGlowRgb] = useState<[number, number, number]>(DEFAULT_GLOW_RGB)

  useEffect(() => {
    const video = getVideoElement(index)
    if (!video) return

    let cancelled = false

    const sampleColor = () => {
      if (cancelled) return

      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 32
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return

      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)

      let weightedR = 0
      let weightedG = 0
      let weightedB = 0
      let weightTotal = 0

      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] / 255
        if (alpha <= 0) continue

        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]

        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const saturation = max === 0 ? 0 : (max - min) / max
        const luminance = (r + g + b) / 765
        const weight = alpha * (0.3 + saturation * 0.7) * (0.35 + luminance * 0.65)

        weightedR += r * weight
        weightedG += g * weight
        weightedB += b * weight
        weightTotal += weight
      }

      if (weightTotal <= 0) return

      const avgR = weightedR / weightTotal
      const avgG = weightedG / weightTotal
      const avgB = weightedB / weightTotal

      const glowR = Math.round(Math.min(255, avgR * 0.78 + 255 * 0.22))
      const glowG = Math.round(Math.min(255, avgG * 0.78 + 255 * 0.22))
      const glowB = Math.round(Math.min(255, avgB * 0.78 + 255 * 0.22))

      setGlowRgb([glowR, glowG, glowB])
    }

    if (video.readyState >= 2) {
      sampleColor()
    } else {
      video.addEventListener('loadeddata', sampleColor, { once: true })
      return () => {
        cancelled = true
        video.removeEventListener('loadeddata', sampleColor)
      }
    }

    return () => {
      cancelled = true
    }
  }, [getVideoElement, index])

  return glowRgb
}

export default useSceneGlowColor
