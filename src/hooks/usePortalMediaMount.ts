import { useEffect, useRef, useState } from 'react'

export function usePortalMediaMount(videoElement: HTMLVideoElement | null, onInitialPreviewReady: () => void) {
  const portalVideoRef = useRef<HTMLDivElement>(null)
  const hasNotifiedInitialReadyRef = useRef(false)
  const [isPortalMediaReady, setIsPortalMediaReady] = useState(false)

  useEffect(() => {
    const container = portalVideoRef.current
    if (!container || !videoElement) return

    let cancelled = false

    const markReady = () => {
      if (cancelled) return
      setIsPortalMediaReady(true)
      if (hasNotifiedInitialReadyRef.current) return
      hasNotifiedInitialReadyRef.current = true
      onInitialPreviewReady()
    }

    container.replaceChildren(videoElement)
    videoElement.play().catch(() => {})

    if (videoElement.readyState >= 2) {
      markReady()
    } else {
      videoElement.addEventListener('loadeddata', markReady, { once: true })
      videoElement.addEventListener('canplay', markReady, { once: true })
    }

    return () => {
      cancelled = true
      videoElement.removeEventListener('loadeddata', markReady)
      videoElement.removeEventListener('canplay', markReady)
      setIsPortalMediaReady(false)
    }
  }, [onInitialPreviewReady, videoElement])

  return {
    portalVideoRef,
    isPortalMediaReady
  }
}
