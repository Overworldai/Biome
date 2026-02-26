import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { createLogger } from '../utils/logger'
import { PORTAL_STATES, canTransitionPortalState, type PortalState } from './portalStateMachine'

const log = createLogger('Portal')
const VISUAL_PHASES = {
  MENU_IDLE: 'menu_idle',
  LAUNCH_SHRINKING: 'launch_shrinking',
  LAUNCH_EXPANDING: 'launch_expanding',
  LOADING_IDLE: 'loading_idle',
  STREAMING_ACTIVE: 'streaming_active',
  SHUTTING_DOWN: 'shutting_down'
} as const

type VisualPhase = (typeof VISUAL_PHASES)[keyof typeof VISUAL_PHASES]

type PortalContextValue = {
  state: PortalState
  states: typeof PORTAL_STATES
  isAnimating: boolean
  isShrinking: boolean
  isExpanded: boolean
  isConnected: boolean
  showFlash: boolean
  isShuttingDown: boolean
  isSettingsOpen: boolean
  toggleSettings: () => void
  runLaunchTransition: () => Promise<boolean>
  transitionTo: (newState: PortalState) => Promise<boolean>
  shutdown: () => Promise<void>
  onStateChange: (callback: (newState: PortalState, previousState: PortalState) => void) => () => void
  registerMaskRef: (element: HTMLDivElement | null) => void
  registerShutdownRef: (element: HTMLDivElement | null) => void
  is: (state: PortalState) => boolean
}

type ShrinkExpandOptions = {
  shrinkDuration?: string
  expandDuration?: string
  onShrinkComplete?: () => void
  targetSize?: string
  feather?: string
}

const PortalContext = createContext<PortalContextValue | null>(null)

export const usePortal = () => {
  const context = useContext(PortalContext)
  if (!context) {
    throw new Error('usePortal must be used within a PortalProvider')
  }
  return context
}

