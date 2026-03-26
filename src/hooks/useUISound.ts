import { useCallback } from 'react'
import { useAudio } from '../context/AudioContext'
import { useSettings } from './useSettings'
import type { SoundId } from '../lib/audio'

/** Suppress hover sounds for this many ms after a click. */
const CLICK_HOVER_SUPPRESS_MS = 400

/** Shared across all hook instances so cross-component suppression works. */
let lastClickTime = 0

const GOOSE_UI_SOUND_MAP: Partial<Record<SoundId, SoundId>> = {
  ui_click: 'goose_start',
  ui_back: 'goose_end',
  ui_toggle_on: 'goose_start',
  ui_toggle_off: 'goose_end'
}

/** Convenience hook for UI sound effects on interactive elements. */
export const useUISound = () => {
  const { play } = useAudio()
  const { settings } = useSettings()

  const playUiSound = useCallback(
    (id: SoundId) => {
      if (settings.goose_mode) {
        play(GOOSE_UI_SOUND_MAP[id] ?? id)
        return
      }
      play(id)
    },
    [play, settings.goose_mode]
  )

  const playHover = useCallback(() => {
    if (performance.now() - lastClickTime < CLICK_HOVER_SUPPRESS_MS) return
    playUiSound('ui_hover')
  }, [playUiSound])

  const playClick = useCallback(() => {
    lastClickTime = performance.now()
    playUiSound('ui_click')
  }, [playUiSound])

  const hoverProps = { onMouseEnter: playHover }
  const clickProps = { onMouseDown: playClick }

  const playBack = useCallback(() => playUiSound('ui_back'), [playUiSound])
  const backProps = { onMouseDown: playBack }

  const playToggleOn = useCallback(() => playUiSound('ui_toggle_on'), [playUiSound])
  const playToggleOff = useCallback(() => playUiSound('ui_toggle_off'), [playUiSound])
  const playError = useCallback(() => play('error'), [play])

  return { hoverProps, clickProps, backProps, playHover, playClick, playBack, playToggleOn, playToggleOff, playError }
}
