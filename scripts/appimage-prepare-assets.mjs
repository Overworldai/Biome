#!/usr/bin/env node

/**
 * Downloads build-time assets needed for the AppImage post-processing step:
 *
 *   - linuxdeploy (ELF dep walker + AppImage assembly)
 *   - linuxdeploy-plugin-gtk (GTK3 schemas / pixbuf loaders / GIO modules)
 *   - appimagetool (re-squash modified AppDir into a final .AppImage)
 *   - zig toolchain (shipped inside the AppImage; provides `cc` for Triton)
 *
 * Idempotent: skips items that already exist in the cache. Safe to run
 * from `forge.config.ts` hooks.generateAssets on every build.
 *
 * Only runs on Linux x86_64 — other targets return early.
 */

import { createHash } from 'node:crypto'
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const APPIMAGE_DIR = resolve(root, 'build', 'appimage')
const CACHE_DIR = resolve(APPIMAGE_DIR, '.cache')
const TOOLCHAIN_DIR = resolve(APPIMAGE_DIR, 'toolchain')

// --- Pinned versions ------------------------------------------------------
// Every URL below points at an immutable reference (tagged release or commit
// SHA) rather than a moving `continuous`/`master` pointer. Bumping a version
// means updating both the URL and the matching SHA256 in lock-step: null the
// hash, re-run this script, paste the logged value back in. A null hash
// skips verification in dev mode and hard-errors on CI.

// Zig 0.16 changed the tarball naming convention from
// `zig-linux-x86_64-<ver>` to `zig-x86_64-linux-<ver>` — keep the basename
// var in sync with the archive's top-level dir for the extractor.
const ZIG_VERSION = '0.16.0'
const ZIG_TARBALL_BASENAME = `zig-x86_64-linux-${ZIG_VERSION}`
const ZIG_URL = `https://ziglang.org/download/${ZIG_VERSION}/${ZIG_TARBALL_BASENAME}.tar.xz`
const ZIG_SHA256 = '70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00'

// linuxdeploy tags alpha-YYYYMMDD-N snapshots; pin to one rather than
// `continuous` so sha256 stays stable.
const LINUXDEPLOY_VERSION = '1-alpha-20251107-1'
const LINUXDEPLOY_URL = `https://github.com/linuxdeploy/linuxdeploy/releases/download/${LINUXDEPLOY_VERSION}/linuxdeploy-x86_64.AppImage`
const LINUXDEPLOY_SHA256 = 'c20cd71e3a4e3b80c3483cef793cda3f4e990aca14014d23c544ca3ce1270b4d'

// linuxdeploy-plugin-gtk has no releases — pin by commit SHA.
const LINUXDEPLOY_PLUGIN_GTK_COMMIT = '3b67a1d1c1b0c8268f57f2bce40fe2d33d409cea'
const LINUXDEPLOY_PLUGIN_GTK_URL = `https://raw.githubusercontent.com/linuxdeploy/linuxdeploy-plugin-gtk/${LINUXDEPLOY_PLUGIN_GTK_COMMIT}/linuxdeploy-plugin-gtk.sh`
const LINUXDEPLOY_PLUGIN_GTK_SHA256 = 'b0f4cbc684a0103a9651f0955b635eaea0096b3a66c0f5a2c2aa337960375171'

// AppImage/appimagetool (modern repo; libfuse3-free static runtime).
const APPIMAGETOOL_VERSION = '1.9.1'
const APPIMAGETOOL_URL = `https://github.com/AppImage/appimagetool/releases/download/${APPIMAGETOOL_VERSION}/appimagetool-x86_64.AppImage`
const APPIMAGETOOL_SHA256 = 'ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0'

// --- Helpers --------------------------------------------------------------

function shouldRun() {
  if (process.platform !== 'linux') return false
  if (process.arch !== 'x64') {
    console.warn(`[appimage-prepare-assets] skipping: unsupported arch ${process.arch} (only x64 is supported)`)
    return false
  }
  return true
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

async function download(url, destPath) {
  console.log(`[appimage-prepare-assets] downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText} (${url})`)
  }

  mkdirSync(dirname(destPath), { recursive: true })
  const tmpPath = `${destPath}.partial`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tmpPath))
  renameSync(tmpPath, destPath)
}

