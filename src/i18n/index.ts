import i18n from 'i18next'
import type { ParseKeys } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from './resources'
import { FALLBACK_LOCALE, isSupportedLocale, type SupportedLocale } from './locales'

export { FALLBACK_LOCALE, LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES, type SupportedLocale } from './locales'

export type TranslationKey = ParseKeys

/**
 * Error carrying a translation key + interpolation params.
 *
 * `message` is eagerly resolved via the current i18n locale so that
 * catch sites using `err.message` still get a human-readable string.
 * Consumers with access to `t()` can re-resolve `translationKey` +
 * `translationParams` for the freshest locale.
 */
export class TranslatableError extends Error {
  readonly translationKey: TranslationKey
  readonly translationParams: Record<string, string>
  constructor(translationKey: TranslationKey, params: Record<string, string> = {}) {
    super(String(i18n.t(translationKey, { defaultValue: translationKey, ...params })))
    this.translationKey = translationKey
    this.translationParams = params
  }
}

/** Whether the given locale setting enables goose mode. */
export function isGooseMode(locale: string | null | undefined): boolean {
  return locale === 'goose'
}

export function resolveLocale(locale: string | null | undefined): SupportedLocale {
  const candidate =
    locale && locale !== 'system'
      ? locale
      : typeof navigator !== 'undefined'
        ? navigator.language.toLowerCase().split('-')[0]
        : FALLBACK_LOCALE

  return isSupportedLocale(candidate) ? candidate : FALLBACK_LOCALE
}

void i18n.use(initReactI18next).init({
  resources,
  lng: FALLBACK_LOCALE,
  fallbackLng: FALLBACK_LOCALE,
  returnObjects: true,
  interpolation: {
    escapeValue: false
  }
})

export default i18n
