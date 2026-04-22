import { ipcMain } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getHfHubCacheDir } from '../lib/paths.js'
import type { ModelInfo } from '../../src/types/ipc.js'

const DEFAULT_WORLD_ENGINE_MODEL = 'Overworld/Waypoint-1.5-1B'
const WAYPOINT_COLLECTION_API_URL = 'https://huggingface.co/api/collections/Overworld/waypoint'

type HuggingFaceCollectionItem = {
  id: string
  private?: boolean
  repoType?: string
  type?: string
}

type HuggingFaceCollectionResponse = {
  items?: HuggingFaceCollectionItem[]
}

function isModelCachedInHfHub(repoId: string, hubDir: string): boolean {
  const modelDirName = `models--${repoId.replace('/', '--')}`
  const modelDir = path.join(hubDir, modelDirName)

  if (!fs.existsSync(modelDir)) return false

  const snapshotsDir = path.join(modelDir, 'snapshots')
  if (!fs.existsSync(snapshotsDir) || !fs.statSync(snapshotsDir).isDirectory()) return false

  const entries = fs.readdirSync(snapshotsDir)
  return entries.length > 0
}

async function listWaypointModels(): Promise<string[]> {
  const response = await fetch(WAYPOINT_COLLECTION_API_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch Hugging Face collection: HTTP ${response.status}`)
  }

  const payload = (await response.json()) as HuggingFaceCollectionResponse
  const items = payload.items || []

  const models = items
    .filter((item) => !item.private)
    .filter((item) => item.repoType === 'model' || item.type === 'model')
    .map((item) => item.id)

  if (models.length === 0) {
    models.push(DEFAULT_WORLD_ENGINE_MODEL)
  }

  return models
}

function readFileIfExists(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim()
    return content || null
  } catch {
    return null
  }
}

function getHfToken(): string | null {
  // 1. HF_TOKEN env var
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN
  // 2. Deprecated HUGGING_FACE_HUB_TOKEN env var
  if (process.env.HUGGING_FACE_HUB_TOKEN) return process.env.HUGGING_FACE_HUB_TOKEN
  // 3. File at HF_TOKEN_PATH env var
  if (process.env.HF_TOKEN_PATH) {
    const token = readFileIfExists(process.env.HF_TOKEN_PATH)
    if (token) return token
  }
  // 4. File at $HF_HOME/token
  if (process.env.HF_HOME) {
    const token = readFileIfExists(path.join(process.env.HF_HOME, 'token'))
    if (token) return token
  }
  // 5. File at $XDG_CACHE_HOME/huggingface/token
  if (process.env.XDG_CACHE_HOME) {
    const token = readFileIfExists(path.join(process.env.XDG_CACHE_HOME, 'huggingface', 'token'))
    if (token) return token
  }
  // 6. File at ~/.cache/huggingface/token
  const token = readFileIfExists(path.join(os.homedir(), '.cache', 'huggingface', 'token'))
  if (token) return token

  return null
}

type HfApiSibling = { rfilename: string; size?: number; blobId?: string }
type HfApiResponse = {
  siblings?: HfApiSibling[]
}

const EXCLUDED_SAFETENSOR_BASENAMES = new Set(['diffusion_pytorch_model.safetensors'])

function extractSizeBytes(info: HfApiResponse): number | null {
  if (!info.siblings) return null
  const safetensorFiles = info.siblings.filter(
    (s) =>
      s.rfilename.endsWith('.safetensors') &&
      s.size != null &&
      !EXCLUDED_SAFETENSOR_BASENAMES.has(path.basename(s.rfilename))
  )
  if (safetensorFiles.length === 0) return null
  // Deduplicate by blobId to avoid counting symlinked files twice
  const seen = new Set<string>()
  let total = 0
  for (const s of safetensorFiles) {
    const key = s.blobId ?? s.rfilename
    if (!seen.has(key)) {
      seen.add(key)
      total += s.size ?? 0
    }
  }
  return total
}

async function getModelInfoFromHf(modelId: string): Promise<ModelInfo> {
  try {
    const token = getHfToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const response = await fetch(`https://huggingface.co/api/models/${modelId}?blobs=true`, {
      headers
    })

    if (response.status === 404) {
      return { id: modelId, size_bytes: null, exists: false, error: 'Model not found' }
    }
    if (response.status === 401 || response.status === 403) {
      return { id: modelId, size_bytes: null, exists: true, error: 'Private or gated model' }
    }
    if (!response.ok) {
      return { id: modelId, size_bytes: null, exists: true, error: 'Could not check model' }
    }

    const info = (await response.json()) as HfApiResponse
    return {
      id: modelId,
      size_bytes: extractSizeBytes(info),
      exists: true,
      error: null
    }
  } catch {
    return { id: modelId, size_bytes: null, exists: true, error: 'Could not check model' }
  }
}

async function getModelInfoFromServer(serverUrl: string, modelId: string): Promise<ModelInfo> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(`${serverUrl}/api/model-info/${modelId}`, {
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (!response.ok) {
      return { id: modelId, size_bytes: null, exists: true, error: `Server returned ${response.status}` }
    }
    return (await response.json()) as ModelInfo
  } catch {
    return { id: modelId, size_bytes: null, exists: true, error: 'Could not reach server' }
  }
}

function deleteCachedModel(repoId: string): void {
  const hubDir = getHfHubCacheDir()
  const modelDirName = `models--${repoId.replace('/', '--')}`
  const modelDir = path.join(hubDir, modelDirName)

  if (!fs.existsSync(modelDir)) return

  // HF hub cache uses symlinks inside snapshots/ that point to ../blobs/.
  // Removing the whole model directory (blobs + snapshots + refs) is safe
  // because each model gets its own isolated directory.
  fs.rmSync(modelDir, { recursive: true, force: true })
}

export function registerModelsIpc(): void {
  ipcMain.handle('list-waypoint-models', async () => {
    return listWaypointModels()
  })

  ipcMain.handle('list-model-availability', async (_event, modelIds: string[]) => {
    const hubDir = getHfHubCacheDir()

    const seen = new Set<string>()
    const deduped = modelIds.map((id) => id.trim()).filter((id) => id.length > 0 && !seen.has(id) && seen.add(id))

    if (deduped.length === 0) {
      return []
    }

    if (!fs.existsSync(hubDir)) {
      return deduped.map((id) => ({ id, is_local: false }))
    }

    return deduped.map((id) => ({
      id,
      is_local: isModelCachedInHfHub(id, hubDir)
    }))
  })

  ipcMain.handle('get-models-info', async (_event, modelIds: string[], serverUrl?: string) => {
    const seen = new Set<string>()
    const deduped = modelIds.map((id) => id.trim()).filter((id) => id.length > 0 && !seen.has(id) && seen.add(id))

    if (deduped.length === 0) return []

    const results = await Promise.allSettled(
      deduped.map((id) => (serverUrl ? getModelInfoFromServer(serverUrl, id) : getModelInfoFromHf(id)))
    )

    return results.map((result, i) =>
      result.status === 'fulfilled'
        ? result.value
        : { id: deduped[i], size_bytes: null, exists: true, error: 'Fetch failed' }
    )
  })

  ipcMain.handle('delete-cached-model', (_event, modelId: string) => {
    deleteCachedModel(modelId)
  })
}
