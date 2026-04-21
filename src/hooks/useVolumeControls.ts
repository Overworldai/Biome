import { useCallback } from 'react'
import { useAudio } from '../context/audioContextValue'

/** UI-facing volume controls that read/write the audio engine directly, converting 0–1 ↔ 0–100. */
export const useVolumeControls = () => {
  const { volumes, setVolumes } = useAudio()

  const master = Math.round(volumes.master * 100)
  const sfx = Math.round(volumes.sfx * 100)
  const music = Math.round(volumes.music * 100)

  const setMaster = useCallback((v: number) => setVolumes({ master: v / 100 }), [setVolumes])
  const setSfx = useCallback((v: number) => setVolumes({ sfx: v / 100 }), [setVolumes])
  const setMusic = useCallback((v: number) => setVolumes({ music: v / 100 }), [setVolumes])

  /** Returns volume settings in 0–1 range for persistence. */
  const getAudioSettings = useCallback(
    () => ({ master_volume: volumes.master, sfx_volume: volumes.sfx, music_volume: volumes.music }),
    [volumes]
  )

  return { master, sfx, music, setMaster, setSfx, setMusic, getAudioSettings }
}
