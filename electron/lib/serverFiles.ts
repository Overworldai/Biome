import fs from 'node:fs'
import path from 'node:path'
import { SERVER_COMPONENT_EXCLUDES, getBundledFontPath, getResourcePath } from './paths.js'

/** Place the bundled Salernomi J font at `<engineDir>/fonts/9SALERNO.TTF` so
 *  the Python recorder can locate it via `Path(__file__).parent / "fonts"`.
 *  Called alongside copyServerComponentFiles and again on engine-file checks
 *  so upgrades from older installs pick up the font without a full reinstall. */
export function ensureEngineFont(engineDir: string): void {
  const fontsDir = path.join(engineDir, 'fonts')
  fs.mkdirSync(fontsDir, { recursive: true })
  fs.copyFileSync(getBundledFontPath('9SALERNO.TTF'), path.join(fontsDir, '9SALERNO.TTF'))
}

/** Recursively copy server-components to the engine directory, skipping excluded entries. */
export function copyServerComponentFiles(engineDir: string): void {
  const resourceDir = getResourcePath('server-components')
  copyDirRecursive(resourceDir, engineDir, SERVER_COMPONENT_EXCLUDES)
  ensureEngineFont(engineDir)
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
