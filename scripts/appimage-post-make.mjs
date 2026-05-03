#!/usr/bin/env node

/**
 * Forge `postMake` post-processor for the Linux AppImage artifact.
 *
 * Extracts the .AppImage, runs linuxdeploy + plugin-gtk, bundles the
 * transitive dependency closure + NSS dlopen plugins, installs the Zig
 * toolchain + AppRun wrapper, and re-squashes with appimagetool.
 *
 * Assets (linuxdeploy, appimagetool, zig) must already exist under
 * build/appimage/; run scripts/appimage-prepare-assets.mjs to populate.
 */

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const APPIMAGE_DIR = resolve(root, 'build', 'appimage')
const CACHE_DIR = resolve(APPIMAGE_DIR, '.cache')
const TOOLCHAIN_DIR = resolve(APPIMAGE_DIR, 'toolchain')

const LINUXDEPLOY = resolve(CACHE_DIR, 'linuxdeploy-x86_64.AppImage')
const LINUXDEPLOY_PLUGIN_GTK = resolve(CACHE_DIR, 'linuxdeploy-plugin-gtk.sh')
const APPIMAGETOOL = resolve(CACHE_DIR, 'appimagetool-x86_64.AppImage')
const ZIG_DIR = resolve(TOOLCHAIN_DIR, 'zig')

const APPRUN_TEMPLATE = resolve(APPIMAGE_DIR, 'AppRun')
const CC_SHIM_TEMPLATE = resolve(APPIMAGE_DIR, 'cc-shim')

/** Forge hook entry point. */
export default async function postMake(makeResults) {
  if (process.platform !== 'linux') return makeResults

  for (const result of makeResults) {
    if (result.platform !== 'linux') continue
    for (const artifactPath of result.artifacts.filter((a) => a.endsWith('.AppImage'))) {
      console.log(`\n[appimage-post-make] processing ${artifactPath}`)
      rebuildAppImage(artifactPath)
    }
  }

  return makeResults
}

