import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  initialSceneEditState,
  sceneEditReducer,
  type SceneEditEvent,
  type SceneEditState
} from '../../context/streaming/sceneEditMachine'

/** The scene-edit overlay state machine plus its 500 ms post-close
 *  grace window. The grace flag is used by the lifecycle machine to
 *  suppress `pauseOnPointerUnlock` immediately after the overlay
 *  closes — without it, the brief pointer-unlock that happens while
 *  the delayed `requestPointerLock()` re-acquires lock would be read
 *  as the user opening the pause menu.
 *
 *  - `state` / `dispatch` drive the overlay UI (consumed via
 *    `SessionContext`).
 *  - `isActive` is the immediate "overlay is up" check (used for the
 *    input-enabled gate).
 *  - `graceActive` is the longer "overlay is up OR was up in the last
 *    500 ms" check (fed to the lifecycle machine). */
export function useSceneEdit(): {
  state: SceneEditState
  dispatch: (event: SceneEditEvent) => void
  isActive: boolean
  graceActive: boolean
} {
  const [state, dispatch] = useReducer(sceneEditReducer, initialSceneEditState)
  const isActive = state.mode !== 'inactive'

  const [graceActive, setGraceActive] = useState(false)
  useEffect(() => {
    if (isActive) {
      setGraceActive(true)
      return
    }
    if (!graceActive) return
    const timer = setTimeout(() => setGraceActive(false), 500)
    return () => clearTimeout(timer)
    // graceActive intentionally not a dep — we only want this effect to
    // trigger when isActive flips, not when graceActive changes (which
    // would clear the timer immediately on the trailing edge).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  return useMemo(() => ({ state, dispatch, isActive, graceActive }), [state, dispatch, isActive, graceActive])
}
