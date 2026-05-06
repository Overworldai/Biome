import { useCallback, useEffect, useState } from 'react'

/** Browsers require ~1s delay before pointer lock can be re-requested
 *  after an Esc-driven unlock. While paused, the UI shows a "X.Xs"
 *  countdown so the user knows why their click isn't catching. */
export const UNLOCK_DELAY_MS = 1250

/** Discriminated pause state. While paused, we track the wall-clock
 *  start time so the cooldown countdown can be displayed accurately
 *  even if the renderer is throttled mid-pause. `elapsedMs` and
 *  `canUnpause` are derived values that tick on a 50 ms interval; they
 *  live on the union member rather than as parallel scalars so the
 *  active-with-non-null-pausedAt impossible-state goes away. */
export type PauseState = { kind: 'active' } | { kind: 'paused'; at: number; elapsedMs: number; canUnpause: boolean }

/** Owns pause lifecycle state. Returns the discriminated state plus
 *  `pause()` / `resume()` actions that callers fire from the
 *  pause-menu / Esc handler. */
export function usePauseState(): {
  state: PauseState
  pause: () => void
  resume: () => void
} {
  const [state, setState] = useState<PauseState>({ kind: 'active' })

  // Tick `elapsedMs` and `canUnpause` while paused. The interval only
  // runs while paused, so there's no idle drain on the active state.
  useEffect(() => {
    if (state.kind !== 'paused') return
    const interval = setInterval(() => {
      setState((prev) => {
        if (prev.kind !== 'paused') return prev
        const elapsedMs = Date.now() - prev.at
        return { ...prev, elapsedMs, canUnpause: elapsedMs >= UNLOCK_DELAY_MS }
      })
    }, 50)
    return () => clearInterval(interval)
  }, [state.kind])

  const pause = useCallback(() => {
    setState({ kind: 'paused', at: Date.now(), elapsedMs: 0, canUnpause: false })
  }, [])

  const resume = useCallback(() => {
    setState({ kind: 'active' })
  }, [])

  return { state, pause, resume }
}
