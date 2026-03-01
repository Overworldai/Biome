import fs from 'node:fs'
import path from 'node:path'
import { getSeedsDefaultDir, getResourcePath } from './paths.js'

const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']

/** Copy bundled default seeds to the engine seeds directory on first run */
export async function setupBundledSeeds(): Promise<void> {
  const destDir = getSeedsDefaultDir()

  // If seeds already exist, skip setup
  if (fs.existsSync(destDir)) {
    const entries = fs.readdirSync(destDir)
    if (entries.length > 0) {
      console.log(`[SEEDS] Seeds already exist at ${destDir}, skipping bundle extraction`)
      return
    }
  }

  console.log('[SEEDS] Setting up bundled seeds...')

  // Create destination directory
  fs.mkdirSync(destDir, { recursive: true })

  // Resolve bundled resource
  const resourcePath = getResourcePath('seeds')

  console.log(`[SEEDS] Copying from ${resourcePath} to ${destDir}`)

  if (!fs.existsSync(resourcePath)) {
    console.warn('[SEEDS] Bundled seeds directory not found:', resourcePath)
    return
  }

  const entries = fs.readdirSync(resourcePath)
  let count = 0

  for (const entry of entries) {
    const srcPath = path.join(resourcePath, entry)
    const stat = fs.statSync(srcPath)
    if (!stat.isFile()) continue

    const ext = path.extname(entry).slice(1).toLowerCase()
    if (!SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) continue

    const destPath = path.join(destDir, entry)
    fs.copyFileSync(srcPath, destPath)
    count++
  }

  console.log(`[SEEDS] Copied ${count} seed files to final destination`)
}
