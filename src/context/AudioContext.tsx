import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AudioEngine, type SoundId, type VolumeSettings } from '../lib/audio'
import { useSettings } from '../hooks/useSettings'

type AudioContextValue = {
  play: (id: SoundId) => void
  startLoop: (id: SoundId, volume?: number, fadeInSeconds?: number) => void
  stopLoop: (id: SoundId) => void
  fadeOutLoop: (id: SoundId, seconds: number) => void
  crossfadeLoop: (from: SoundId, to: SoundId, seconds: number) => void
  stopAllLoops: () => void
  setLoopVolume: (id: SoundId, volume: number, rampSeconds?: number) => void
  isLoopActive: (id: SoundId) => boolean
  volumes: VolumeSettings
  setVolumes: (update: Partial<VolumeSettings>) => void
}

const Ctx = createContext<AudioContextValue | null>(null)

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
    <Ctx.Provider
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
    </Ctx.Provider>
  )
}

export const useAudio = () => {
  const context = useContext(Ctx)
  if (!context) {
    throw new Error('useAudio must be used within an AudioProvider')
  }
  return context
}
