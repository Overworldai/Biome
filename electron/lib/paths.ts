import path from 'node:path'
import { app } from 'electron'

const WORLD_ENGINE_DIR = 'world_engine'

/** Patterns to exclude when copying server-components to the engine dir.
 * Matches directory names and file names (not full paths). */
export const SERVER_COMPONENT_EXCLUDES = new Set([
  '.venv',
  '__pycache__',
  'uv.lock',
  'server.log',
  'server-hosted.log',
  '.python-version',
  'node_modules'
])

/** Get the portable data directory.
 * AppImages are read-only squashfs mounts, so we use the directory
 * containing the .AppImage file itself instead. */
export function getExeDir(): string {
  if (process.env.APPIMAGE) {
    return path.dirname(process.env.APPIMAGE)
  }
  return path.dirname(app.getPath('exe'))
}

/** Get the engine directory (next to executable for portability) */
export function getEngineDir(): string {
  return path.join(getExeDir(), WORLD_ENGINE_DIR)
}

/** Get the .uv directory for isolated uv installation */
export function getUvDir(): string {
  return path.join(getExeDir(), '.uv')
}

/** Get the default (bundled) seeds directory — read directly from app resources */
export function getSeedsDefaultDir(): string {
  return getResourcePath('seeds')
}

/** Get the uploads (user) seeds directory — in user config dir */
export function getSeedsUploadsDir(): string {
  return path.join(getConfigDir(), 'seeds', 'uploads')
}

/** Get the generated seeds directory — images produced by Scene Authoring */
export function getSeedsGeneratedDir(): string {
  return path.join(getConfigDir(), 'seeds', 'generated')
}

/** Get the thumbnail cache directory — in user config dir */
export function getSeedsThumbnailDir(): string {
  return path.join(getConfigDir(), 'seeds', 'thumbnails')
}

/** Get the config directory (uses Electron's userData) */
export function getConfigDir(): string {
  return app.getPath('userData')
}

/** Get the HuggingFace home directory (inside engine dir) */
export function getHfHomeDir(): string {
  return path.join(getEngineDir(), '.cache', 'huggingface')
}

/** Get the HuggingFace hub cache directory */
export function getHfHubCacheDir(): string {
  return path.join(getHfHomeDir(), 'hub')
}

/**
 * Get the resource path for bundled files.
 * In dev mode, resources are relative to the project root.
 * In production, they're in process.resourcesPath.
 */
export function getResourcePath(resourceName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, resourceName)
  }
  // In dev, resources are at the project root
  return path.join(app.getAppPath(), resourceName)
}

/**
 * Get the path to a bundled font file. In packaged builds, extraResource
 * flattens fonts into the resources root; in dev, they live under `assets/`.
 */
export function getBundledFontPath(filename: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, filename)
  }
  return path.join(app.getAppPath(), 'assets', filename)
}
