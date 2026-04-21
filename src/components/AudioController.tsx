import { useEffect, useRef } from 'react'
import { useAudio } from '../context/audioContextValue'
import { usePortal } from '../context/portalContextValue'
import { useStreaming } from '../context/streamingContextValue'

/** Duration in seconds for music crossfades. */
const MUSIC_FADE_S = 0.5

/**
 * Observes app state and manages ambient audio loops.
 * Renders nothing — pure side-effect component.
 */
const AudioController = () => {
  const { play, fadeOutLoop, crossfadeLoop, stopAllLoops } = useAudio()
  const { state, states } = usePortal()
  const { error, engineError, isPaused } = useStreaming()
  const prevHasErrorRef = useRef(false)
  // Manage ambient loops based on portal state
  useEffect(() => {
    if (state === states.LOADING) {
      fadeOutLoop('music_menu', 0.3)
      fadeOutLoop('music_pause', 0.3)
      fadeOutLoop('music_gameplay', 0.3)
      fadeOutLoop('portal_hum', 0.15)
    } else if (state === states.STREAMING) {
      fadeOutLoop('music_menu', 0.3)
      // Pause/gameplay music handled by the isPaused effect below
    } else if (state === states.MAIN_MENU) {
      crossfadeLoop('music_gameplay', 'music_menu', MUSIC_FADE_S)
      crossfadeLoop('music_pause', 'music_menu', MUSIC_FADE_S)
    } else {
      stopAllLoops()
    }
  }, [state, states, fadeOutLoop, crossfadeLoop, stopAllLoops])

  // Swap between gameplay and pause music with crossfade
  useEffect(() => {
    if (state !== states.STREAMING) return
    if (isPaused) {
      crossfadeLoop('music_gameplay', 'music_pause', MUSIC_FADE_S)
    } else {
      crossfadeLoop('music_pause', 'music_gameplay', MUSIC_FADE_S)
    }
  }, [isPaused, state, states, crossfadeLoop])

  // On error during loading: play error sound
  useEffect(() => {
    const hasError = !!(error || engineError)
    if (hasError && !prevHasErrorRef.current) {
      play('error')
    }
    prevHasErrorRef.current = hasError
  }, [error, engineError, play])

  // Cleanup on unmount
  useEffect(() => {
    return () => stopAllLoops()
  }, [stopAllLoops])

  return null
}

export default AudioController
