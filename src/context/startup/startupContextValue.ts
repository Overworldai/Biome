import { createContext, useContext } from 'react'

/**
 * The state of the local-server boot pipeline.
 *
 *   preparing      → anything between launch and ready: unpack-files, deps
 *                    check, install, port-scan, spawn, health-poll. UI shows
 *                    a single yellow "Starting World Engine…" indicator.
 *   ready          → server is up and reachable.
 *   not_installed  → engine deps missing; awaiting an explicit install action.
 *   failed         → install crashed or server died; carries the error so UI
 *                    can surface it alongside a recovery action.
 *
 * These four states are exhaustive — there is no "intentionally offline" or
 * "stale" state. In standalone mode the server is always preparing-or-ready-
 * or-broken. Server-mode collapses to `ready` immediately (no local
 * orchestration runs).
 */
export type StartupState =
  | { kind: 'preparing' }
  | { kind: 'ready' }
  | { kind: 'not_installed' }
  | { kind: 'failed'; error: string }

/** True for states where the splash overlay / "Starting…" indicator should
 *  show. Currently only `preparing`; tied to the splash dismissal logic in
 *  AppShell and to the WorldEngineSection's "starting" affordance. */
export const isStartupBlocking = (state: StartupState): boolean => state.kind === 'preparing'

/** True for states where the local server is up and engine-dependent
 *  controls (model picker, cache deletion, …) should be enabled. */
export const isStartupReady = (state: StartupState): boolean => state.kind === 'ready'

export type StartupContextValue = {
  state: StartupState
  /** Stop the running server (if any), reinstall the engine deps, and
   *  start a fresh server.
   *
   *    - `'fix'`  → re-runs `uv sync` against the existing engine dir;
   *                 cheap, fixes most "deps drifted" issues.
   *    - `'nuke'` → wipes the engine + UV directories first; expensive,
   *                 fixes stubborn cases that `'fix'` can't.
   *
   *  Used by the WorldEngineSection install/reinstall buttons and as
   *  the recovery path from `not_installed` / `failed`. The state moves
   *  through `preparing` for the duration and lands on `ready` (success)
   *  or `failed` (install or start broke). */
  reinstallEngine: (mode?: 'fix' | 'nuke') => Promise<void>
}

export const StartupContext = createContext<StartupContextValue | null>(null)

export const useStartup = () => {
  const ctx = useContext(StartupContext)
  if (!ctx) {
    throw new Error('useStartup must be used within a StartupProvider')
  }
  return ctx
}
