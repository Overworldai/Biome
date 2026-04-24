import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../hooks/settingsContextValue'
import { LOCALE_DISPLAY_NAMES, resolveLocale, SUPPORTED_LOCALES, type SupportedLocale } from '../i18n'

const TOAST_MS = 1500

/** Dev-only: `Ctrl+L` cycles through `SUPPORTED_LOCALES` and shows a small
 *  auto-dismissing toast with the new locale's native-script name. Persisted
 *  via settings so a reload keeps whatever locale was last picked. */
const DevLocaleCycler = () => {
  const { settings, saveSettings } = useSettings()
  const [toastLocale, setToastLocale] = useState<SupportedLocale | null>(null)
  const toastKeyRef = useRef(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey)) return
      if (e.code !== 'KeyL') return
      e.preventDefault()
      const current = resolveLocale(settings.locale)
      const next = SUPPORTED_LOCALES[(SUPPORTED_LOCALES.indexOf(current) + 1) % SUPPORTED_LOCALES.length]
      toastKeyRef.current += 1
      setToastLocale(next)
      void saveSettings({ ...settings, locale: next })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settings, saveSettings])

  useEffect(() => {
    if (!toastLocale) return
    const timer = window.setTimeout(() => setToastLocale(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toastLocale])

  if (!toastLocale) return null

  return (
    <div key={toastKeyRef.current} className="pointer-events-none fixed top-[3.2cqh] left-1/2 z-200 -translate-x-1/2">
      <div
        className="
          border border-white/20 bg-black/70 px-[2.1cqh] py-[0.9cqh] text-center font-serif text-[2.4cqh]
          tracking-[0.01em] text-white/90 shadow-lg backdrop-blur-sm
        "
        style={{ animation: `streamingWarningToast ${TOAST_MS}ms ease forwards` }}
      >
        {LOCALE_DISPLAY_NAMES[toastLocale]}
      </div>
    </div>
  )
}

export default DevLocaleCycler
