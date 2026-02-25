import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../bridge'

const CYCLE_INTERVAL_MS = 5000
const PORTAL_ENTER_DURATION_MS = 700
const PORTAL_PRE_SHRINK_FAILSAFE_MS = 700
const POST_TRANSITION_DWELL_MS = 180
const TRANSITION_FAILSAFE_MS = 1400

const getMimeType = (filename: string): string => {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}

type BackgroundCycleState = {
  images: string[]
  currentIndex: number
  nextIndex: number
  isTransitioning: boolean
  isPortalShrinking: boolean
  transitionKey: number
  portalVisible: boolean
  isPortalEntering: boolean
  completePortalShrink: () => void
  completeTransition: () => void
}

export const useBackgroundCycle = (pauseTransitions = false): BackgroundCycleState => {
  const [images, setImages] = useState<string[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isPortalShrinking, setIsPortalShrinking] = useState(false)
  const [transitionKey, setTransitionKey] = useState(0)
  const [portalVisible, setPortalVisible] = useState(true)
  const [isPortalEntering, setIsPortalEntering] = useState(false)
  const [pendingPortalRespawn, setPendingPortalRespawn] = useState(false)

  const completePortalShrink = useCallback(() => {
    if (!isPortalShrinking || isTransitioning) return
    setPortalVisible(false)
    setIsPortalShrinking(false)
    setIsTransitioning(true)
  }, [isPortalShrinking, isTransitioning])

  const completeTransition = useCallback(() => {
    if (!isTransitioning) return
    setCurrentIndex((prev) => (prev + 1) % (images.length || 1))
    setIsTransitioning(false)
    setPendingPortalRespawn(true)
  }, [images.length, isTransitioning])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const filenames = await invoke('list-background-images')
        if (filenames.length === 0 || cancelled) return

        const loaded = await Promise.all(
          filenames.map(async (filename) => {
            const base64 = await invoke('read-background-image-as-base64', filename)
            const mime = getMimeType(filename)
            return `data:${mime};base64,${base64}`
          })
        )

        if (!cancelled) {
          setImages(loaded)
          setCurrentIndex(0)
          setPortalVisible(true)
          setIsPortalEntering(true)
        }
      } catch (err) {
        console.error('Failed to load background images:', err)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isPortalEntering) return

    const timer = window.setTimeout(() => {
      setIsPortalEntering(false)
    }, PORTAL_ENTER_DURATION_MS)

    return () => window.clearTimeout(timer)
  }, [isPortalEntering])

  useEffect(() => {
    if (
      images.length < 2 ||
      isTransitioning ||
      isPortalShrinking ||
      isPortalEntering ||
      !portalVisible ||
      pauseTransitions
    )
      return

    const timer = window.setInterval(() => {
      setTransitionKey((k) => k + 1)
      setIsPortalShrinking(true)
    }, CYCLE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [images, isTransitioning, isPortalShrinking, isPortalEntering, portalVisible, pauseTransitions])

  useEffect(() => {
    if (!isPortalShrinking) return

    // Failsafe in case shrink animationend doesn't fire.
    const timer = window.setTimeout(() => {
      completePortalShrink()
    }, PORTAL_PRE_SHRINK_FAILSAFE_MS)

    return () => window.clearTimeout(timer)
  }, [isPortalShrinking, completePortalShrink])

  useEffect(() => {
    if (!isTransitioning || images.length < 2) return

    // Failsafe in case animationend doesn't fire (tab/background/browser edge cases).
    const failsafeTimer = window.setTimeout(() => {
      completeTransition()
    }, TRANSITION_FAILSAFE_MS)

    return () => {
      window.clearTimeout(failsafeTimer)
    }
  }, [isTransitioning, images, completeTransition])

  useEffect(() => {
    if (!pendingPortalRespawn) return

    const timer = window.setTimeout(() => {
      setPortalVisible(true)
      setIsPortalEntering(true)
      setPendingPortalRespawn(false)
    }, POST_TRANSITION_DWELL_MS)

    return () => window.clearTimeout(timer)
  }, [pendingPortalRespawn])

  const nextIndex = images.length > 1 ? (currentIndex + 1) % images.length : 0

  return {
    images,
    currentIndex,
    nextIndex,
    isTransitioning,
    isPortalShrinking,
    transitionKey,
    portalVisible,
    isPortalEntering,
    completePortalShrink,
    completeTransition
  }
}

export default useBackgroundCycle
