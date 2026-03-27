import fs from 'node:fs'
import path from 'node:path'
import { SERVER_COMPONENT_EXCLUDES, getResourcePath } from './paths.js'

/** Recursively copy server-components to the engine directory, skipping excluded entries. */
export function copyServerComponentFiles(engineDir: string): void {
  const resourceDir = getResourcePath('server-components')
  copyDirRecursive(resourceDir, engineDir, SERVER_COMPONENT_EXCLUDES)
}

function copyDirRecursive(src: string, dest: string, excludes: Set<string>): void {
  fs.mkdirSync(dest, { recursive: true })

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (excludes.has(entry.name)) continue

    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, excludes)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
