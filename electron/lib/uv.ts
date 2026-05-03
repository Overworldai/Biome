import fs from 'node:fs'
import path from 'node:path'
import { getUvDir } from './paths.js'
import { getUvBinaryName } from './platform.js'

/** Get the full path to the uv binary */
export function getUvBinaryPath(): string {
  return path.join(getUvDir(), 'bin', getUvBinaryName())
}

/** Get the common uv environment variables */
export function getUvEnvVars(): Record<string, string> {
  const uvDir = getUvDir()
  const env: Record<string, string> = {
    UV_CACHE_DIR: path.join(uvDir, 'cache'),
    UV_NO_CONFIG: '1',
    UV_PYTHON_INSTALL_DIR: path.join(uvDir, 'python_install'),
    UV_PYTHON_BIN_DIR: path.join(uvDir, 'python_bin'),
    UV_TOOL_DIR: path.join(uvDir, 'tool'),
    UV_TOOL_BIN_DIR: path.join(uvDir, 'tool_bin'),
    UV_HTTP_TIMEOUT: String(30 * 60),
    UV_LINK_MODE: 'copy',
    UV_NO_EDITABLE: '1',
    UV_MANAGED_PYTHON: '1'
  }

  // On Linux, the uv-managed Python's bundled OpenSSL reads the host's
  // OPENSSL_CONF and can crash on configs it doesn't understand (e.g. OpenSuSE
  // Tumbleweed, see Overworldai/Biome#92). Neutralise it by pointing at an
  // empty file. The AppRun wrapper also sets this, but we duplicate it here so
  // dev-mode Linux and non-AppImage Linux packages (if we add them later) get
  // the same protection.
  if (process.platform === 'linux') {
    env.OPENSSL_CONF = '/dev/null'
  }

  return env
}

/**
 * Resolve the include dir for the uv-managed Python 3.12 install, if present.
 *
 * Triton JIT-compiles CUDA launcher stubs at runtime and needs `Python.h`.
 * uv uses python-build-standalone, whose sysconfig on NixOS mis-reports the
 * include path as /run/current-system/sw/include/... — hence the workaround
 * in shell.nix. Pointing `C_INCLUDE_PATH` at the real bundled headers fixes
 * it universally (NixOS and AppImage users with distro-local gcc).
 *
 * Returns null if the python_install dir doesn't exist yet (pre-setup) or
 * doesn't match the expected layout.
 */
export function getBundledPythonIncludeDir(): string | null {
  if (process.platform === 'win32') return null

  const pythonInstallRoot = path.join(getUvDir(), 'python_install')
  if (!fs.existsSync(pythonInstallRoot)) return null

  let entries: string[]
  try {
    entries = fs.readdirSync(pythonInstallRoot)
  } catch {
    return null
  }

  // Match cpython-3.12.*-<arch>-<os>-<abi>, e.g. cpython-3.12.13-linux-x86_64-gnu.
  const match = entries.find((name) => /^cpython-3\.12\./.test(name))
  if (!match) return null

  const includeDir = path.join(pythonInstallRoot, match, 'include', 'python3.12')
  if (!fs.existsSync(path.join(includeDir, 'Python.h'))) return null

  return includeDir
}
