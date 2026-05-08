import { useTranslation } from 'react-i18next'

/** Splash overlay shown during the local-server boot pipeline.
 *
 *  Subdued by design: same background slideshow the menu uses (mounted
 *  by AppShell, plays continuously underneath), wordmark + caption
 *  centred, no portal / vortex / launch button. The vortex is the
 *  central loading motif for in-session loads — using it here would
 *  blur the distinction between "starting the app" and "loading a
 *  scene". When startup completes, this layer fades out and the
 *  portal fades in; the slideshow keeps playing across the handoff.
 *
 *  `pointer-events-auto` blocks clicks on the menu chrome that's
 *  hiding behind us — without it, the still-mounted (but suppressed)
 *  portal could swallow a stray click before the splash dismisses. */
const StartupLoader = () => {
  const { t } = useTranslation()
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-[1.4cqh]">
        <h1 className="m-0 font-serif text-heading leading-[0.95] text-text-primary">{t('app.name')}</h1>
        <p className="m-0 font-mono text-[2cqh] tracking-tight text-text-muted">{t('app.startup.startingEngine')}</p>
      </div>
    </div>
  )
}

export default StartupLoader
