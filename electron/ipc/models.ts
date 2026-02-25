import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getHfHubCacheDir } from '../lib/paths.js'

const DEFAULT_WORLD_ENGINE_MODEL = 'Overworld/Waypoint-1-Small'
const WAYPOINT_COLLECTION_API_URL = 'https://huggingface.co/api/collections/Overworld/waypoint-1'

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

export function registerModelsIpc(): void {
  ipcMain.handle('list-waypoint-models', async () => {
    return listWaypointModels()
  })

  ipcMain.handle('list-local-waypoint-models', async () => {
    const models = await listWaypointModels()
    const hubDir = getHfHubCacheDir()

    if (!fs.existsSync(hubDir)) {
      return []
    }

    return models.filter((id) => isModelCachedInHfHub(id, hubDir))
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
}
