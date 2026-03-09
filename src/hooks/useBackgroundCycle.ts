import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../bridge'

const CYCLE_INTERVAL_MS = 5000
const PORTAL_ENTER_DURATION_MS = 700
const PORTAL_PRE_SHRINK_FAILSAFE_MS = 700
const TRANSITION_VISIBLE_MS = 100
const TRANSITION_FAILSAFE_MS = 1400

type BackgroundCycleState = {
  videos: string[]
  getVideoElement: (index: number) => HTMLVideoElement | null
  currentIndex: number
  nextIndex: number
  isTransitioning: boolean
  isPortalShrinking: boolean
  transitionKey: number
  portalVisible: boolean
  isPortalEntering: boolean
  triggerPortalEnter: () => void
  completePortalShrink: () => void
  completeTransition: () => void
}

export const useBackgroundCycle = (pauseTransitions = false): BackgroundCycleState => {
  const [videos, setVideos] = useState<string[]>([])
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isPortalShrinking, setIsPortalShrinking] = useState(false)
  const [transitionKey, setTransitionKey] = useState(0)
  const [portalVisible, setPortalVisible] = useState(true)
  const [isPortalEntering, setIsPortalEntering] = useState(false)

  const getVideoElement = useCallback(
    (index: number): HTMLVideoElement | null => {
      const url = videos[index]
      return url ? (videoElementsRef.current.get(url) ?? null) : null
    },
    [videos]
  )

  const completePortalShrink = useCallback(() => {
    if (!isPortalShrinking || isTransitioning) return
    setPortalVisible(false)
    setIsPortalShrinking(false)
    setIsTransitioning(true)
  }, [isPortalShrinking, isTransitioning])

  const completeTransition = useCallback(() => {
    if (!isTransitioning) return
    setCurrentIndex((prev) => (prev + 1) % (videos.length || 1))
    setIsTransitioning(false)
    setPortalVisible(true)
    setIsPortalEntering(true)
  }, [videos.length, isTransitioning])

  const triggerPortalEnter = useCallback(() => {
    setPortalVisible(true)
    setIsPortalEntering(true)
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const filenames = await invoke('list-background-videos')
        if (filenames.length === 0 || cancelled) return

        const urls = filenames.map((filename) => `biome-bg://serve/${filename}`)
        const elements = new Map<string, HTMLVideoElement>()

        for (const url of urls) {
          const el = document.createElement('video')
          el.src = url
          el.autoplay = true
          el.loop = true
          el.muted = true
          el.playsInline = true
          el.preload = 'auto'
          el.style.width = '100%'
          el.style.height = '100%'
          el.style.objectFit = 'cover'
          el.load()
          elements.set(url, el)
        }

        videoElementsRef.current = elements

        if (!cancelled) {
          setVideos(urls)
          setCurrentIndex(0)
          setPortalVisible(true)
          setIsPortalEntering(true)
        }
      } catch (err) {
        console.error('Failed to load background videos:', err)
      }
    }

    load()

    return () => {
      cancelled = true
      for (const el of videoElementsRef.current.values()) {
        el.pause()
        el.src = ''
      }
      videoElementsRef.current.clear()
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
      videos.length < 2 ||
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
  }, [videos, isTransitioning, isPortalShrinking, isPortalEntering, portalVisible, pauseTransitions])

  useEffect(() => {
    if (!isPortalShrinking) return

    // Failsafe in case shrink animationend doesn't fire.
    const timer = window.setTimeout(() => {
      completePortalShrink()
    }, PORTAL_PRE_SHRINK_FAILSAFE_MS)

    return () => window.clearTimeout(timer)
  }, [isPortalShrinking, completePortalShrink])

  useEffect(() => {
    if (!isTransitioning || videos.length < 2) return

    // Complete once the reveal is visually complete.
    const visibleTimer = window.setTimeout(() => {
      completeTransition()
    }, TRANSITION_VISIBLE_MS)

    // Failsafe in case animationend doesn't fire (tab/background/browser edge cases).
    const failsafeTimer = window.setTimeout(() => {
      completeTransition()
    }, TRANSITION_FAILSAFE_MS)

    return () => {
      window.clearTimeout(visibleTimer)
      window.clearTimeout(failsafeTimer)
    }
  }, [isTransitioning, videos, completeTransition])

  const nextIndex = videos.length > 1 ? (currentIndex + 1) % videos.length : 0

  return {
    videos,
    getVideoElement,
    currentIndex,
    nextIndex,
    isTransitioning,
    isPortalShrinking,
    transitionKey,
    portalVisible,
    isPortalEntering,
    triggerPortalEnter,
    completePortalShrink,
    completeTransition
  }
}

export default useBackgroundCycle
