export type EngineMode = 'unchosen' | 'standalone' | 'server'

export type GpuServerConfig = {
  host: string
  port: number
  use_ssl: boolean
}

export type ApiKeysConfig = {
  openai: string
  fal: string
  huggingface: string
}

export type FeaturesConfig = {
  prompt_sanitizer: boolean
  seed_generation: boolean
  engine_mode: EngineMode
  seed_gallery: boolean
  world_engine_model: string
  custom_world_models: string[]
  mouse_sensitivity: number
  pinned_scenes: string[]
}

export type AppConfig = {
  gpu_server: GpuServerConfig
  api_keys: ApiKeysConfig
  features: FeaturesConfig
}

export type SeedRecord = {
  filename: string
  is_safe: boolean
  is_default: boolean
}

export type SeedRecordWithThumbnail = SeedRecord & {
  thumbnail_base64: string | null
}

export type EngineStatus = {
  uv_installed: boolean
  repo_cloned: boolean
  dependencies_synced: boolean
  server_running: boolean
  server_port: number | null
  server_log_path: string | null
}

export type SetupStatus = 'saved' | 'error' | null
