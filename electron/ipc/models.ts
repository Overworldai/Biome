import { ipcMain } from 'electron'
import { getServerState } from '../lib/serverState.js'
import type { ModelInfo, PickerModel } from '../../src/types/ipc.js'
import type { EngineBackend } from '../../src/types/protocol.generated.js'

const FETCH_TIMEOUT_MS = 10000

/** Resolve the URL of the WorldEngine server to query for metadata.
 *
 *  Renderer mode → URL source:
 *    - server mode    → the user's configured `server_url` (passed in)
 *    - standalone     → the locally-managed Python process (auto-resolved)
 *
 *  Returns null when neither source is available — callers degrade to an
 *  empty response so the picker stays usable while the user is mid-install
 *  or pointing at an unreachable remote. */
function resolveServerUrl(explicit?: string): string | null {
  const trimmed = explicit?.trim()
  if (trimmed) return trimmed
  const state = getServerState()
  if (state.process && state.port) return `http://localhost:${state.port}`
  return null
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function registerModelsIpc(): void {
  ipcMain.handle('list-models', async (_event, serverUrl?: string, backend?: EngineBackend) => {
    const url = resolveServerUrl(serverUrl)
    if (!url) return []
    // The `backend` query param tells the server which subset of
    // model_types are loadable, so it can hide rows the active
    // backend can't handle. Omitted ⇒ no filter (renderer hasn't
    // settled on a backend yet — show everything).
    const qs = backend ? `?backend=${encodeURIComponent(backend)}` : ''
    const response = await fetchWithTimeout(`${url}/api/models${qs}`)
    if (!response || !response.ok) return []
    return (await response.json()) as PickerModel[]
  })

  // Bulk validate user-typed custom model ids against HuggingFace. The
  // curated `/api/models` route doesn't include arbitrary repos; this
  // tells the settings panel whether the typed id exists (so it can
  // show "model not found"), and what size to expect (so the picker
  // row aligns with curated entries). Falls open on a missing server
  // — every id comes back marked `exists: true` with an explanatory
  // `error` so the renderer doesn't conflate "we can't check right
  // now" with "this model definitely doesn't exist".
  ipcMain.handle('get-models-info', async (_event, modelIds: string[], serverUrl?: string) => {
    const deduped = Array.from(new Set(modelIds.map((id) => id.trim()).filter((id) => id.length > 0)))
    if (deduped.length === 0) return []

    const url = resolveServerUrl(serverUrl)
    if (!url) {
      return deduped.map<ModelInfo>((id) => ({
        id,
        size_bytes: null,
        exists: true,
        is_local: false,
        error: 'Server not available'
      }))
    }

    const results = await Promise.allSettled(
      deduped.map(async (id): Promise<ModelInfo> => {
        const response = await fetchWithTimeout(`${url}/api/model-info/${id}`)
        if (!response) return { id, size_bytes: null, exists: true, is_local: false, error: 'Could not reach server' }
        if (!response.ok)
          return { id, size_bytes: null, exists: true, is_local: false, error: `Server returned ${response.status}` }
        return (await response.json()) as ModelInfo
      })
    )

    return results.map<ModelInfo>((result, i) =>
      result.status === 'fulfilled'
        ? result.value
        : { id: deduped[i], size_bytes: null, exists: true, is_local: false, error: 'Fetch failed' }
    )
  })

  ipcMain.handle('delete-cached-model', async (_event, modelId: string, serverUrl?: string) => {
    const url = resolveServerUrl(serverUrl)
    if (!url) throw new Error('Cannot delete cached model: server is not running')
    const response = await fetchWithTimeout(`${url}/api/cached-model/${modelId}`, { method: 'DELETE' })
    if (!response) throw new Error('Cannot delete cached model: could not reach server')
    if (!response.ok) throw new Error(`Cannot delete cached model: server returned ${response.status}`)
  })
}
