/** Tracks how the user is currently driving the UI. The focus reticle is
 *  visible for `'keyboard' | 'gamepad'` (i.e. non-mouse) — same idea as CSS
 *  `:focus-visible`, done explicitly so an external overlay can subscribe.
 *  Distinguishing `gamepad` from `keyboard` lets components tailor UI (e.g.
 *  hide mouse-affordance pin buttons when the user is on a gamepad). */

import { useSyncExternalStore } from 'react'

export type InputModality = 'keyboard' | 'gamepad' | 'mouse'

let current: InputModality = 'mouse'
const listeners = new Set<() => void>()

const setModality = (next: InputModality) => {
  if (next === current) return
  current = next
  for (const l of listeners) l()
}

const onKey = () => setModality('keyboard')
const onPointer = () => setModality('mouse')

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('mousemove', onPointer, true)
  window.addEventListener('mousedown', onPointer, true)
}

/** Called by the gamepad navigation hook when any d-pad / button press fires. */
export const markGamepadInput = (): void => setModality('gamepad')

export const getInputModality = (): InputModality => current

export const useInputModality = (): InputModality =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => current
  )
