import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../../bridge'
import { buildSessionConfig } from '../../context/streaming/sessionConfig'
import type { PortalState } from '../../context/portal/portalStateMachine'
import type { InitRequest, InitResponseData } from '../../types/protocol.generated'
import { DEFAULT_WORLD_ENGINE_MODEL, type Settings } from '../../types/settings'
import { createLogger } from '../../utils/logger'

const log = createLogger('Streaming/Session')

type SendInit = (params: Omit<InitRequest, 'type' | 'req_id'>) => Promise<InitResponseData>

/** The wire-side session-bootstrap concern: send the initial
 *  `InitRequest` after the WebSocket opens, re-send it whenever a
 *  live-toggleable setting changes mid-stream, and let the user pick a
 *  fresh seed. Owns three internal refs:
 *
 *  - `lastSeedRef`: the most-recently-loaded seed (filename + base64)
 *    so we can resume with the same seed across reconnects without
 *    re-loading the IPC blob.
 *  - `lastAppliedModelRef`: the model+quant+scene-authoring key the
 *    server is currently configured for. Surfaced via
 *    `lastAppliedModel` so the lifecycle machine can detect a settings
 *    change that requires an intentional reconnect.
 *  - `warmBootstrapSentRef`: an idempotency guard so the bootstrap
 *    effect runs once per LOADING → connected transition.
 *
 *  `resetSession()` clears the bootstrap guard and the applied model;
 *  the lifecycle effects fire it on intentional reconnect and on
 *  teardown so the next LOADING entry starts from a clean slate. */
export function useSessionInit(opts: {
  portalState: PortalState
  loadingState: PortalState
  isConnected: boolean
  isStreaming: boolean
  isStandaloneMode: boolean
  settings: Settings
  sendInit: SendInit
  applyInitResponse: (metrics: InitResponseData) => void
  setPlaceholderFrame: (frame: Blob | string | null) => void
}): {
  selectSeed: (filename: string) => Promise<void>
  lastAppliedModel: string | null
  resetSession: () => void
} {
  const {
    portalState,
    loadingState,
    isConnected,
    isStreaming,
    isStandaloneMode,
    settings,
    sendInit,
    applyInitResponse,
    setPlaceholderFrame
  } = opts

  const lastSeedRef = useRef<{ filename: string; imageData: string } | null>(null)
  const warmBootstrapSentRef = useRef(false)
  const [lastAppliedModel, setLastAppliedModel] = useState<string | null>(null)

  // Read-latest settings without depending on the whole settings object —
  // the live re-apply effect is keyed on a small subset and reads the
  // rest at call-time so e.g. typing in a settings text field doesn't
  // re-fire the init.
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // Bootstrap each new LOADING websocket session deterministically:
  // send model + seed together so server applies model first and can load seed
  // immediately when model load completes.
  useEffect(() => {
    if (portalState !== loadingState) return
    if (!isConnected) return
    if (warmBootstrapSentRef.current) return
    warmBootstrapSentRef.current = true

    const selectedModel = settings?.engine_model || DEFAULT_WORLD_ENGINE_MODEL
    const seedFilename = lastSeedRef.current?.filename ?? 'default.jpg'
    log.info('Loading connected - bootstrapping session with model+seed:', selectedModel, seedFilename)

    const bootstrap = async () => {
      let imageData = lastSeedRef.current?.imageData
      if (!imageData) {
        const result = await invoke('get-seed-image-base64', seedFilename)
        if (result) {
          imageData = result.base64
          lastSeedRef.current = { filename: seedFilename, imageData }
        }
      }

      if (imageData) {
        const binary = atob(imageData)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        setPlaceholderFrame(new Blob([bytes], { type: 'image/jpeg' }))
      }

      // Set lastAppliedModel before await so the lifecycle machine doesn't
      // see a model mismatch during the re-render triggered by applyInitResponse.
      const quant = settings.engine_quant ?? 'none'
      setLastAppliedModel(
        settings.scene_authoring_enabled ? `${selectedModel}+scene_authoring+${quant}` : `${selectedModel}+${quant}`
      )

      // App version — embedded into recording metadata so MP4s carry a
      // self-describing record of what Biome build produced them. Best-effort;
      // a fetch failure just omits the field from the metadata.
      const diag = await invoke('get-runtime-diagnostics-meta').catch(() => null)
      const biomeVersion = diag?.app_version

      const config = await buildSessionConfig(settings, isStandaloneMode)
      const metrics = await sendInit({
        model: selectedModel,
        config,
        seed_image_data: imageData,
        seed_filename: seedFilename,
        biome_version: biomeVersion
      })
      applyInitResponse(metrics)
    }

    bootstrap().catch((err) => log.error('Bootstrap failed:', err))
  }, [
    portalState,
    loadingState,
    isConnected,
    isStandaloneMode,
    settings,
    sendInit,
    applyInitResponse,
    setPlaceholderFrame
  ])

  // Reset the bootstrap guard + placeholder when the WS closes so the
  // next reconnect will re-bootstrap.
  useEffect(() => {
    if (!isConnected) {
      warmBootstrapSentRef.current = false
      setPlaceholderFrame(null)
    }
  }, [isConnected, setPlaceholderFrame])

  // Live re-apply of the session config during streaming. Any change to
  // a live-toggleable SessionConfig field (action logging, video
  // recording, inference cap) re-sends the full config; the server diffs
  // against current state and applies whatever differs without tearing
  // the session down. Model / quant / scene-authoring changes can't be
  // hot-swapped — those trigger a full lifecycle reconnect instead, so
  // they're deliberately not in this dep list to avoid racing the
  // reconnect with a stale-state init send.
  useEffect(() => {
    if (!isStreaming || !isConnected) return
    const run = async () => {
      const current = settingsRef.current
      const config = await buildSessionConfig(current, isStandaloneMode)
      await sendInit({
        model: current.engine_model || DEFAULT_WORLD_ENGINE_MODEL,
        config
      })
    }
    run().catch((err) => log.error('Failed to re-apply session config:', err))
  }, [
    isStreaming,
    isConnected,
    isStandaloneMode,
    settings.debug_overlays?.action_logging,
    settings.recording?.enabled,
    settings.recording?.output_dir,
    settings.cap_inference_fps,
    sendInit
  ])

  const selectSeed = useCallback(
    async (filename: string) => {
      const result = await invoke('get-seed-image-base64', filename)
      if (!result) return
      lastSeedRef.current = { filename, imageData: result.base64 }
      const config = await buildSessionConfig(settingsRef.current, isStandaloneMode)
      const metrics = await sendInit({
        model: settingsRef.current.engine_model || DEFAULT_WORLD_ENGINE_MODEL,
        config,
        seed_image_data: result.base64,
        seed_filename: filename
      })
      applyInitResponse(metrics)
    },
    [sendInit, applyInitResponse, isStandaloneMode]
  )

  const resetSession = useCallback(() => {
    warmBootstrapSentRef.current = false
    setLastAppliedModel(null)
  }, [])

  return { selectSeed, lastAppliedModel, resetSession }
}
