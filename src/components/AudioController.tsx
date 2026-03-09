import { useEffect, useRef } from 'react'
import { useAudio } from '../context/AudioContext'
import { usePortal } from '../context/PortalContext'
import { useStreaming } from '../context/StreamingContext'

/** Duration in seconds for music crossfades. */
const MUSIC_FADE_S = 0.5

/**
 * Observes app state and manages ambient audio loops.
 * Renders nothing — pure side-effect component.
 */
const AudioController = () => {
  const { play, startLoop, stopLoop, fadeOutLoop, crossfadeLoop, stopAllLoops, setLoopVolume, isLoopActive } =
    useAudio()
  const { state, states } = usePortal()
  const { error, engineError, isPaused } = useStreaming()
  const prevErrorRef = useRef<string | null>(null)
  const prevStateRef = useRef<string | null>(null)

  // Manage ambient loops based on portal state
  useEffect(() => {
    const cameFromLoading = prevStateRef.current === states.LOADING
    prevStateRef.current = state

    if (state === states.LOADING) {
      fadeOutLoop('music_menu', MUSIC_FADE_S)
      fadeOutLoop('music_pause', MUSIC_FADE_S)
      fadeOutLoop('music_gameplay', MUSIC_FADE_S)
      // The portal hover may have already started the vortex loop at low volume;
      // ramp it to full rather than restarting.
      if (isLoopActive('vortex_loop')) {
        setLoopVolume('vortex_loop', 1, 0.3)
      } else {
        startLoop('vortex_loop')
      }
    } else if (state === states.STREAMING) {
      stopLoop('vortex_loop')
      stopLoop('vortex_error')
      fadeOutLoop('music_menu', MUSIC_FADE_S)
      // Pause/gameplay music handled by the isPaused effect below
    } else if (state === states.MAIN_MENU) {
      // Stop vortex when returning from loading; leave it alone if portal hover started it
      if (cameFromLoading) {
        stopLoop('vortex_loop')
        stopLoop('vortex_error')
      }
      crossfadeLoop('music_gameplay', 'music_menu', MUSIC_FADE_S)
      crossfadeLoop('music_pause', 'music_menu', MUSIC_FADE_S)
    } else {
      stopAllLoops()
    }
  }, [state, states, startLoop, stopLoop, fadeOutLoop, crossfadeLoop, stopAllLoops, setLoopVolume, isLoopActive])

  // Swap between gameplay and pause music with crossfade
  useEffect(() => {
    if (state !== states.STREAMING) return
    if (isPaused) {
      crossfadeLoop('music_gameplay', 'music_pause', MUSIC_FADE_S)
    } else {
      crossfadeLoop('music_pause', 'music_gameplay', MUSIC_FADE_S)
    }
  }, [isPaused, state, states, crossfadeLoop])

  // On error during loading: swap vortex_loop for menacing vortex_error
  useEffect(() => {
    const currentError = error || engineError || null
    if (currentError && currentError !== prevErrorRef.current) {
      play('error')
      if (state === states.LOADING) {
        stopLoop('vortex_loop')
        startLoop('vortex_error')
      }
    }
    prevErrorRef.current = currentError
  }, [error, engineError, play, state, states, stopLoop, startLoop])

  // Cleanup on unmount
  useEffect(() => {
    return () => stopAllLoops()
  }, [stopAllLoops])

  return null
}

export default AudioController
