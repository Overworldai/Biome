import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from './resources'

export const FALLBACK_LOCALE = 'en' as const
export const SUPPORTED_LOCALES = ['en', 'ja', 'zh'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

const LOCALE_MAP: Record<string, SupportedLocale> = {
  en: 'en',
  ja: 'ja',
  zh: 'zh'
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
  interpolation: {
    escapeValue: false
  }
})

export default i18n
