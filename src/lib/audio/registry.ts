import type { SoundId, SoundCategory, SynthOneShot, SynthLoop } from './types'
import { synthUIHover, synthUIClick, synthUIBack, synthToggleOn, synthToggleOff } from './synthUI'
import { synthError, synthPortalSwoosh, synthPortalSwooshLong } from './synthEffects'
import { synthPortalHum } from './synthVortex'

export const SOUND_CATEGORIES: Record<SoundId, SoundCategory> = {
  ui_hover: 'sfx',
  ui_click: 'sfx',
  ui_back: 'sfx',
  ui_toggle_on: 'sfx',
  ui_toggle_off: 'sfx',
  goose_start: 'sfx',
  goose_end: 'sfx',
  error: 'sfx',
  portal_swoosh: 'sfx',
  portal_swoosh_long: 'sfx',
  portal_hum: 'sfx',
  music_menu: 'music',
  music_pause: 'music',
  music_gameplay: 'music'
}

/**
 * Map sound IDs to asset file paths (relative to the app root).
 * Leave a key absent to use the synthesizer fallback.
 *
 * Example:
 *   ui_click: new URL('../../../assets/audio/click.wav', import.meta.url).href
 */
export const SOUND_ASSETS: Partial<Record<SoundId, string>> = {
  goose_start: new URL('../../../assets/audio/goose_start.mp3', import.meta.url).href,
  goose_end: new URL('../../../assets/audio/goose_end.mp3', import.meta.url).href,
  music_menu: new URL('../../../assets/audio/music_menu.mp3', import.meta.url).href
}

/** Per-sound volume overrides for loops (0–1). */
export const SOUND_LOOP_VOLUMES: Partial<Record<SoundId, number>> = {
  portal_hum: 0.6,
  music_menu: 0.8
}

/**
 * Exclusive one-shot groups: when any sound in a group plays, all other
 * active sounds in the same group are stopped first. This prevents overlaps
 * (e.g. rapid goose toggle producing stacked honks).
 */
export const EXCLUSIVE_ONE_SHOT_GROUPS: SoundId[][] = [['goose_start', 'goose_end']]

export const SYNTH_ONE_SHOTS: Partial<Record<SoundId, SynthOneShot>> = {
  ui_hover: synthUIHover,
  ui_click: synthUIClick,
  ui_back: synthUIBack,
  ui_toggle_on: synthToggleOn,
  ui_toggle_off: synthToggleOff,
  error: synthError,
  portal_swoosh: synthPortalSwoosh,
  portal_swoosh_long: synthPortalSwooshLong
}

export const SYNTH_LOOPS: Partial<Record<SoundId, SynthLoop>> = {
  portal_hum: synthPortalHum
}
