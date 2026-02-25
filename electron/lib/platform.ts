import path from 'node:path'
import type { SpawnOptions } from 'node:child_process'

/** Get platform-specific spawn options to hide console windows on Windows */
export function getHiddenWindowOptions(): SpawnOptions {
  if (process.platform === 'win32') {
    return { windowsHide: true }
  }
  return {}
}

/** Get the uv binary name for the current platform */
export function getUvBinaryName(): string {
  return process.platform === 'win32' ? 'uv.exe' : 'uv'
}

/** Get the uv archive name for download based on platform and arch */
export function getUvArchiveName(): string {
  const platform = process.platform
  const arch = process.arch

  if (platform === 'win32') {
    return arch === 'arm64' ? 'uv-aarch64-pc-windows-msvc.zip' : 'uv-x86_64-pc-windows-msvc.zip'
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'uv-aarch64-apple-darwin.tar.gz' : 'uv-x86_64-apple-darwin.tar.gz'
  }
  // Linux
  return arch === 'arm64' ? 'uv-aarch64-unknown-linux-gnu.tar.gz' : 'uv-x86_64-unknown-linux-gnu.tar.gz'
}

/** Get the Python binary path inside a venv */
export function getVenvPythonPath(engineDir: string): string {
  if (process.platform === 'win32') {
    return path.join(engineDir, '.venv', 'Scripts', 'python.exe')
  }
  return path.join(engineDir, '.venv', 'bin', 'python')
}
