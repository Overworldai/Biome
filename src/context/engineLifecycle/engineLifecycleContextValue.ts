import { createContext, useContext } from 'react'
import type { EngineStatus } from '../../types/app'
import type { ServerHealthResult } from '../../types/ipc'

/**
 * High-level state of the local-server lifecycle.
 *
 *   preparing      → anything between launch and ready: unpack-files, deps
 *                    check, install, port-scan, spawn, health-poll. The
 *                    pipeline runs in the background — the menu mounts
 *                    immediately and the user can navigate while we wait.
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
export type LifecycleState =
  | { kind: 'preparing' }
  | { kind: 'ready' }
  | { kind: 'not_installed' }
  | { kind: 'failed'; error: string }

/**
 * Combined engine context. Holds:
 *
 *   - **Lifecycle state** (`state`) — the high-level, orchestrator-driven
 *     phase: preparing / ready / not_installed / failed.
 *   - **Process status** (`status`, `isReady`, `isRunning`, `serverLogPath`,
 *     `check`) — the lower-level Electron-reported view of the server.
 *     `isReady` here means "deps are installed", not "server is up";
 *     `isRunning` means "the Python process is alive". The two layers
 *     don't always agree (e.g. `state.kind === 'ready'` but `status` is
 *     stale until the next `check()`), so consumers should pick the
 *     appropriate one for their question.
 *   - **Lifecycle actions** — `reinstallEngine`, `ensureReady`,
 *     `abortReinstall`. All install / start / restart / abort goes
 *     through here; nothing else in the app spawns a server.
 */
export type EngineLifecycleContextValue = {
  /** Current high-level lifecycle state. */
  state: LifecycleState

  /** Raw engine status from Electron's `check-engine-status` IPC.
   *  Refreshed lazily — call `check()` to re-poll. */
  status: EngineStatus | null
  /** Deps check passed: uv installed + repo cloned + dependencies synced. */
  isReady: boolean
  /** Standalone Python server process is alive (per the most-recent
   *  `check-engine-status`). */
  isRunning: boolean
  serverLogPath: string | null
  /** Re-poll Electron's `check-engine-status`. */
  check: () => Promise<EngineStatus | null>
  /** Probe a server's `/health` endpoint. Returns reachability (`ok`),
   *  the server's `ServerCapabilities` payload when present, and the
   *  `launched_from_standalone` flag the settings UI uses to refuse a
   *  server-mode URL that points at a Biome-managed standalone. Used by
   *  the warm-connect flow's pre-WS reachability check. */
  probeServerHealth: (healthUrl: string, timeoutMs?: number) => Promise<ServerHealthResult>

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
   *  or `failed` (install or start broke). The resolved value is the
   *  terminal state, so callers can branch on the outcome.
   *
   *  Concurrent calls coalesce — the second caller awaits the first's
   *  pipeline rather than starting a parallel install. */
  reinstallEngine: (mode?: 'fix' | 'nuke') => Promise<LifecycleState>
  /** Atomic kill+spawn of the standalone server, against the already-
   *  installed engine. Stops the running process (no-op if not
   *  running), spawns a fresh one, polls `/health`, refreshes
   *  `isRunning` / `serverLogPath`. The state moves through `preparing`
   *  and lands on `ready` or `failed`. Concurrent calls coalesce
   *  through the same pipeline lock as the other lifecycle methods.
   *
   *  The kill and spawn are deliberately fused into one verb: the rest
   *  of the app relies on the standalone server being available for
   *  `/health`, model picker, and capability probes, so exposing a
   *  separate "stop" would invite breakage of that invariant. */
  restartServer: () => Promise<LifecycleState>
  /** Wait until the server reaches a terminal state (`ready` or `failed`)
   *  and return that state.
   *
   *  Behaviour by current state:
   *    - `ready`         → resolves immediately.
   *    - `failed`        → resolves immediately (caller decides whether to retry).
   *    - `preparing`     → awaits the in-flight pipeline.
   *    - `not_installed` → kicks off `reinstallEngine('fix')` and awaits.
   *
   *  This is the canonical entry the warm-connect flow uses to gate WS
   *  open on the server being up. */
  ensureReady: () => Promise<LifecycleState>
  /** Cancel an in-flight reinstall by triggering Electron's
   *  `abort-engine-install` IPC. */
  abortReinstall: () => Promise<void>

  /** Override the saved `engine_mode` for orchestration purposes —
   *  pass `true` to speculatively bring up the local server, `false`
   *  to tear it down, or `null` to revert to the saved setting.
   *
   *  Used by the settings menu so the user gets a working model picker
   *  while toggling the engine_mode draft, without requiring them to
   *  Save first. Clearing on unmount restores the saved-settings view.
   *
   *  No-op when the lifecycle is mid-stream — see `EngineTab`'s
   *  streaming guard for the rationale. */
  setDraftStandalone: (value: boolean | null) => void
}

export const EngineLifecycleContext = createContext<EngineLifecycleContextValue | null>(null)

export const useEngineLifecycle = () => {
  const ctx = useContext(EngineLifecycleContext)
  if (!ctx) {
    throw new Error('useEngineLifecycle must be used within an EngineLifecycleProvider')
  }
  return ctx
}
