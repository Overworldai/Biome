import { useEffect } from 'react'
import { useSettings } from '../hooks/settingsContextValue'
import i18n, { resolveLocale } from '../i18n'

const I18nSync = () => {
  const { settings } = useSettings()

  useEffect(() => {
    const nextLocale = resolveLocale(settings.locale)
    if (i18n.language !== nextLocale) {
      void i18n.changeLanguage(nextLocale)
    }
  }, [settings.locale])

  return null
}

export default I18nSync
