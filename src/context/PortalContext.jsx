import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { createLogger } from '../utils/logger'

const log = createLogger('Portal')

const STATES = {
  COLD: 'cold',
  WARM: 'warm',
  HOT: 'hot',
  STREAMING: 'streaming'
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
  const [state, setState] = useState(STATES.COLD)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isShrinking, setIsShrinking] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [showFlash, setShowFlash] = useState(false)
  const [isShuttingDown, setIsShuttingDown] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const listenersRef = useRef([])
  const maskElementRef = useRef(null)

  const parseDuration = (dur) => parseFloat(dur) * (dur.includes('ms') ? 1 : 1000)

  const registerMaskRef = useCallback((element) => {
    maskElementRef.current = element
  }, [])

  const setMaskProperty = useCallback((property, value) => {
    if (maskElementRef.current) {
      maskElementRef.current.style.setProperty(property, value)
    }
  }, [])

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

  const shrinkThenExpand = useCallback(
    (options = {}) => {
      return new Promise((resolve) => {
        const shrinkDuration = options.shrinkDuration || '1.5s'
        const expandDuration = options.expandDuration || '0.4s'
        const onShrinkComplete = options.onShrinkComplete || (() => {})

        // Target size uses CSS hypot() for diagonal calculation - fallback to 150cqh (always covers corners)
        const targetSize = options.targetSize || 'hypot(100cqw, 100cqh)'
        const feather = options.feather || '8cqh' // 8% feather using container units

        setIsAnimating(true)
        setIsShrinking(true)
        setIsExpanded(false)

        // Phase 1: Shrink aperture closed
        setMaskProperty('--mask-duration', shrinkDuration)

        requestAnimationFrame(() => {
          setMaskProperty('--mask-size', '0px')
        })

        setTimeout(() => {
          // Shrink complete - call callback to swap content
          onShrinkComplete()
          setIsShrinking(false)

          // Phase 2: Rapid expansion to reveal video
          setMaskProperty('--mask-duration', expandDuration)
          setMaskProperty('--mask-feather', feather)
          setMaskProperty('--mask-aspect', '1')

          // Trigger expansion
          requestAnimationFrame(() => {
            setMaskProperty('--mask-size', targetSize)
          })

          setTimeout(() => {
            setIsAnimating(false)
            setIsExpanded(true)
            resolve()
          }, parseDuration(expandDuration))
        }, parseDuration(shrinkDuration))
      })
    },
    [setMaskProperty]
  )

  const shutdown = useCallback(() => {
    return new Promise((resolve) => {
      const previousState = state
      log.info('Shutdown initiated - TV turn-off effect')

      setIsAnimating(true)
      setIsShuttingDown(true)

      // Phase 1: White flash (100ms)
      // Phase 2: Shrink to horizontal line (300ms)
      // Phase 3: Line collapses + fade to black (400ms)
      // Phase 4: Transition to COLD state (after 800ms total)

      setTimeout(() => {
        // Animation complete - transition to COLD
        setIsShuttingDown(false)
        setIsAnimating(false)
        setIsConnected(false)
        setIsExpanded(false)

        // Reset the mask to cold state defaults (oval shape)
        setMaskProperty('--mask-size', '28cqh')
        setMaskProperty('--mask-aspect', '0.8')
        setMaskProperty('--mask-duration', '0s')

        setState(STATES.COLD)
        notifyListeners(STATES.COLD, previousState)
        resolve()
      }, 1000) // Total animation duration
    })
  }, [state, notifyListeners, setMaskProperty])

  const transitionTo = useCallback(
    async (newState) => {
      const previousState = state

      if (newState === STATES.HOT) {
        // Set state to HOT immediately so terminal shows "CONNECTED" during shrink
        setState(newState)
        notifyListeners(newState, previousState)

        await shrinkThenExpand({
          onShrinkComplete: () => {
            setShowFlash(true)
            setIsConnected(true)
            setTimeout(() => setShowFlash(false), 600)
          }
        })
      } else {
        setState(newState)
        // Only disconnect when going back to COLD state
        if (newState === STATES.COLD) {
          setIsConnected(false)
          setIsExpanded(false)
        }
        notifyListeners(newState, previousState)
      }
    },
    [state, notifyListeners, shrinkThenExpand]
  )

  const value = {
    state,
    states: STATES,
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
    is: (s) => state === s
  }

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
}
