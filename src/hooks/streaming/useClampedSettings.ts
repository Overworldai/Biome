import { useEffect, useMemo, useRef } from 'react'
import { clampToCapabilities } from '../../context/streaming/sessionConfig'
import type { ServerCapabilities } from '../../types/ipc'
import type { Settings } from '../../types/settings'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/ClampedSettings')

/** Single source of truth for "what `engine_backend` / `engine_quant`
 *  values are *actually in use* this session" — derived from the
 *  user's saved settings clamped against the server's capability
 *  matrix. Returned to consumers (the bootstrap path, the wire
 *  config builder, the lifecycle signature reducer) so each one sees
 *  the same clamped view without re-running the policy. Identical-
 *  reference when no clamp is needed: consumers using `===` on
 *  `settings` can short-circuit.
 *
 *  Persists the clamp back to disk so the menu doesn't keep
 *  prompting the user about a stale value the wire is silently
 *  fixing. The save fires at most once per capabilities reference —
 *  a new probe payload (e.g. user switched to a remote on a
 *  different platform) re-arms it; a settings change against the
 *  same matrix is a no-op.
 *
 *  Why the persistence is safe re: the lifecycle reducer: it
 *  produces a `session`-class diff on disk, but every consumer
 *  inside this provider already reads the *effective* settings, so
 *  `currentSignatures` and `lastApplied` move together when the save
 *  propagates — no spurious intentional reconnect. */
export function useClampedSettings(
  rawSettings: Settings,
  serverCapabilities: ServerCapabilities | null,
  saveSettings: (s: Settings) => Promise<unknown>
): Settings {
  const effectiveSettings = useMemo<Settings>(() => {
    const { engine_backend, engine_quant } = clampToCapabilities(rawSettings, serverCapabilities)
    // Reuse the raw reference when the clamp is a no-op — keeps
    // downstream `useEffect` deps stable so a fresh capabilities
    // probe that confirms the existing settings doesn't churn the
    // tree.
    if (engine_backend === rawSettings.engine_backend && engine_quant === rawSettings.engine_quant) {
      return rawSettings
    }
    return { ...rawSettings, engine_backend, engine_quant }
  }, [rawSettings, serverCapabilities])

  const lastSeenCapsRef = useRef<ServerCapabilities | null>(null)
  useEffect(() => {
    if (!serverCapabilities) return
    if (lastSeenCapsRef.current === serverCapabilities) return
    lastSeenCapsRef.current = serverCapabilities
    if (effectiveSettings === rawSettings) return

    log.info('Clamping stale engine settings to server capabilities', {
      from: { engine_backend: rawSettings.engine_backend, engine_quant: rawSettings.engine_quant },
      to: { engine_backend: effectiveSettings.engine_backend, engine_quant: effectiveSettings.engine_quant }
    })
    void saveSettings(effectiveSettings)
  }, [serverCapabilities, rawSettings, effectiveSettings, saveSettings])

  return effectiveSettings
}
