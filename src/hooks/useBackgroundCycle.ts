import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../bridge'
import { SPARK_DEBUG } from '../lib/sparkDebug'
import {
  PORTAL_BG_REVEAL_DURATION_MS,
  PORTAL_ENTER_DURATION_MS,
  PORTAL_SHRINK_DURATION_MS,
  PORTAL_SHRINK_FAILSAFE_BUFFER_MS
} from '../lib/portalAnimation'

const CYCLE_INTERVAL_MS = 5000
const PORTAL_PRE_SHRINK_FAILSAFE_MS = PORTAL_SHRINK_DURATION_MS + PORTAL_SHRINK_FAILSAFE_BUFFER_MS
const TRANSITION_FAILSAFE_MS = PORTAL_BG_REVEAL_DURATION_MS + PORTAL_SHRINK_FAILSAFE_BUFFER_MS

type BackgroundCycleState = {
  videos: string[]
  /** Video element for the fullscreen background slideshow + transition slide. */
  getBackgroundVideoElement: (index: number) => HTMLVideoElement | null
  /** Video element for the portal preview. A separate instance so that the
   *  portal and the bg transition slide can simultaneously mount the same
   *  URL during a cycle (moving a single element via `replaceChildren`
   *  between two containers rips it out of whichever mounted it first). */
  getPortalVideoElement: (index: number) => HTMLVideoElement | null
  /** Index of the bg-active video (advances at `completeTransition`). */
  currentIndex: number
  /** Index of the bg transition slide's target video (= currentIndex + 1). */
  nextIndex: number
  /** Index of the video displayed inside the portal. Advances at
   *  `completePortalShrink` so the portal respawn animation visually grows
   *  the NEW next-scene up (rather than swapping at the end of the enter). */
  portalIndex: number
  isTransitioning: boolean
  isPortalShrinking: boolean
  transitionKey: number
  portalVisible: boolean
  isPortalEntering: boolean
  triggerPortalEnter: () => void
  completePortalShrink: () => void
  completeTransition: () => void
}

const createVideoElement = (url: string): HTMLVideoElement => {
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
  return el
}

export const useBackgroundCycle = (pauseTransitions = false): BackgroundCycleState => {
  const [videos, setVideos] = useState<string[]>([])
  const backgroundVideoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const portalVideoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  const [currentIndex, setCurrentIndex] = useState(0)
  // Initially one ahead of currentIndex so the portal previews the upcoming
  // scene. Advances at shrink-end so the respawn animation visually spawns
  // the new next-scene, not the one that's about to become active.
  const [portalIndex, setPortalIndex] = useState(1)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isPortalShrinking, setIsPortalShrinking] = useState(false)
  const [transitionKey, setTransitionKey] = useState(0)
  const [portalVisible, setPortalVisible] = useState(true)
  const [isPortalEntering, setIsPortalEntering] = useState(false)

  const getBackgroundVideoElement = useCallback(
    (index: number): HTMLVideoElement | null => {
      const url = videos[index]
      return url ? (backgroundVideoElementsRef.current.get(url) ?? null) : null
    },
    [videos]
  )

  const getPortalVideoElement = useCallback(
    (index: number): HTMLVideoElement | null => {
      const url = videos[index]
      return url ? (portalVideoElementsRef.current.get(url) ?? null) : null
    },
    [videos]
  )

  // Shrink done → portal stays mounted (we have a separate portal video
  // element, so the bg transition slide can't rip it out via replaceChildren
  // anymore) and immediately starts entering, in parallel with the background
  // reveal. PORTAL_ENTER_DURATION_MS is tuned equal to
  // PORTAL_BG_REVEAL_DURATION_MS so both finish at the same moment: viewer
  // perceives a single coordinated "new scene swooshing in" beat. We also
  // advance portalIndex here so the respawn animation visually grows up the
  // new next-scene (if we waited until completeTransition, the swap would
  // happen at the end of the enter, when the portal is already full size).
  const completePortalShrink = useCallback(() => {
    if (!isPortalShrinking || isTransitioning) return
    setIsPortalShrinking(false)
    setIsTransitioning(true)
    setIsPortalEntering(true)
    setPortalIndex((prev) => (prev + 1) % (videos.length || 1))
  }, [isPortalShrinking, isTransitioning, videos.length])

  // BG reveal completed (natural animationend from BackgroundSlideshow, or
  // TRANSITION_FAILSAFE_MS backstop). Swap the active video index; the
  // portal's enter animation is concluding on the same clock.
  const completeTransition = useCallback(() => {
    if (!isTransitioning) return
    setCurrentIndex((prev) => (prev + 1) % (videos.length || 1))
    setIsTransitioning(false)
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
        const bgElements = new Map<string, HTMLVideoElement>()
        const portalElements = new Map<string, HTMLVideoElement>()

        for (const url of urls) {
          bgElements.set(url, createVideoElement(url))
          portalElements.set(url, createVideoElement(url))
        }

        backgroundVideoElementsRef.current = bgElements
        portalVideoElementsRef.current = portalElements

        if (!cancelled) {
          setVideos(urls)
          setCurrentIndex(0)
          setPortalIndex(urls.length > 1 ? 1 : 0)
          setPortalVisible(true)
          // Don't trigger enter yet — usePortalMediaMount will call
          // triggerPortalEnter once the video has decoded its first frame.
        }
      } catch (err) {
        console.error('Failed to load background videos:', err)
      }
    }

    load()

    return () => {
      cancelled = true
      for (const el of backgroundVideoElementsRef.current.values()) {
        el.pause()
        el.src = ''
      }
      for (const el of portalVideoElementsRef.current.values()) {
        el.pause()
        el.src = ''
      }
      backgroundVideoElementsRef.current.clear()
      portalVideoElementsRef.current.clear()
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
      if (SPARK_DEBUG.pauseCycling) return
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

    // Rely on BackgroundSlideshow's onAnimationEnd to fire completeTransition
    // at the natural end of the bg reveal so the viewer actually sees the
    // clip-path expansion. This failsafe catches tab/background/browser edge
    // cases where animationend doesn't fire.
    const failsafeTimer = window.setTimeout(() => {
      completeTransition()
    }, TRANSITION_FAILSAFE_MS)

    return () => window.clearTimeout(failsafeTimer)
  }, [isTransitioning, videos, completeTransition])

  const nextIndex = videos.length > 1 ? (currentIndex + 1) % videos.length : 0

  return {
    videos,
    getBackgroundVideoElement,
    getPortalVideoElement,
    currentIndex,
    nextIndex,
    portalIndex,
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
