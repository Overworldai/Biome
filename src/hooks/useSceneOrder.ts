import { useEffect, useRef, useState } from 'react'
import { useSettings } from './settingsContextValue'
import type { SeedRecord } from '../types/app'

/** Managed scene ordering: pinned list + unpinned list, both persisted. */
export function useSceneOrder({ seeds, isLoaded: seedsLoaded }: { seeds: SeedRecord[]; isLoaded: boolean }) {
  const { settings, isLoaded, saveSettings } = useSettings()
  const [pinnedSceneIds, setPinnedSceneIds] = useState<string[]>([])
  const [unpinnedSceneIds, setUnpinnedSceneIds] = useState<string[]>([])
  const hasHydratedRef = useRef(false)

  // Hydrate both lists from settings (with legacy localStorage migration for pins).
  useEffect(() => {
    if (!isLoaded || hasHydratedRef.current) return

    const fromPinned = Array.isArray(settings.pinned_scenes)
      ? settings.pinned_scenes.filter((v): v is string => typeof v === 'string')
      : []
    const fromUnpinned = Array.isArray(settings.unpinned_scene_order)
      ? settings.unpinned_scene_order.filter((v): v is string => typeof v === 'string')
      : []

    if (fromPinned.length > 0 || fromUnpinned.length > 0) {
      setPinnedSceneIds(fromPinned)
      setUnpinnedSceneIds(fromUnpinned)
      hasHydratedRef.current = true
      return
    }

    // One-time migration fallback from localStorage to config persistence.
    try {
      const raw = localStorage.getItem('biome_pinned_scenes')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setPinnedSceneIds(parsed.filter((v): v is string => typeof v === 'string'))
        }
      }
    } catch {
      // Ignore malformed legacy storage.
    }

    hasHydratedRef.current = true
  }, [isLoaded, settings.pinned_scenes, settings.unpinned_scene_order])

  // Reconcile ordering with live seeds once both are ready: drop filenames
  // that no longer exist, and append new seeds to the front of the unpinned
  // list (so newly added scenes appear at the top of the unpinned group).
  useEffect(() => {
    if (!isLoaded || !hasHydratedRef.current || !seedsLoaded) return

    const pinnedSet = new Set(pinnedSceneIds)
    const seedFilenames = seeds.map((s) => s.filename)
    const seedSet = new Set(seedFilenames)

    const validPinned = pinnedSceneIds.filter((f) => seedSet.has(f))
    const validUnpinned = unpinnedSceneIds.filter((f) => seedSet.has(f) && !pinnedSet.has(f))

    const tracked = new Set([...validPinned, ...validUnpinned])
    const newlySeen = seedFilenames.filter((f) => !tracked.has(f) && !pinnedSet.has(f))
    const nextUnpinned = [...newlySeen, ...validUnpinned]

    const pinnedChanged =
      validPinned.length !== pinnedSceneIds.length || validPinned.some((f, i) => f !== pinnedSceneIds[i])
    const unpinnedChanged =
      nextUnpinned.length !== unpinnedSceneIds.length || nextUnpinned.some((f, i) => f !== unpinnedSceneIds[i])

    if (pinnedChanged) setPinnedSceneIds(validPinned)
    if (unpinnedChanged) setUnpinnedSceneIds(nextUnpinned)
  }, [seeds, seedsLoaded, pinnedSceneIds, unpinnedSceneIds, isLoaded])

  // Persist pinned.
  useEffect(() => {
    if (!isLoaded || !hasHydratedRef.current) return
    const current = Array.isArray(settings.pinned_scenes) ? settings.pinned_scenes : []
    if (JSON.stringify(current) === JSON.stringify(pinnedSceneIds)) return
    void saveSettings({ ...settings, pinned_scenes: pinnedSceneIds })
  }, [pinnedSceneIds, isLoaded, settings, saveSettings])

  // Persist unpinned.
  useEffect(() => {
    if (!isLoaded || !hasHydratedRef.current) return
    const current = Array.isArray(settings.unpinned_scene_order) ? settings.unpinned_scene_order : []
    if (JSON.stringify(current) === JSON.stringify(unpinnedSceneIds)) return
    void saveSettings({ ...settings, unpinned_scene_order: unpinnedSceneIds })
  }, [unpinnedSceneIds, isLoaded, settings, saveSettings])

  const togglePinnedScene = (filename: string) => {
    if (pinnedSceneIds.includes(filename)) {
      setPinnedSceneIds((prev) => prev.filter((f) => f !== filename))
      setUnpinnedSceneIds((prev) => [filename, ...prev.filter((f) => f !== filename)])
    } else {
      setUnpinnedSceneIds((prev) => prev.filter((f) => f !== filename))
      setPinnedSceneIds((prev) => [filename, ...prev.filter((f) => f !== filename)])
    }
  }

  const removeScene = (filename: string) => {
    setPinnedSceneIds((prev) => prev.filter((f) => f !== filename))
    setUnpinnedSceneIds((prev) => prev.filter((f) => f !== filename))
  }

  const moveScene = (filename: string, targetRegion: 'pinned' | 'unpinned', targetIdx: number) => {
    const nextPinned = pinnedSceneIds.filter((f) => f !== filename)
    const nextUnpinned = unpinnedSceneIds.filter((f) => f !== filename)

    if (targetRegion === 'pinned') {
      const clamped = Math.max(0, Math.min(targetIdx, nextPinned.length))
      nextPinned.splice(clamped, 0, filename)
    } else {
      const clamped = Math.max(0, Math.min(targetIdx, nextUnpinned.length))
      nextUnpinned.splice(clamped, 0, filename)
    }

    setPinnedSceneIds(nextPinned)
    setUnpinnedSceneIds(nextUnpinned)
  }

  return {
    pinnedSceneIds,
    unpinnedSceneIds,
    togglePinnedScene,
    removeScene,
    moveScene
  }
}
