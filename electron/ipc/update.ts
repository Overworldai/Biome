import { app, ipcMain } from 'electron'

const RELEASES_API_URL = 'https://api.github.com/repos/Overworldai/Biome/releases/latest'

type ParsedVersion = {
  segments: number[]
  prerelease: string | null
}

function parseVersion(input: string): ParsedVersion {
  const trimmed = input.trim().replace(/^v/i, '')
  const [corePart, prereleasePart] = trimmed.split('-', 2)
  const segments = corePart
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) && part >= 0 ? part : 0))

  return {
    segments,
    prerelease: prereleasePart?.trim() || null
  }
}

function compareVersions(a: string, b: string): number {
  const aParsed = parseVersion(a)
  const bParsed = parseVersion(b)
  const maxLen = Math.max(aParsed.segments.length, bParsed.segments.length)

  for (let i = 0; i < maxLen; i += 1) {
    const aVal = aParsed.segments[i] ?? 0
    const bVal = bParsed.segments[i] ?? 0
    if (aVal !== bVal) {
      return aVal > bVal ? 1 : -1
    }
  }

  if (!aParsed.prerelease && bParsed.prerelease) return 1
  if (aParsed.prerelease && !bParsed.prerelease) return -1
  if (!aParsed.prerelease && !bParsed.prerelease) return 0

  return (aParsed.prerelease || '').localeCompare(bParsed.prerelease || '', undefined, { sensitivity: 'base' })
}

export function registerUpdateIpc(): void {
  ipcMain.handle('check-for-app-update', async () => {
    const currentVersion = app.getVersion()

    if (!app.isPackaged) {
      return {
        current_version: currentVersion,
        latest_version: currentVersion,
        release_url: null,
        update_available: false
      }
    }

    try {
      const response = await fetch(RELEASES_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Biome/${currentVersion}`
        }
      })

      if (!response.ok) {
        throw new Error(`GitHub API request failed with HTTP ${response.status}`)
      }

      const body = (await response.json()) as {
        tag_name?: string
        html_url?: string
      }

      const latestVersion = body.tag_name?.trim() || currentVersion
      const releaseUrl = body.html_url?.trim() || null
      const updateAvailable = compareVersions(latestVersion, currentVersion) > 0

      return {
        current_version: currentVersion,
        latest_version: latestVersion,
        release_url: releaseUrl,
        update_available: updateAvailable
      }
    } catch (error) {
      console.warn('[UPDATES] Failed to check for new release:', error)
      return {
        current_version: currentVersion,
        latest_version: currentVersion,
        release_url: null,
        update_available: false
      }
    }
  })
}
