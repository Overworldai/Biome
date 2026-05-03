import { useState, useEffect, useRef } from 'react'
import { useAudio } from '../context/audioContextValue'
import { useStreaming } from '../context/streamingContextValue'

/**
 * Centralizes pointer-lock cooldown feedback: plays an error sound and
 * manages the "unlock in X.Xs" hint whenever a lock request is blocked
 * by the browser's pointer-lock cooldown.
 */
export function usePointerLockFeedback(isActive: boolean) {
  const { play } = useAudio()
  const { canUnpause, unlockDelayMs, pauseElapsedMs, pointerLockBlockedSeq } = useStreaming()
  const [showUnlockHint, setShowUnlockHint] = useState(false)
  const lastBlockedSeqRef = useRef(pointerLockBlockedSeq)

  // Reset when overlay deactivates
  useEffect(() => {
    if (!isActive) {
      setShowUnlockHint(false)
    }
  }, [isActive])

  // Play error sound + show hint when a pointer lock request is blocked
  useEffect(() => {
    if (!isActive) return
    if (pointerLockBlockedSeq <= 0) return
    if (pointerLockBlockedSeq === lastBlockedSeqRef.current) return
    lastBlockedSeqRef.current = pointerLockBlockedSeq
    setShowUnlockHint(true)
    play('error')
  }, [isActive, pointerLockBlockedSeq, play])

  // Auto-hide hint after 1200ms
  useEffect(() => {
    if (!showUnlockHint) return
    const timer = window.setTimeout(() => setShowUnlockHint(false), 1200)
    return () => window.clearTimeout(timer)
  }, [showUnlockHint])

  // Clear hint as soon as unlock is possible
  useEffect(() => {
    if (canUnpause) {
      setShowUnlockHint(false)
    }
  }, [canUnpause])

  const pauseLockoutRemainingMs = Math.max(0, unlockDelayMs - pauseElapsedMs)
  const showPauseLockoutTimer = isActive && !canUnpause && pauseLockoutRemainingMs > 0 && showUnlockHint
  const pauseLockoutSecondsText = (pauseLockoutRemainingMs / 1000).toFixed(1)

  return {
    showUnlockHint,
    showPauseLockoutTimer,
    pauseLockoutSecondsText,
    selectCooldown: !canUnpause
  }
}
