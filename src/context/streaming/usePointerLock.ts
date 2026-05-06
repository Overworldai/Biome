import { useCallback, useState, type RefObject } from 'react'
import { createLogger } from '../../utils/logger'
import { UNLOCK_DELAY_MS, type PauseState } from './usePauseState'

const log = createLogger('PointerLock')

/** Owns the pointer-lock request gate: tracks how many requests have
 *  been blocked by the browser cooldown (consumers watch `blockedSeq`
 *  to play feedback sounds), and refuses to call `requestPointerLock`
 *  during the post-pause cooldown window or when the connection is in
 *  the lost state.
 *
 *  Ref-based — the container element is registered by `<VideoContainer>`
 *  and the hook only stores the ref; it does not re-render when the
 *  element registers/unregisters. */
export function usePointerLock(opts: {
  containerRef: RefObject<HTMLDivElement | null>
  pauseState: PauseState
  connectionLost: boolean
}): {
  /** True when the cursor is currently locked to the gameplay surface.
   *  Sourced from `useGameInput` — surfaced via `useInputLoop`, NOT
   *  from this hook (the document-level pointerlockchange listener
   *  lives there). */
  blockedSeq: number
  request: () => boolean
  exit: () => void
} {
  const { containerRef, pauseState, connectionLost } = opts
  const [blockedSeq, setBlockedSeq] = useState(0)

  const request = useCallback((): boolean => {
    if (connectionLost) return false

    // https://github.com/electron/electron/issues/33587 — there's no way around
    // the pointer-lock cooldown the browser enforces after an Esc-driven unlock,
    // so fail the request explicitly and bump the blocked-seq so the UI can
    // play feedback. Otherwise the click silently does nothing and the user
    // wonders why their input isn't catching.
    if (pauseState.kind === 'paused' && !pauseState.canUnpause) {
      const remainingMs = Math.max(0, UNLOCK_DELAY_MS - pauseState.elapsedMs)
      log.info(`Pointer lock request blocked by cooldown (${remainingMs}ms remaining)`)
      setBlockedSeq((seq) => seq + 1)
      return false
    }

    containerRef.current?.requestPointerLock()
    return true
  }, [connectionLost, pauseState, containerRef])

  const exit = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
  }, [])

  return { blockedSeq, request, exit }
}
