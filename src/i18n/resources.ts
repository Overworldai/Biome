import en from './en'
import ja from './ja'
import zh from './zh'
import he from './he'
import goose from './goose'
import type { SupportedLocale } from './locales'

/**
 * Recursively maps an object type so that every leaf `string` becomes `string`
 * (erasing literal types) while preserving the key structure. This lets us
 * verify that ja/zh have exactly the same nested keys as en without requiring
 * identical literal string values.
 */
type KeyShape<T> = {
  [K in keyof T]: T[K] extends string ? string : KeyShape<T[K]>
}

/** All locale files must have the same key structure as en.ts (the source of truth). */
type ExpectedShape = KeyShape<typeof en>

/**
 * Keyed by `SupportedLocale` so the compiler enforces that every registered
 * locale has a corresponding translation file (and vice versa).
 */
export const resources: Record<SupportedLocale, ExpectedShape> = { en, ja, zh, he, goose }

export type TranslationResources = typeof resources
