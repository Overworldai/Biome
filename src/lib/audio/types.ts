export type SoundId =
  | 'ui_hover'
  | 'ui_click'
  | 'ui_back'
  | 'ui_toggle_on'
  | 'ui_toggle_off'
  | 'error'
  | 'portal_swoosh'
  | 'portal_swoosh_long'
  | 'portal_hum'
  | 'vortex_loop'
  | 'vortex_error'
  | 'music_menu'
  | 'music_pause'
  | 'music_gameplay'

export type SoundCategory = 'sfx' | 'music'

/** Volume levels for each audio category, all in 0–1 range. */
export type VolumeSettings = { master: number; sfx: number; music: number }

/** A function that synthesizes a one-shot sound into a destination node. */
export type SynthOneShot = (ctx: AudioContext, dest: AudioNode) => void

/** A function that starts a looping synth and returns a stop callback. */
export type SynthLoop = (ctx: AudioContext, dest: AudioNode) => () => void
