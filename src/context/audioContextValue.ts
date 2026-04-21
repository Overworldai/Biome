import { createContext, useContext } from 'react'
import type { SoundId, VolumeSettings } from '../lib/audio'

export type AudioContextValue = {
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

export const AudioCtx = createContext<AudioContextValue | null>(null)

export const useAudio = () => {
  const context = useContext(AudioCtx)
  if (!context) {
    throw new Error('useAudio must be used within an AudioProvider')
  }
  return context
}
