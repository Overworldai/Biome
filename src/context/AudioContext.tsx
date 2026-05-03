import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AudioEngine, type SoundId, type VolumeSettings } from '../lib/audio'
import { useSettings } from '../hooks/settingsContextValue'
import { AudioCtx } from './audioContextValue'

export const AudioProvider = ({ children }: { children: ReactNode }) => {
  const engineRef = useRef<AudioEngine | null>(null)
  const { settings } = useSettings()

  if (!engineRef.current) {
    engineRef.current = new AudioEngine()
  }

  const [volumes, setVolumesState] = useState<VolumeSettings>(() => engineRef.current!.volumes)

  // Sync volume settings from persisted settings
  useEffect(() => {
    const audio = settings.audio
    const update = { master: audio.master_volume, sfx: audio.sfx_volume, music: audio.music_volume }
    engineRef.current?.setVolumes(update)
    setVolumesState(update)
  }, [settings.audio])

  // Preload assets on mount
  useEffect(() => {
    void engineRef.current?.preloadAll()
  }, [])

  const play = useCallback((id: SoundId) => {
    engineRef.current?.play(id)
  }, [])

  const startLoop = useCallback((id: SoundId, volume?: number, fadeInSeconds?: number) => {
    engineRef.current?.startLoop(id, volume, fadeInSeconds)
  }, [])

  const stopLoop = useCallback((id: SoundId) => {
    engineRef.current?.stopLoop(id)
  }, [])

  const fadeOutLoop = useCallback((id: SoundId, seconds: number) => {
    engineRef.current?.fadeOutLoop(id, seconds)
  }, [])

  const crossfadeLoop = useCallback((from: SoundId, to: SoundId, seconds: number) => {
    engineRef.current?.crossfadeLoop(from, to, seconds)
  }, [])

  const stopAllLoops = useCallback(() => {
    engineRef.current?.stopAllLoops()
  }, [])

  const setLoopVolume = useCallback((id: SoundId, volume: number, rampSeconds?: number) => {
    engineRef.current?.setLoopVolume(id, volume, rampSeconds)
  }, [])

  const isLoopActive = useCallback((id: SoundId) => {
    return engineRef.current?.isLoopActive(id) ?? false
  }, [])

  const setVolumes = useCallback((update: Partial<VolumeSettings>) => {
    engineRef.current?.setVolumes(update)
    setVolumesState((prev) => ({ ...prev, ...update }))
  }, [])

  return (
    <AudioCtx.Provider
      value={{
        play,
        startLoop,
        stopLoop,
        fadeOutLoop,
        crossfadeLoop,
        stopAllLoops,
        setLoopVolume,
        isLoopActive,
        volumes,
        setVolumes
      }}
    >
      {children}
    </AudioCtx.Provider>
  )
}
