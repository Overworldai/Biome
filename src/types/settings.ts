import { z } from 'zod'

export const ENGINE_MODES = { STANDALONE: 'standalone', SERVER: 'server' } as const

export const DEFAULT_WORLD_ENGINE_MODEL = 'Overworld/Waypoint-1-Small'

// Port 7987 = 'O' (79) + 'W' (87) in ASCII
export const STANDALONE_PORT = 7987

/** Build an HTTP URL pointing at localhost on the given port. */
export const localhostUrl = (port: number) => `http://localhost:${port}`

/** The default standalone server URL. */
export const DEFAULT_STANDALONE_URL = localhostUrl(STANDALONE_PORT)

export const DEFAULT_PINNED_SCENES = [
  'default.png',
  'starter_2.png',
  'starter_3.png',
  'sample_00032.png',
  'sample_00046.png'
]

export const settingsSchema = z.object({
  server_url: z.string().default(DEFAULT_STANDALONE_URL),
  engine_mode: z.enum(['standalone', 'server']).default('standalone'),
  engine_model: z.string().default(DEFAULT_WORLD_ENGINE_MODEL),
  mouse_sensitivity: z.number().min(0.1).max(3.0).default(1.0),
  pinned_scenes: z.array(z.string()).default(DEFAULT_PINNED_SCENES)
})

export type Settings = z.infer<typeof settingsSchema>
export type EngineMode = Settings['engine_mode']
