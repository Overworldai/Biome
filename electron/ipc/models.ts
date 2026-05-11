import { ipcMain } from 'electron'
import { getServerState } from '../lib/serverState.js'
import type { PickerModel } from '../../src/types/ipc.js'

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
  ipcMain.handle('list-models', async (_event, serverUrl?: string) => {
    const url = resolveServerUrl(serverUrl)
    if (!url) return []
    const response = await fetchWithTimeout(`${url}/api/models`)
    if (!response || !response.ok) return []
    return (await response.json()) as PickerModel[]
  })

  ipcMain.handle('delete-cached-model', async (_event, modelId: string, serverUrl?: string) => {
    const url = resolveServerUrl(serverUrl)
    if (!url) throw new Error('Cannot delete cached model: server is not running')
    const response = await fetchWithTimeout(`${url}/api/cached-model/${modelId}`, { method: 'DELETE' })
    if (!response) throw new Error('Cannot delete cached model: could not reach server')
    if (!response.ok) throw new Error(`Cannot delete cached model: server returned ${response.status}`)
  })
}
