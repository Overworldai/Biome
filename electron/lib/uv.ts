import path from 'node:path'
import type { SpawnOptions } from 'node:child_process'
import { getUvDir } from './paths.js'
import { getUvBinaryName } from './platform.js'

/** Get the full path to the uv binary */
export function getUvBinaryPath(): string {
  return path.join(getUvDir(), 'bin', getUvBinaryName())
}

/** Get the common uv environment variables */
export function getUvEnvVars(): Record<string, string> {
  const uvDir = getUvDir()
  return {
    UV_CACHE_DIR: path.join(uvDir, 'cache'),
    UV_NO_CONFIG: '1',
    UV_PYTHON_INSTALL_DIR: path.join(uvDir, 'python_install'),
    UV_PYTHON_BIN_DIR: path.join(uvDir, 'python_bin'),
    UV_TOOL_DIR: path.join(uvDir, 'tool'),
    UV_TOOL_BIN_DIR: path.join(uvDir, 'tool_bin'),
    UV_HTTP_TIMEOUT: String(30 * 60)
  }
}
