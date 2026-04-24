import { useCallback, useEffect, useRef, useState } from 'react'
import { PORTAL_SHRINK_FAILSAFE_BUFFER_MS, PORTAL_SHRINK_FAST_DURATION_MS } from '../lib/portalAnimation'

/** Phases the portal can be in when driven externally (e.g. by the Settings
 *  menu opening). Decoupled from `useBackgroundCycle`, which owns the separate
 *  shrink-then-respawn cycle between background videos. */
type PortalAnimationPhase = 'idle' | 'shrinking' | 'hidden'

const SHRINK_FAILSAFE_MS = PORTAL_SHRINK_FAST_DURATION_MS + PORTAL_SHRINK_FAILSAFE_BUFFER_MS

export type PortalAnimator = {
  isShrinking: boolean
  isHidden: boolean
  shrinkDurationMs: number
  /** Start the close sequence: play the shrink animation, then hide. */
  close: () => void
  /** Exit the hidden state. Caller is responsible for letting the portal's
   *  own media-ready flow fire `triggerPortalEnter` for the enter animation. */
  respawn: () => void
  /** Called by PortalPreview's onShrinkComplete when the CSS shrink animation
   *  finishes; short-circuits the failsafe timer. */
  markShrinkComplete: () => void
}

/** Externally-driven portal animation state machine. Callers use
 *  `close()` / `respawn()` to drive the portal hide/show independently of the
 *  background-cycle loop. Timers are encapsulated here so consumers don't have
 *  to thread them through render logic. */
export const usePortalAnimator = (): PortalAnimator => {
  const [phase, setPhase] = useState<PortalAnimationPhase>('idle')
  const timerRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const close = useCallback(() => {
    clearTimer()
    setPhase('shrinking')
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setPhase('hidden')
    }, SHRINK_FAILSAFE_MS)
  }, [])

  const respawn = useCallback(() => {
    clearTimer()
    setPhase('idle')
  }, [])

  const markShrinkComplete = useCallback(() => {
    // Only intercept when our own close() is in flight; otherwise a
    // background-cycle animationend would accidentally short-circuit us.
    setPhase((current) => {
      if (current !== 'shrinking') return current
      clearTimer()
      return 'hidden'
    })
  }, [])

  useEffect(() => () => clearTimer(), [])

  return {
    isShrinking: phase === 'shrinking',
    isHidden: phase === 'hidden',
    shrinkDurationMs: PORTAL_SHRINK_FAST_DURATION_MS,
    close,
    respawn,
    markShrinkComplete
  }
}
