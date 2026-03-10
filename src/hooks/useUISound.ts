import { useCallback } from 'react'
import { useAudio } from '../context/AudioContext'

/** Suppress hover sounds for this many ms after a click. */
const CLICK_HOVER_SUPPRESS_MS = 400

/** Shared across all hook instances so cross-component suppression works. */
let lastClickTime = 0

/** Convenience hook for UI sound effects on interactive elements. */
export const useUISound = () => {
  const { play } = useAudio()

  const playHover = useCallback(() => {
    if (performance.now() - lastClickTime < CLICK_HOVER_SUPPRESS_MS) return
    play('ui_hover')
  }, [play])

  const playClick = useCallback(() => {
    lastClickTime = performance.now()
    play('ui_click')
  }, [play])

  const hoverProps = { onMouseEnter: playHover }
  const clickProps = { onMouseDown: playClick }

  const playBack = useCallback(() => play('ui_back'), [play])
  const backProps = { onMouseDown: playBack }

  const playToggleOn = useCallback(() => play('ui_toggle_on'), [play])
  const playToggleOff = useCallback(() => play('ui_toggle_off'), [play])
  const playError = useCallback(() => play('error'), [play])

  return { hoverProps, clickProps, backProps, playHover, playClick, playBack, playToggleOn, playToggleOff, playError }
}