export const PortalProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<PortalState>(PORTAL_STATES.MAIN_MENU)
  const [visualPhase, setVisualPhase] = useState<VisualPhase>(VISUAL_PHASES.MENU_IDLE)
  const [isShuttingDown, setIsShuttingDown] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const listenersRef = useRef<Array<(newState: PortalState, previousState: PortalState) => void>>([])
  const maskElementRef = useRef<HTMLDivElement | null>(null)
  const shutdownElementRef = useRef<HTMLDivElement | null>(null)
  const transitionRunRef = useRef(0)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  const parseDuration = (dur: string) => parseFloat(dur) * (dur.includes('ms') ? 1 : 1000)

  const registerMaskRef = useCallback((element: HTMLDivElement | null) => {
    maskElementRef.current = element
  }, [])
  const registerShutdownRef = useCallback((element: HTMLDivElement | null) => {
    shutdownElementRef.current = element
  }, [])

  const setMaskProperty = useCallback((property: string, value: string) => {
    if (maskElementRef.current) {
      maskElementRef.current.style.setProperty(property, value)
    }
  }, [])

  const resetMaskToPortalIdle = useCallback(() => {
    setMaskProperty('--mask-size', '28cqh')
    setMaskProperty('--mask-aspect', '0.8')
    setMaskProperty('--mask-feather', '2.8cqh')
    setMaskProperty('--mask-duration', '0s')
  }, [setMaskProperty])

  const isAnimating =
    visualPhase === VISUAL_PHASES.LAUNCH_SHRINKING ||
    visualPhase === VISUAL_PHASES.LAUNCH_EXPANDING ||
    visualPhase === VISUAL_PHASES.SHUTTING_DOWN
  const isShrinking = visualPhase === VISUAL_PHASES.LAUNCH_SHRINKING
  const isExpanded = visualPhase === VISUAL_PHASES.LAUNCH_EXPANDING
  const isConnected = state === PORTAL_STATES.STREAMING
  const showFlash = visualPhase === VISUAL_PHASES.LAUNCH_EXPANDING

  const notifyListeners = useCallback((newState: PortalState, previousState: PortalState) => {
    log.info(`State: ${previousState} → ${newState}`)
    listenersRef.current.forEach((fn) => fn(newState, previousState))
  }, [])

  const toggleSettings = useCallback(() => {
    setIsSettingsOpen((prev) => !prev)
  }, [])

  const onStateChange = useCallback((callback: (newState: PortalState, previousState: PortalState) => void) => {
    listenersRef.current.push(callback)
    return () => {
      listenersRef.current = listenersRef.current.filter((fn) => fn !== callback)
    }
  }, [])

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach((timerId) => clearTimeout(timerId))
    timersRef.current.clear()
  }, [])

  const waitForMaskSizeTransition = useCallback((runId: number, fallbackMs: number) => {
    return new Promise<void>((resolve) => {
      const element = maskElementRef.current
      if (!element) {
        setTimeout(resolve, fallbackMs)
        return
      }

      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        element.removeEventListener('transitionend', onTransitionEnd)
        clearTimeout(watchdog)
        resolve()
      }

      const onTransitionEnd = (event: TransitionEvent) => {
        if (transitionRunRef.current !== runId) return finish()
        if (event.target !== element) return
        if (event.propertyName && event.propertyName !== '--mask-size') return
        finish()
      }

      element.addEventListener('transitionend', onTransitionEnd)
      const watchdog = setTimeout(finish, fallbackMs)
    })
  }, [])

  const waitForShutdownAnimation = useCallback((runId: number, fallbackMs = 1200) => {
    return new Promise<void>((resolve) => {
      const element = shutdownElementRef.current
      if (!element) {
        setTimeout(resolve, fallbackMs)
        return
      }

      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        element.removeEventListener('animationend', onAnimationEnd)
        clearTimeout(watchdog)
        resolve()
      }

      const onAnimationEnd = (event: AnimationEvent) => {
        if (transitionRunRef.current !== runId) return finish()
        if (event.target !== element) return
        if (event.animationName && event.animationName !== 'tvBlackout') return
        finish()
      }

      element.addEventListener('animationend', onAnimationEnd)
      const watchdog = setTimeout(finish, fallbackMs)
    })
  }, [])

  const shrinkThenExpand = useCallback(
    async (options: ShrinkExpandOptions = {}) => {
      const runId = transitionRunRef.current
      const shrinkDuration = options.shrinkDuration || '1.5s'
      const expandDuration = options.expandDuration || '0.4s'
      const onShrinkComplete = options.onShrinkComplete || (() => {})
      const targetSize = options.targetSize || 'hypot(100cqw, 100cqh)'
      const feather = options.feather || '8cqh'

      setVisualPhase(VISUAL_PHASES.LAUNCH_SHRINKING)
      setMaskProperty('--mask-duration', shrinkDuration)

      requestAnimationFrame(() => {
        if (transitionRunRef.current !== runId) return
        setMaskProperty('--mask-size', '0px')
      })

      await waitForMaskSizeTransition(runId, parseDuration(shrinkDuration) + 120)
      if (transitionRunRef.current !== runId) return

      onShrinkComplete()
      setVisualPhase(VISUAL_PHASES.LAUNCH_EXPANDING)
      setMaskProperty('--mask-duration', expandDuration)
      setMaskProperty('--mask-feather', feather)
      setMaskProperty('--mask-aspect', '1')

      requestAnimationFrame(() => {
        if (transitionRunRef.current !== runId) return
        setMaskProperty('--mask-size', targetSize)
      })

      await waitForMaskSizeTransition(runId, parseDuration(expandDuration) + 120)
      if (transitionRunRef.current !== runId) return
    },
    [setMaskProperty, waitForMaskSizeTransition]
  )

  const runLaunchTransition = useCallback(async () => {
    if (state !== PORTAL_STATES.MAIN_MENU) return false
    transitionRunRef.current += 1
    clearAllTimers()
    await shrinkThenExpand()
    return true
  }, [state, clearAllTimers, shrinkThenExpand])

  const shutdown = useCallback(async () => {
    transitionRunRef.current += 1
    clearAllTimers()
    const runId = transitionRunRef.current
    const previousState = state
    log.info('Shutdown initiated - TV turn-off effect')

    setIsShuttingDown(true)
    setVisualPhase(VISUAL_PHASES.SHUTTING_DOWN)

    await waitForShutdownAnimation(runId)
    if (transitionRunRef.current !== runId) return

    setIsShuttingDown(false)
    setVisualPhase(VISUAL_PHASES.MENU_IDLE)
    resetMaskToPortalIdle()
    setState(PORTAL_STATES.MAIN_MENU)
    notifyListeners(PORTAL_STATES.MAIN_MENU, previousState)
  }, [state, notifyListeners, clearAllTimers, resetMaskToPortalIdle, waitForShutdownAnimation])

  const transitionTo = useCallback(
    async (newState: PortalState) => {
      const previousState = state
      if (!canTransitionPortalState(previousState, newState)) {
        log.warn(`Invalid transition blocked: ${previousState} -> ${newState}`)
        return false
      }

      transitionRunRef.current += 1
      clearAllTimers()

      setState(newState)
      if (newState === PORTAL_STATES.MAIN_MENU) {
        resetMaskToPortalIdle()
        setVisualPhase(VISUAL_PHASES.MENU_IDLE)
      } else if (newState === PORTAL_STATES.LOADING) {
        setVisualPhase(VISUAL_PHASES.LOADING_IDLE)
      } else if (newState === PORTAL_STATES.STREAMING) {
        setVisualPhase(VISUAL_PHASES.STREAMING_ACTIVE)
      }
      notifyListeners(newState, previousState)
      return true
    },
    [state, notifyListeners, clearAllTimers, resetMaskToPortalIdle]
  )

  useEffect(() => {
    return () => {
      clearAllTimers()
    }
  }, [clearAllTimers])

  const value: PortalContextValue = {
    state,
    states: PORTAL_STATES,
    isAnimating,
    isShrinking,
    isExpanded,
    isConnected,
    showFlash,
    isShuttingDown,
    isSettingsOpen,
    toggleSettings,
    runLaunchTransition,
    transitionTo,
    shutdown,
    onStateChange,
    registerMaskRef,
    registerShutdownRef,
    is: (s: PortalState) => state === s
  }

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
}
