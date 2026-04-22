import { useEffect, useRef, useState } from 'react'
import { useSettings } from './settingsContextValue'
import type { SeedRecord } from '../types/app'

/** Managed scene ordering: a single persisted list of scene filenames in the
 *  order the user wants them presented. Reorder via `moveScene`. */
export function useSceneOrder({ seeds, isLoaded: seedsLoaded }: { seeds: SeedRecord[]; isLoaded: boolean }) {
  const { settings, isLoaded, saveSettings } = useSettings()
  const [sceneIds, setSceneIds] = useState<string[]>([])
  const hasHydratedRef = useRef(false)

  // Hydrate once settings have loaded.
  useEffect(() => {
    if (!isLoaded || hasHydratedRef.current) return

    const fromConfig = Array.isArray(settings.scene_order)
      ? settings.scene_order.filter((v): v is string => typeof v === 'string')
      : []
    setSceneIds(fromConfig)

    hasHydratedRef.current = true
  }, [isLoaded, settings.scene_order])

  // Reconcile ordering with live seeds: drop filenames that no longer exist,
  // and append seeds we haven't seen before so newly added scenes land at the
  // end of the list (preserving whatever the user has curated above).
  useEffect(() => {
    if (!isLoaded || !hasHydratedRef.current || !seedsLoaded) return

    const seedFilenames = seeds.map((s) => s.filename)
    const seedSet = new Set(seedFilenames)

    const valid = sceneIds.filter((f) => seedSet.has(f))
    const tracked = new Set(valid)
    const newlySeen = seedFilenames.filter((f) => !tracked.has(f))
    const next = [...valid, ...newlySeen]

    const changed = next.length !== sceneIds.length || next.some((f, i) => f !== sceneIds[i])
    if (changed) setSceneIds(next)
  }, [seeds, seedsLoaded, sceneIds, isLoaded])

  // Persist.
  useEffect(() => {
    if (!isLoaded || !hasHydratedRef.current) return
    const current = Array.isArray(settings.scene_order) ? settings.scene_order : []
    if (JSON.stringify(current) === JSON.stringify(sceneIds)) return
    void saveSettings({ ...settings, scene_order: sceneIds })
  }, [sceneIds, isLoaded, settings, saveSettings])

  const removeScene = (filename: string) => {
    setSceneIds((prev) => prev.filter((f) => f !== filename))
  }

  const moveScene = (filename: string, targetIdx: number) => {
    setSceneIds((prev) => {
      const without = prev.filter((f) => f !== filename)
      const clamped = Math.max(0, Math.min(targetIdx, without.length))
      return [...without.slice(0, clamped), filename, ...without.slice(clamped)]
    })
  }

  return {
    sceneIds,
    removeScene,
    moveScene
  }
}
