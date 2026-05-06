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

import { MinisignVerifier } from '@kaito-tokyo/minisign-verify'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const APPIMAGE_DIR = resolve(root, 'build', 'appimage')
const CACHE_DIR = resolve(APPIMAGE_DIR, '.cache')
const TOOLCHAIN_DIR = resolve(APPIMAGE_DIR, 'toolchain')

// --- Pinned versions ------------------------------------------------------
// GitHub-hosted assets (linuxdeploy / appimagetool / plugin-gtk) are pinned
// by URL + SHA256 in lock-step. Bumping one means: null the hash, re-run
// this script, paste the logged value back in. A null hash skips
// verification in dev mode and hard-errors on CI.
//
// Zig is different — ziglang.org is a single host that explicitly asks CI
// not to download from it, so we fetch from the community mirror list and
// verify each tarball against the ZSF minisign public key (see
// https://ziglang.org/download/community-mirrors/). Bumping Zig only
// requires changing ZIG_VERSION; the signature is the integrity gate.

// Zig 0.16 changed the tarball naming convention from
// `zig-linux-x86_64-<ver>` to `zig-x86_64-linux-<ver>` — keep the basename
// var in sync with the archive's top-level dir for the extractor.
const ZIG_VERSION = '0.16.0'
const ZIG_TARBALL_BASENAME = `zig-x86_64-linux-${ZIG_VERSION}`

// ZSF minisign public key, from https://ziglang.org/download.
const ZIG_MINISIGN_PUBKEY = 'RWSGOq2NVecA2UPNdBUZykf1CCb147pkmdtYxgb3Ti+JO/wCYvhbAb/U'
const ZIG_MIRROR_LIST_URL = 'https://ziglang.org/download/community-mirrors.txt'
// Used only if the live mirror list fetch fails. Trimmed snapshot of the
// upstream list — only needs updating if the upstream list churns
// significantly.
const ZIG_FALLBACK_MIRRORS = [
  'https://pkg.machengine.org/zig',
  'https://zigmirror.hryx.net/zig',
  'https://ziglang.freetls.fastly.net',
  'https://zig.linus.dev/zig',
  'https://zig.squirl.dev'
]

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

// --- Zig mirror download --------------------------------------------------

async function fetchZigMirrors() {
  try {
    const response = await fetch(ZIG_MIRROR_LIST_URL)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }
    const list = (await response.text()).split('\n').filter((s) => s.length > 0)
    if (list.length === 0) {
      throw new Error('mirror list is empty')
    }
    return list
  } catch (err) {
    console.warn(`[appimage-prepare-assets] zig: mirror list fetch failed (${err.message}); using hardcoded fallback`)
    return [...ZIG_FALLBACK_MIRRORS]
  }
}

function shuffle(arr) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function verifyZigArtifact(verifier, tarballPath, sigPath, expectedFilename) {
  const result = await verifier.verifyFilepath(tarballPath, sigPath)
  if (!result.ok) return false
  // Bind the signature to the requested filename so a malicious mirror
  // can't pass off one signed tarball as another.
  const match = /^timestamp:\d+\s+file:([^\s]+)\s+hashed$/.exec(result.trustedComment)
  return match !== null && match[1] === expectedFilename
}

async function downloadAndVerifyZig(filename, destPath) {
  const sigPath = `${destPath}.minisig`
  const verifier = await MinisignVerifier.create(ZIG_MINISIGN_PUBKEY)

  if (existsSync(destPath) && existsSync(sigPath)) {
    try {
      if (await verifyZigArtifact(verifier, destPath, sigPath, filename)) {
        return
      }
      console.warn(`[appimage-prepare-assets] zig: cached signature failed re-verification, re-downloading`)
    } catch {
      // fall through to redownload
    }
  }

  const mirrors = shuffle(await fetchZigMirrors())

  const errors = []
  for (const mirror of mirrors) {
    const tarballUrl = `${mirror}/${filename}?source=biome`
    const sigUrl = `${mirror}/${filename}.minisig?source=biome`
    console.log(`[appimage-prepare-assets] zig: trying ${mirror}`)
    try {
      await download(tarballUrl, destPath)
      await download(sigUrl, sigPath)
      if (!(await verifyZigArtifact(verifier, destPath, sigPath, filename))) {
        throw new Error('signature or filename verification failed')
      }
      console.log(`[appimage-prepare-assets] zig: verified from ${mirror}`)
      return
    } catch (err) {
      errors.push(`  ${mirror}: ${err.message}`)
    }
  }

  throw new Error(`zig: every mirror failed:\n${errors.join('\n')}`)
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

  // 4. Zig toolchain — fetched from a community mirror with minisign verification.
  const zigArchiveFilename = `${ZIG_TARBALL_BASENAME}.tar.xz`
  const zigArchivePath = resolve(CACHE_DIR, zigArchiveFilename)
  await downloadAndVerifyZig(zigArchiveFilename, zigArchivePath)

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
