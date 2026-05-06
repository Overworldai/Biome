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

/** Mirror server-components into the engine directory: copy source-side
 *  entries in, and prune anything in the engine directory that no longer
 *  exists in source.  A plain copy is unsafe because previously-installed
 *  layouts can leave stale top-level modules behind — e.g. the
 *  great-server-refactor moved `server.py` into a `server/` package, so
 *  any pre-refactor install kept the old `server.py` shadowing the new
 *  `server/` package and failed to import.  Names in
 *  `SERVER_COMPONENT_EXCLUDES` are protected on both sides: never copied
 *  in, never pruned out (so the synced `.venv`, runtime log files, etc.
 *  survive). */
export function copyServerComponentFiles(engineDir: string): void {
  const resourceDir = getResourcePath('server-components')
  mirrorDirRecursive(resourceDir, engineDir, SERVER_COMPONENT_EXCLUDES)
  ensureEngineFont(engineDir)
}

function mirrorDirRecursive(src: string, dest: string, excludes: Set<string>): void {
  fs.mkdirSync(dest, { recursive: true })

  const srcEntries = new Map(
    fs
      .readdirSync(src, { withFileTypes: true })
      .filter((e) => !excludes.has(e.name))
      .map((e) => [e.name, e] as const)
  )

  // Prune: anything in dest that's not in srcEntries, and not in the
  // protected set, is stale and gets removed.  When the kind disagrees
  // (source is a directory, dest is a file with the same name, or vice
  // versa) the dest entry also gets pruned so the copy below can replace
  // it cleanly.
  for (const entry of fs.readdirSync(dest, { withFileTypes: true })) {
    if (excludes.has(entry.name)) continue
    const srcEntry = srcEntries.get(entry.name)
    const destPath = path.join(dest, entry.name)
    if (!srcEntry) {
      fs.rmSync(destPath, { recursive: true, force: true })
      continue
    }
    if (srcEntry.isDirectory() !== entry.isDirectory()) {
      fs.rmSync(destPath, { recursive: true, force: true })
    }
  }

  // Copy source → dest.
  for (const entry of srcEntries.values()) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      mirrorDirRecursive(srcPath, destPath, excludes)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
