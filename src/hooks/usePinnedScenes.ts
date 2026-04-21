import { useEffect, useRef, useState } from 'react'
import { useSettings } from './settingsContextValue'

export function usePinnedScenes() {
  const { settings, isLoaded, saveSettings } = useSettings()
  const [pinnedSceneIds, setPinnedSceneIds] = useState<string[]>([])
  const hasHydratedPinnedRef = useRef(false)

  useEffect(() => {
    if (!isLoaded || hasHydratedPinnedRef.current) return

    const fromConfig = Array.isArray(settings.pinned_scenes)
      ? settings.pinned_scenes.filter((value) => typeof value === 'string')
      : []

    if (fromConfig.length > 0) {
      setPinnedSceneIds(fromConfig)
      hasHydratedPinnedRef.current = true
      return
    }

    // One-time migration fallback from localStorage to config persistence.
    try {
      const raw = localStorage.getItem('biome_pinned_scenes')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const migrated = parsed.filter((value) => typeof value === 'string')
          setPinnedSceneIds(migrated)
        }
      }
    } catch {
      // Ignore malformed legacy storage.
    }

    hasHydratedPinnedRef.current = true
  }, [isLoaded, settings.pinned_scenes])

  useEffect(() => {
    if (!isLoaded || !hasHydratedPinnedRef.current) return

    const currentPinned = Array.isArray(settings.pinned_scenes) ? settings.pinned_scenes : []
    const nextPinned = pinnedSceneIds

    if (JSON.stringify(currentPinned) === JSON.stringify(nextPinned)) return

    void saveSettings({
      ...settings,
      pinned_scenes: nextPinned
    })
  }, [pinnedSceneIds, isLoaded, settings, saveSettings])

  const togglePinnedScene = (filename: string) => {
    setPinnedSceneIds((prev) => {
      if (prev.includes(filename)) {
        return prev.filter((id) => id !== filename)
      }
      return [filename, ...prev]
    })
  }

  const removePinnedScene = (filename: string) => {
    setPinnedSceneIds((prev) => prev.filter((id) => id !== filename))
  }

  return {
    pinnedSceneIds,
    togglePinnedScene,
    removePinnedScene
  }
}