function rebuildAppImage(artifactPath) {
  assertTools()

  const workDir = resolve(tmpdir(), `biome-appimage-${process.pid}-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  try {
    const appDir = extractAppImage(artifactPath, workDir)
    runLinuxdeploy(appDir)
    bundleDependencyClosure(appDir)
    bundleDlopenPlugins(appDir)
    installToolchain(appDir)
    installAppRun(appDir)
    fixupDesktopEntry(appDir)
    rebuildWithAppimagetool(appDir, artifactPath)
    console.log(`[appimage-post-make] rebuilt ${artifactPath}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function assertTools() {
  const missing = []
  for (const [label, path] of [
    ['linuxdeploy', LINUXDEPLOY],
    ['linuxdeploy-plugin-gtk', LINUXDEPLOY_PLUGIN_GTK],
    ['appimagetool', APPIMAGETOOL],
    ['zig toolchain dir', ZIG_DIR],
    ['AppRun template', APPRUN_TEMPLATE],
    ['cc-shim template', CC_SHIM_TEMPLATE]
  ]) {
    if (!existsSync(path)) missing.push(`${label} (${path})`)
  }
  if (missing.length) {
    throw new Error(
      `[appimage-post-make] missing assets:\n  - ${missing.join('\n  - ')}\n` +
        `Run: node scripts/appimage-prepare-assets.mjs`
    )
  }
}

function extractAppImage(artifactPath, workDir) {
  console.log('[appimage-post-make] extracting AppImage...')
  run(artifactPath, ['--appimage-extract'], { cwd: workDir })
  return resolve(workDir, 'squashfs-root')
}

function runLinuxdeploy(appDir) {
  console.log('[appimage-post-make] running linuxdeploy...')

  const executable = findElectronExecutable(appDir)

  run(
    LINUXDEPLOY,
    ['--appdir', appDir, '--executable', executable, '--plugin', 'gtk', '--deploy-deps-only', executable],
    {
      env: {
        ...process.env,
        APPIMAGE_EXTRACT_AND_RUN: '1',
        LINUXDEPLOY_PLUGIN_GTK: LINUXDEPLOY_PLUGIN_GTK,
        DEPLOY_GTK_VERSION: '3',
        NO_APPIMAGE: '1'
      }
    }
  )
}

function findElectronExecutable(appDir) {
  for (const name of ['biome', 'Biome']) {
    const candidate = resolve(appDir, 'usr', 'bin', name)
    if (existsSync(candidate)) return candidate
  }

  // Fallback: first executable in usr/bin.
  const binDir = resolve(appDir, 'usr', 'bin')
  if (existsSync(binDir)) {
    for (const entry of readdirSync(binDir)) {
      const full = resolve(binDir, entry)
      const st = statSync(full, { throwIfNoEntry: false })
      if (st?.isFile() && (st.mode & 0o111) !== 0) return full
    }
  }

  throw new Error(`[appimage-post-make] no executable found under ${appDir}/usr/bin`)
}

/**
 * linuxdeploy's excludelist skips libs it assumes the host provides (libX11,
 * libxcb, libz, etc.). That fails on NixOS and minimal containers. Walk the
 * full dependency closure and copy anything that resolves outside the AppDir.
 * Glibc/kernel-provided libs are excluded (must match the host).
 */
function bundleDependencyClosure(appDir) {
  console.log('[appimage-post-make] bundling transitive dependency closure...')

  const libDir = resolve(appDir, 'usr', 'lib')
  const NEVER_BUNDLE = new Set([
    'ld-linux-x86-64.so.2',
    'linux-vdso.so.1',
    'libc.so.6',
    'libm.so.6',
    'libpthread.so.0',
    'libdl.so.2',
    'librt.so.1',
    'libresolv.so.2',
    'libnsl.so.1',
    'libutil.so.1',
    'libcrypt.so.1'
  ])

  const bundled = new Set(readdirSync(libDir).filter((n) => n.includes('.so')))
  const visited = new Set()
  const queue = [resolve(appDir, 'usr', 'lib', 'biome', 'biome')]
  for (const name of bundled) queue.push(resolve(libDir, name))

  const ldLibPath = `${libDir}:${resolve(appDir, 'usr', 'lib', 'biome')}`
  let addedCount = 0

  while (queue.length) {
    const file = queue.shift()
    if (visited.has(file)) continue
    visited.add(file)

    const result = spawnSync('ldd', [file], {
      encoding: 'utf-8',
      env: { ...process.env, LD_LIBRARY_PATH: ldLibPath }
    })
    if (result.status !== 0) continue

    for (const line of result.stdout.split('\n')) {
      const match = line.match(/^\s*(\S+)\s+=>\s+(\S+)/)
      if (!match) continue
      const [, soname, resolvedPath] = match

      if (NEVER_BUNDLE.has(soname)) continue
      if (bundled.has(soname)) continue
      if (resolvedPath === 'not' || !resolvedPath.startsWith('/')) continue
      if (resolvedPath.startsWith(appDir)) continue

      const dest = resolve(libDir, soname)
      try {
        cpSync(resolvedPath, dest, { dereference: true })
      } catch (err) {
        console.warn(`  [closure] failed to copy ${resolvedPath}: ${err.message}`)
        continue
      }
      spawnSync('patchelf', ['--set-rpath', '$ORIGIN', dest], { stdio: 'ignore' })
      bundled.add(soname)
      queue.push(dest)
      addedCount++
    }
  }

  console.log(`[appimage-post-make] bundled ${addedCount} additional libs`)
}

/**
 * Bundle dlopen-only plugins that ldd can't see. Currently: NSS security
 * plugins (libsoftokn3, libfreebl3, etc.) required by Chromium for
 * cert/key storage.
 */
function bundleDlopenPlugins(appDir) {
  const libDir = resolve(appDir, 'usr', 'lib')
  const NSS_DIRS = ['/usr/lib/x86_64-linux-gnu/nss', '/usr/lib64/nss']

  let count = 0
  for (const src of NSS_DIRS) {
    if (!existsSync(src)) continue
    for (const entry of readdirSync(src)) {
      if (!entry.includes('.so')) continue
      const dst = resolve(libDir, entry)
      if (existsSync(dst)) continue
      try {
        cpSync(resolve(src, entry), dst, { dereference: true })
      } catch {
        continue
      }
      spawnSync('patchelf', ['--set-rpath', '$ORIGIN', dst], { stdio: 'ignore' })
      count++
    }
  }

  if (count > 0) {
    console.log(`[appimage-post-make] bundled ${count} NSS dlopen plugins`)
  }
}

function installToolchain(appDir) {
  console.log('[appimage-post-make] installing zig toolchain + cc shims...')

  const toolchainRoot = resolve(appDir, 'toolchain')
  rmSync(toolchainRoot, { recursive: true, force: true })
  mkdirSync(toolchainRoot, { recursive: true })

  cpSync(ZIG_DIR, resolve(toolchainRoot, 'zig'), { recursive: true })
  chmodSync(resolve(toolchainRoot, 'zig', 'zig'), 0o755)

  const shimDir = resolve(toolchainRoot, 'shim')
  mkdirSync(shimDir, { recursive: true })
  const ccShim = resolve(shimDir, 'cc')
  cpSync(CC_SHIM_TEMPLATE, ccShim)
  chmodSync(ccShim, 0o755)

  for (const alias of ['gcc', 'clang', 'c++', 'g++', 'clang++', 'cxx']) {
    const target = resolve(shimDir, alias)
    rmSync(target, { force: true })
    symlinkSync('cc', target)
  }
}

function installAppRun(appDir) {
  console.log('[appimage-post-make] swapping AppRun...')
  const apprun = resolve(appDir, 'AppRun')
  rmSync(apprun, { force: true })
  cpSync(APPRUN_TEMPLATE, apprun)
  chmodSync(apprun, 0o755)
}

function fixupDesktopEntry(appDir) {
  const entries = readdirSync(appDir)
  const desktopName = entries.find((e) => e.endsWith('.desktop'))
  if (!desktopName) {
    throw new Error(`[appimage-post-make] no .desktop file at ${appDir} root`)
  }

  const desktopPath = resolve(appDir, desktopName)
  const lines = readFileSync(desktopPath, 'utf-8').split('\n')

  const hasKey = (key) => lines.some((l) => l.startsWith(`${key}=`))
  const insertions = []
  if (!hasKey('Categories')) insertions.push('Categories=Game;')
  if (!hasKey('Icon')) insertions.push('Icon=biome')

  if (insertions.length) {
    const out = []
    let inserted = false
    for (const line of lines) {
      if (!inserted && line.startsWith('X-AppImage-')) {
        out.push(...insertions)
        inserted = true
      }
      out.push(line)
    }
    if (!inserted) out.push(...insertions)
    writeFileSync(desktopPath, out.join('\n'))
    console.log(`[appimage-post-make] added to ${desktopName}: ${insertions.join(' ')}`)
  }

  const iconSource = resolve(root, 'app-icon.png')
  if (existsSync(iconSource)) {
    cpSync(iconSource, resolve(appDir, 'biome.png'))
  }
}

function rebuildWithAppimagetool(appDir, outputPath) {
  console.log('[appimage-post-make] re-squashing with appimagetool...')

  const tmpOut = `${outputPath}.rebuilt`
  rmSync(tmpOut, { force: true })

  run(APPIMAGETOOL, [appDir, tmpOut], {
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', ARCH: 'x86_64' }
  })

  rmSync(outputPath, { force: true })
  renameSync(tmpOut, outputPath)
  chmodSync(outputPath, 0o755)
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) {
    throw new Error(
      `Command failed (exit ${result.status ?? 'null'}): ${cmd} ${args.map((a) => JSON.stringify(a)).join(' ')}`
    )
  }
}
