/**
 * Locale registry — the single source of truth for which locales the app supports.
 * See CONTRIBUTING.md → "Adding a new language" for how to extend this.
 *
 * Kept free of `i18next` imports/side-effects so it can be consumed from the
 * Electron main process (via `src/types/settings.ts`) without dragging the i18n
 * runtime into the Node bundle.
 */

/** Native-script display names for the language picker. Canonical locale registry — everything else is derived from these keys. */
export const LOCALE_DISPLAY_NAMES = {
  en: 'English',
  ja: '日本語',
  zh: '中文',
  he: 'עברית',
  goose: 'English (Goose)'
} as const

export type SupportedLocale = keyof typeof LOCALE_DISPLAY_NAMES

export const SUPPORTED_LOCALES = Object.keys(LOCALE_DISPLAY_NAMES) as readonly SupportedLocale[]

export const FALLBACK_LOCALE: SupportedLocale = 'en'

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return locale in LOCALE_DISPLAY_NAMES
}
