import { useEffect, useState } from 'react'
import { z } from 'zod'

const PropEntrySchema = z.object({
  slug: z.string(),
  kind: z.enum(['spawnable', 'holdable']),
  image: z.string(),
  held_image: z.string().nullable()
})

const PropManifestSchema = z.object({
  categories: z.record(z.string(), z.array(PropEntrySchema))
})

export type PropEntry = z.infer<typeof PropEntrySchema>
export type PropManifest = z.infer<typeof PropManifestSchema>

const MANIFEST_URL = 'biome-prop://serve/manifest.json'

export type PropManifestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; manifest: PropManifest }
  | { status: 'error'; message: string }

/** Fetches and caches the Scene Edit prop gallery manifest from the
 *  custom `biome-prop://` scheme registered in the main process. The
 *  manifest is the single source of truth for which props exist; the
 *  thumbnails / held viewmodels live alongside it under the same scheme
 *  (e.g. `biome-prop://serve/weapons/pistol.jpg`). */
export const usePropManifest = (): PropManifestState => {
  const [state, setState] = useState<PropManifestState>({ status: 'idle' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    fetch(MANIFEST_URL)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`manifest fetch failed: ${res.status} ${res.statusText}`)
        }
        const json: unknown = await res.json()
        return PropManifestSchema.parse(json)
      })
      .then((manifest) => {
        if (!cancelled) setState({ status: 'ready', manifest })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setState({ status: 'error', message })
      })

    return () => {
      cancelled = true
    }
  }, [])

  return state
}

/** Build the full URL for a prop image given a manifest-relative path
 *  (e.g. `weapons/pistol.jpg`). */
export const propImageUrl = (relativePath: string): string => `biome-prop://serve/${relativePath}`
