import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from './resources'

export const FALLBACK_LOCALE = 'en' as const
export const SUPPORTED_LOCALES = ['en', 'ja'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export function resolveLocale(locale: string | null | undefined): SupportedLocale {
  const normalized = locale?.toLowerCase()

  if (!normalized || normalized === 'system') {
    const systemLocale = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : FALLBACK_LOCALE
    return systemLocale.startsWith('ja') ? 'ja' : FALLBACK_LOCALE
  }

  return normalized.startsWith('ja') ? 'ja' : FALLBACK_LOCALE
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
