// Shared configuration constants used by both renderer and main process.
// Keep this file free of React/runtime dependencies.

// Port 7987 = 'O' (79) + 'W' (87) in ASCII
export const STANDALONE_PORT = 7987

export const DEFAULT_WORLD_ENGINE_MODEL = 'Overworld/Waypoint-1-Small'

// Engine mode: how the World Engine server should be managed.
export const ENGINE_MODES = {
  UNCHOSEN: 'unchosen',
  STANDALONE: 'standalone',
  SERVER: 'server'
} as const
