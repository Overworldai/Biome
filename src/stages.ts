import type { ServerStageId } from './types/protocol.generated'

/** Stages emitted only by the Electron main process during local
 *  install / setup of the Python server. The server itself never sees
 *  these — they cover the lifecycle from "checking dependencies" to
 *  "WebSocket connected" before the server's own `startup.*` stages
 *  take over. */
export type InstallerStageId =
  | 'setup.checking'
  | 'setup.uv_check'
  | 'setup.uv_download'
  | 'setup.engine'
  | 'setup.server_components'
  | 'setup.port_scan'
  | 'setup.sync_deps'
  | 'setup.verify'
  | 'setup.server_start'
  | 'setup.health_poll'
  | 'setup.connecting'

/** Union of every stage the loading UI can show. `ServerStageId` comes
 *  from the codegen; `InstallerStageId` lives here because the Electron
 *  main process is the only emitter. */
export type StageId = ServerStageId | InstallerStageId

export type LoadingStage = { id: StageId; percent: number }

/** Progress percent for each stage. `Record<StageId, number>` forces
 *  tsc to flag any new stage that doesn't have a percent here — this
 *  is the drift gate that fires when codegen adds a server stage. */
export const STAGE_PERCENTS: Record<StageId, number> = {
  // Installer (Electron-side)
  'setup.checking': 0,
  'setup.uv_check': 0,
  'setup.uv_download': 1,
  'setup.engine': 1,
  'setup.server_components': 1,
  'setup.port_scan': 2,
  'setup.sync_deps': 2,
  'setup.verify': 2,
  'setup.server_start': 3,
  'setup.health_poll': 4,
  'setup.connecting': 5,

  // Server startup (before any client connects)
  'startup.begin': 6,
  'startup.world_engine_manager': 7,
  'startup.safety_checker': 8,
  'startup.safety_ready': 9,
  'startup.ready': 10,

  // Per-session loading
  'session.waiting_for_seed': 12,
  'session.loading_model.load': 20,
  'session.loading_model.instantiate': 28,
  'session.scene_authoring.load': 38,
  'session.warmup.reset': 48,
  'session.warmup.seed': 55,
  'session.warmup.compile': 70,
  'session.init.reset': 80,
  'session.init.seed': 88,
  'session.init.frame': 95,
  'session.reset': 58, // device-error recovery, returns mid-session
  'session.ready': 100
}

export const resolveStage = (id: string): LoadingStage | undefined => {
  if (id in STAGE_PERCENTS) {
    const stageId = id as StageId
    return { id: stageId, percent: STAGE_PERCENTS[stageId] }
  }
  return undefined
}
