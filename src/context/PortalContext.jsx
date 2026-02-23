import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { createLogger } from '../utils/logger'
import { PORTAL_STATES, canTransitionPortalState } from './portalStateMachine'

const log = createLogger('Portal')
const VISUAL_PHASES = {
  COLD_IDLE: 'cold_idle',
  WARM_IDLE: 'warm_idle',
  HOT_SHRINKING: 'hot_shrinking',
  HOT_EXPANDING: 'hot_expanding',
  HOT_EXPANDED: 'hot_expanded',
  STREAMING: 'streaming',
  SHUTTING_DOWN: 'shutting_down'
}

const PortalContext = createContext(null)

export const usePortal = () => {
  const context = useContext(PortalContext)
  if (!context) {
    throw new Error('usePortal must be used within a PortalProvider')
  }
  return context
}

export const PortalProvider = ({ children }) => {
  const [state, setState] = useState(PORTAL_STATES.COLD)
  const [visualPhase, setVisualPhase] = useState(VISUAL_PHASES.COLD_IDLE)
  const [isShuttingDown, setIsShuttingDown] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const listenersRef = useRef([])
  const maskElementRef = useRef(null)
  const shutdownElementRef = useRef(null)
  const transitionRunRef = useRef(0)
  const timersRef = useRef(new Set())

  const parseDuration = (dur) => parseFloat(dur) * (dur.includes('ms') ? 1 : 1000)

  const registerMaskRef = useCallback((element) => {
    maskElementRef.current = element
  }, [])
  const registerShutdownRef = useCallback((element) => {
    shutdownElementRef.current = element
  }, [])

  const setMaskProperty = useCallback((property, value) => {
    if (maskElementRef.current) {
      maskElementRef.current.style.setProperty(property, value)
    }
  }, [])

  const resetMaskToPortalIdle = useCallback(() => {
    // Deterministic ring geometry for cold/warm states.
    setMaskProperty('--mask-size', '28cqh')
    setMaskProperty('--mask-aspect', '0.8')
    setMaskProperty('--mask-feather', '2.8cqh')
    setMaskProperty('--mask-duration', '0s')
  }, [setMaskProperty])

  const isAnimating =
    visualPhase === VISUAL_PHASES.HOT_SHRINKING ||
    visualPhase === VISUAL_PHASES.HOT_EXPANDING ||
    visualPhase === VISUAL_PHASES.SHUTTING_DOWN
  const isShrinking = visualPhase === VISUAL_PHASES.HOT_SHRINKING
  const isExpanded = visualPhase === VISUAL_PHASES.HOT_EXPANDED || visualPhase === VISUAL_PHASES.STREAMING
  const isConnected =
    visualPhase === VISUAL_PHASES.HOT_EXPANDING ||
    visualPhase === VISUAL_PHASES.HOT_EXPANDED ||
    visualPhase === VISUAL_PHASES.STREAMING
  const showFlash = visualPhase === VISUAL_PHASES.HOT_EXPANDING

  const notifyListeners = useCallback((newState, previousState) => {
    log.info(`State: ${previousState} → ${newState}`)
    listenersRef.current.forEach((fn) => fn(newState, previousState))
  }, [])

  const toggleSettings = useCallback(() => {
    setIsSettingsOpen((prev) => !prev)
  }, [])

  const onStateChange = useCallback((callback) => {
    listenersRef.current.push(callback)
    return () => {
      listenersRef.current = listenersRef.current.filter((fn) => fn !== callback)
    }
  }, [])

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach((timerId) => clearTimeout(timerId))
    timersRef.current.clear()
  }, [])

  const scheduleTimeout = useCallback((fn, delayMs) => {
    const timerId = setTimeout(() => {
      timersRef.current.delete(timerId)
      fn()
    }, delayMs)
    timersRef.current.add(timerId)
    return timerId
  }, [])

  useEffect(() => {
    return () => {
      clearAllTimers()
    }
  }, [clearAllTimers])

  const waitForMaskSizeTransition = useCallback((runId, fallbackMs) => {
    return new Promise((resolve) => {
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

      const onTransitionEnd = (event) => {
        if (transitionRunRef.current !== runId) return finish()
        if (event.target !== element) return
        if (event.propertyName && event.propertyName !== '--mask-size') return
        finish()
      }

      element.addEventListener('transitionend', onTransitionEnd)
      const watchdog = setTimeout(finish, fallbackMs)
    })
  }, [])

  const waitForShutdownAnimation = useCallback((runId, fallbackMs = 1200) => {
    return new Promise((resolve) => {
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

      const onAnimationEnd = (event) => {
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
    async (options = {}) => {
      const runId = transitionRunRef.current
      const shrinkDuration = options.shrinkDuration || '1.5s'
      const expandDuration = options.expandDuration || '0.4s'
      const onShrinkComplete = options.onShrinkComplete || (() => {})

      // Target size uses CSS hypot() for diagonal calculation - fallback to 150cqh (always covers corners)
      const targetSize = options.targetSize || 'hypot(100cqw, 100cqh)'
      const feather = options.feather || '8cqh' // 8% feather using container units

      setVisualPhase(VISUAL_PHASES.HOT_SHRINKING)
      setMaskProperty('--mask-duration', shrinkDuration)

      requestAnimationFrame(() => {
        if (transitionRunRef.current !== runId) return
        setMaskProperty('--mask-size', '0px')
      })

      await waitForMaskSizeTransition(runId, parseDuration(shrinkDuration) + 120)
      if (transitionRunRef.current !== runId) return

      onShrinkComplete()
      setVisualPhase(VISUAL_PHASES.HOT_EXPANDING)
      setMaskProperty('--mask-duration', expandDuration)
      setMaskProperty('--mask-feather', feather)
      setMaskProperty('--mask-aspect', '1')

      requestAnimationFrame(() => {
        if (transitionRunRef.current !== runId) return
        setMaskProperty('--mask-size', targetSize)
      })

      await waitForMaskSizeTransition(runId, parseDuration(expandDuration) + 120)
      if (transitionRunRef.current !== runId) return

      setVisualPhase(VISUAL_PHASES.HOT_EXPANDED)
    },
    [setMaskProperty, waitForMaskSizeTransition]
  )

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
    setVisualPhase(VISUAL_PHASES.COLD_IDLE)

    // Reset the mask to cold state defaults (oval shape)
    resetMaskToPortalIdle()

    setState(PORTAL_STATES.COLD)
    notifyListeners(PORTAL_STATES.COLD, previousState)
  }, [state, notifyListeners, clearAllTimers, resetMaskToPortalIdle, waitForShutdownAnimation])

  const transitionTo = useCallback(
    async (newState) => {
      const previousState = state
      if (!canTransitionPortalState(previousState, newState)) {
        log.warn(`Invalid transition blocked: ${previousState} -> ${newState}`)
        return false
      }

      transitionRunRef.current += 1
      clearAllTimers()
      const runId = transitionRunRef.current

      if (newState === PORTAL_STATES.HOT) {
        // Set state to HOT immediately so terminal shows "CONNECTED" during shrink
        setState(newState)
        notifyListeners(newState, previousState)

        await shrinkThenExpand({
          onShrinkComplete: () => {
            if (transitionRunRef.current !== runId) return
            // Flash is derived from HOT_EXPANDING phase.
          }
        })
      } else {
        setState(newState)
        // Entering WARM should clear the previous connected/expanded visual
        // state so reconnects start from a clean loading phase.
        if (newState === PORTAL_STATES.COLD || newState === PORTAL_STATES.WARM) {
          resetMaskToPortalIdle()
          setVisualPhase(newState === PORTAL_STATES.WARM ? VISUAL_PHASES.WARM_IDLE : VISUAL_PHASES.COLD_IDLE)
        } else if (newState === PORTAL_STATES.STREAMING) {
          setVisualPhase(VISUAL_PHASES.STREAMING)
        }
        notifyListeners(newState, previousState)
      }
      return true
    },
    [state, notifyListeners, shrinkThenExpand, clearAllTimers, resetMaskToPortalIdle]
  )

  const value = {
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
    transitionTo,
    shutdown,
    onStateChange,
    registerMaskRef,
    registerShutdownRef,
    is: (s) => state === s
  }

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
}
