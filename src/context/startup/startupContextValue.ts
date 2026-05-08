import { createContext, useContext } from 'react'

/**
 * The phases the local-server boot pipeline moves through on app launch.
 *
 *   unpacking      → mirroring bundled server-component files into the engine dir
 *   checking       → verifying uv / repo / dependencies are installed
 *   starting       → server process spawned; polling /health until ready
 *   ready          → server is up (or remote-server mode skips local boot)
 *   not_installed  → engine deps missing; menu opens with install affordance
 *   failed         → start crashed or health poll exhausted; menu opens with reinstall affordance
 *
 * `not_installed` and `failed` both unblock the menu — they're "we won't
 * be running a session, but the user can still navigate" terminal states.
 * Only `unpacking`, `checking`, and `starting` show the splash loader.
 */
export type StartupPhase = 'unpacking' | 'checking' | 'starting' | 'ready' | 'not_installed' | 'failed'

/** True for the phases that should keep the splash loader covering the menu. */
export const isStartupBlocking = (phase: StartupPhase): boolean =>
  phase === 'unpacking' || phase === 'checking' || phase === 'starting'

export type StartupContextValue = {
  phase: StartupPhase
  /** Populated when `phase === 'failed'` (start-engine-server threw or the
   *  server exited mid-health-poll). Consumers render this in the reinstall
   *  affordance; the same string is also written to the renderer log via
   *  the orchestrator's logger. */
  error: string | null
  /** Reinstall the engine and start the server. Used for both the
   *  first-time install (from `not_installed`) and recovery (from `failed`).
   *  Resets `phase` to `unpacking` and runs the full pipeline. */
  installAndStart: () => Promise<void>
}

export const StartupContext = createContext<StartupContextValue | null>(null)

export const useStartup = () => {
  const ctx = useContext(StartupContext)
  if (!ctx) {
    throw new Error('useStartup must be used within a StartupProvider')
  }
  return ctx
}
