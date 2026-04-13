import i18n from 'i18next'
import type { ParseKeys } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from './resources'

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

export const FALLBACK_LOCALE = 'en' as const
export const SUPPORTED_LOCALES = ['en', 'ja', 'zh', 'goose', 'he'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/** Native-script display names for the language picker. Not translated — each language is always shown in its own script. */
export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  ja: '日本語',
  zh: '中文',
  goose: 'English (Goose)',
  he: 'עברית'
}

const LOCALE_MAP: Record<string, SupportedLocale> = {
  en: 'en',
  ja: 'ja',
  zh: 'zh',
  goose: 'goose',
  he: 'he'
}

/** Whether the given locale setting enables goose mode. */
export function isGooseMode(locale: string | null | undefined): boolean {
  return locale === 'goose'
}

export function resolveLocale(locale: string | null | undefined): SupportedLocale {
  if (locale && locale !== 'system') {
    return LOCALE_MAP[locale] ?? FALLBACK_LOCALE
  }

  const systemLanguage =
    typeof navigator !== 'undefined' ? navigator.language.toLowerCase().split('-')[0] : FALLBACK_LOCALE

  return LOCALE_MAP[systemLanguage] ?? FALLBACK_LOCALE
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
