import { z } from 'zod'
import { SUPPORTED_LOCALES } from '../i18n/locales'

export const ENGINE_MODES = { STANDALONE: 'standalone', SERVER: 'server' } as const
export const LOCALE_OPTIONS = ['system', ...SUPPORTED_LOCALES] as const
export const QUANT_OPTIONS = ['none', 'fp8w8a8', 'intw8a8'] as const
export type QuantOption = (typeof QUANT_OPTIONS)[number]

export type AppLocale = (typeof LOCALE_OPTIONS)[number]

export const DEFAULT_WORLD_ENGINE_MODEL = 'Overworld/Waypoint-1.5-1B'

// Port 7987 = 'O' (79) + 'W' (87) in ASCII
export const STANDALONE_PORT = 7987

/** Build an HTTP URL pointing at localhost on the given port. */
export const localhostUrl = (port: number) => `http://localhost:${port}`

/** The default standalone server URL. */
export const DEFAULT_STANDALONE_URL = localhostUrl(STANDALONE_PORT)

export const DEFAULT_PINNED_SCENES = [
  'default.jpg',
  'mountain_ruins_gun.jpg',
  'enchanted_swamp_torch.jpg',
  'shattered_cockpit_nebula.jpg',
  'sunken_city_depths.jpg'
]

export const DEFAULT_KEYBINDINGS = {
  reset_scene: 'KeyU',
  scene_edit: 'KeyQ'
} as const

export const DEFAULT_AUDIO = {
  master_volume: 1.0,
  sfx_volume: 0.5,
  music_volume: 0.3
} as const

export const settingsSchema = z.object({
  locale: z.enum(LOCALE_OPTIONS).default('system'),
  server_url: z.string().default(''),
  engine_mode: z.enum(['standalone', 'server']).default('standalone'),
  engine_model: z.string().default(DEFAULT_WORLD_ENGINE_MODEL),
  engine_quant: z.enum(QUANT_OPTIONS).default('none'),
  cap_inference_fps: z.boolean().default(true),
  custom_models: z.array(z.string()).default([]),
  mouse_sensitivity: z.number().min(0.1).max(3.0).default(1.8),
  pinned_scenes: z.array(z.string()).default(DEFAULT_PINNED_SCENES),
  keybindings: z
    .object({
      reset_scene: z.string().default('KeyU'),
      scene_edit: z.string().default('KeyQ')
    })
    .default(DEFAULT_KEYBINDINGS),
  audio: z
    .object({
      master_volume: z.number().min(0).max(1).default(DEFAULT_AUDIO.master_volume),
      sfx_volume: z.number().min(0).max(1).default(DEFAULT_AUDIO.sfx_volume),
      music_volume: z.number().min(0).max(1).default(DEFAULT_AUDIO.music_volume)
    })
    .default(DEFAULT_AUDIO),
  experimental: z
    .object({
      scene_edit_enabled: z.boolean().default(false)
    })
    .default({ scene_edit_enabled: false }),
  debug_overlays: z
    .object({
      performance_stats: z.boolean().default(false),
      input: z.boolean().default(false),
      frame_timeline: z.boolean().default(false),
      action_logging: z.boolean().default(false)
    })
    .default({ performance_stats: false, input: false, frame_timeline: false, action_logging: false })
})

export type Settings = z.infer<typeof settingsSchema>
export type EngineMode = Settings['engine_mode']
export type Keybindings = Settings['keybindings']
