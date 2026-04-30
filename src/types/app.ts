/** Where a seed file lives on disk. Distinguishes bundled defaults from user
 *  uploads and Scene Authoring output — used to address the right directory
 *  when deleting, since filenames can collide across sources. */
export type SeedSource = 'default' | 'uploaded' | 'generated'

/** Seed file record returned by the Electron main process (IPC) */
export type SeedFileRecord = {
  filename: string
  source: SeedSource
  modifiedAt: number
}

/** Seed record used in the renderer with client-side safety status */
export type SeedRecord = {
  filename: string
  is_safe: boolean | null // null = not yet checked
  source: SeedSource
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

export type LoadingStage = {
  id: string
  percent: number
}
