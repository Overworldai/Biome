import fs from 'node:fs'
import path from 'node:path'
import { SERVER_COMPONENT_FILES, getResourcePath } from './paths.js'

export function copyServerComponentFiles(engineDir: string): void {
  fs.mkdirSync(engineDir, { recursive: true })
  const resourceDir = getResourcePath('server-components')
  for (const filename of SERVER_COMPONENT_FILES) {
    const srcPath = path.join(resourceDir, filename)
    const destPath = path.join(engineDir, filename)
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