async function ensureDownloaded(name, url, destPath, expectedSha256) {
  if (existsSync(destPath)) {
    if (expectedSha256) {
      const actual = await sha256File(destPath)
      if (actual !== expectedSha256) {
        console.warn(`[appimage-prepare-assets] ${name}: cached checksum mismatch, re-downloading`)
      } else {
        return
      }
    } else {
      return
    }
  }

  await download(url, destPath)
  const actual = await sha256File(destPath)
  console.log(`[appimage-prepare-assets] ${name} sha256: ${actual}`)

  if (expectedSha256) {
    if (actual !== expectedSha256) {
      throw new Error(`${name}: sha256 mismatch\n  expected ${expectedSha256}\n  got      ${actual}`)
    }
  } else if (process.env.CI) {
    // On CI, require pinned hashes — otherwise supply-chain attacks slip in.
    throw new Error(`${name}: no sha256 pinned (got ${actual}). Pin it in scripts/appimage-prepare-assets.mjs.`)
  } else {
    console.warn(`[appimage-prepare-assets] ${name}: no sha256 pinned — skipping verification (dev only)`)
  }
}

async function extractZigToDir(archivePath, targetDir, expectedChildPrefix) {
  // If the zig binary is already in place, nothing to do.
  if (existsSync(resolve(targetDir, 'zig'))) return

  const tmpDir = `${targetDir}.extract`
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true })

  // System `tar` handles xz natively across platforms; the npm `tar` package
  // is gzip-only and fails on .tar.xz with TAR_BAD_ARCHIVE.
  const result = spawnSync('tar', ['-xf', archivePath, '-C', tmpDir], { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`tar -xf ${archivePath} failed with status ${result.status}`)
  }

  const entries = readdirSync(tmpDir)
  const extracted = entries.find((e) => e.startsWith(expectedChildPrefix))
  if (!extracted) {
    throw new Error(`Extraction failed: no entry starting with "${expectedChildPrefix}" in ${tmpDir}`)
  }

  rmSync(targetDir, { recursive: true, force: true })
  renameSync(resolve(tmpDir, extracted), targetDir)
  rmSync(tmpDir, { recursive: true, force: true })
}

// --- Main -----------------------------------------------------------------

async function main() {
  if (!shouldRun()) return

  mkdirSync(CACHE_DIR, { recursive: true })
  mkdirSync(TOOLCHAIN_DIR, { recursive: true })

  // 1. linuxdeploy
  const linuxdeployPath = resolve(CACHE_DIR, 'linuxdeploy-x86_64.AppImage')
  await ensureDownloaded('linuxdeploy', LINUXDEPLOY_URL, linuxdeployPath, LINUXDEPLOY_SHA256)
  chmodSync(linuxdeployPath, 0o755)

  // 2. linuxdeploy-plugin-gtk (shell script, not an AppImage)
  const pluginGtkPath = resolve(CACHE_DIR, 'linuxdeploy-plugin-gtk.sh')
  await ensureDownloaded(
    'linuxdeploy-plugin-gtk',
    LINUXDEPLOY_PLUGIN_GTK_URL,
    pluginGtkPath,
    LINUXDEPLOY_PLUGIN_GTK_SHA256
  )
  chmodSync(pluginGtkPath, 0o755)

  // 3. appimagetool
  const appimagetoolPath = resolve(CACHE_DIR, 'appimagetool-x86_64.AppImage')
  await ensureDownloaded('appimagetool', APPIMAGETOOL_URL, appimagetoolPath, APPIMAGETOOL_SHA256)
  chmodSync(appimagetoolPath, 0o755)

  // 4. Zig toolchain
  const zigArchivePath = resolve(CACHE_DIR, `${ZIG_TARBALL_BASENAME}.tar.xz`)
  await ensureDownloaded('zig', ZIG_URL, zigArchivePath, ZIG_SHA256)

  const zigFinalDir = resolve(TOOLCHAIN_DIR, 'zig')
  await extractZigToDir(zigArchivePath, zigFinalDir, ZIG_TARBALL_BASENAME)

  console.log('[appimage-prepare-assets] assets ready:')
  console.log(`  linuxdeploy            -> ${linuxdeployPath}`)
  console.log(`  linuxdeploy-plugin-gtk -> ${pluginGtkPath}`)
  console.log(`  appimagetool           -> ${appimagetoolPath}`)
  console.log(`  zig                    -> ${zigFinalDir}/zig`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
