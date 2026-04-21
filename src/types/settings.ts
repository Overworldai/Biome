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
  moveForward: 'KeyW',
  moveLeft: 'KeyA',
  moveBack: 'KeyS',
  moveRight: 'KeyD',
  jump: 'Space',
  crouch: 'ControlLeft',
  sprint: 'ShiftLeft',
  interact: 'KeyE',
  primaryFire: 'MouseLeft',
  secondaryFire: 'MouseRight',
  pauseMenu: 'Escape',
  resetScene: 'KeyU',
  sceneEdit: 'KeyQ'
} as const

export type ControlBindKey = keyof typeof DEFAULT_KEYBINDINGS

/** Shared schema for input sensitivities (mouse + gamepad). Raw value is the
 *  multiplier applied to look deltas; the settings UI maps it to a 10–100% slider. */
const sensitivitySchema = z.number().min(0.1).max(3.0).default(1.8)

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
  mouse_sensitivity: sensitivitySchema,
  gamepad_sensitivity: sensitivitySchema,
  pinned_scenes: z.array(z.string()).default(DEFAULT_PINNED_SCENES),
  keybindings: z
    .object({
      moveForward: z.string().default(DEFAULT_KEYBINDINGS.moveForward),
      moveLeft: z.string().default(DEFAULT_KEYBINDINGS.moveLeft),
      moveBack: z.string().default(DEFAULT_KEYBINDINGS.moveBack),
      moveRight: z.string().default(DEFAULT_KEYBINDINGS.moveRight),
      jump: z.string().default(DEFAULT_KEYBINDINGS.jump),
      crouch: z.string().default(DEFAULT_KEYBINDINGS.crouch),
      sprint: z.string().default(DEFAULT_KEYBINDINGS.sprint),
      interact: z.string().default(DEFAULT_KEYBINDINGS.interact),
      primaryFire: z.string().default(DEFAULT_KEYBINDINGS.primaryFire),
      secondaryFire: z.string().default(DEFAULT_KEYBINDINGS.secondaryFire),
      pauseMenu: z.string().default(DEFAULT_KEYBINDINGS.pauseMenu),
      resetScene: z.string().default(DEFAULT_KEYBINDINGS.resetScene),
      sceneEdit: z.string().default(DEFAULT_KEYBINDINGS.sceneEdit)
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
    .default({
      performance_stats: false,
      input: false,
      frame_timeline: false,
      action_logging: false
    }),
  // Video recording (standalone mode only). output_dir is user-configurable;
  // the empty-string default means "use the OS video directory + /Biome",
  // resolved at the Electron layer via resolve-video-dir.
  recording: z
    .object({
      enabled: z.boolean().default(false),
      output_dir: z.string().default('')
    })
    .default({ enabled: false, output_dir: '' })
})

export type Settings = z.infer<typeof settingsSchema>
export type EngineMode = Settings['engine_mode']
export type Keybindings = Settings['keybindings']
