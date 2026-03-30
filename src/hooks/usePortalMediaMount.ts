import { useEffect, useRef, useState } from 'react'

export function usePortalMediaMount(
  videoElement: HTMLVideoElement | null,
  onInitialPreviewReady: () => void,
  onMediaReady: () => void
) {
  const portalVideoRef = useRef<HTMLDivElement>(null)
  const hasNotifiedInitialReadyRef = useRef(false)
  const firstVideoElementRef = useRef<HTMLVideoElement | null>(null)
  const [isPortalMediaReady, setIsPortalMediaReady] = useState(false)
  const [hasHadInitialReady, setHasHadInitialReady] = useState(false)

  // Reset readiness synchronously when videoElement changes, before the render
  // completes. This prevents a flash of the portal at full size with the stale
  // ready state from the previous video.
  const [prevVideoElement, setPrevVideoElement] = useState(videoElement)
  if (prevVideoElement !== videoElement) {
    setPrevVideoElement(videoElement)
    setIsPortalMediaReady(false)
  }

  useEffect(() => {
    const container = portalVideoRef.current
    if (!container || !videoElement) return

    let cancelled = false
    // Track the first non-null video element we handle. Same element ⇒ initial
    // startup (also resilient to StrictMode double-mount with the same element).
    // Different element ⇒ scene transition.
    if (firstVideoElementRef.current === null) {
      firstVideoElementRef.current = videoElement
    }
    const isInitial = videoElement === firstVideoElementRef.current

    const markReady = () => {
      if (cancelled) return
      setIsPortalMediaReady(true)
      if (isInitial) {
        if (hasNotifiedInitialReadyRef.current) return
        hasNotifiedInitialReadyRef.current = true
        setHasHadInitialReady(true)
        onInitialPreviewReady()
      } else {
        onMediaReady()
      }
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
    }
  }, [onInitialPreviewReady, onMediaReady, videoElement])

  return {
    portalVideoRef,
    isPortalMediaReady,
    // True once the initial video has been shown — used to skip the CSS
    // opacity transition on the very first appearance so the portal is
    // instantly visible when the window opens.
    hasHadInitialReady
  }
}
