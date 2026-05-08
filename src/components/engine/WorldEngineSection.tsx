import { useTranslation } from 'react-i18next'
import { useStartup } from '../../context/startup/startupContextValue'
import { SETTINGS_MUTED_TEXT } from '../../styles'
import SettingsSection from '../ui/SettingsSection'
import SettingsButton from '../ui/SettingsButton'

type WorldEngineSectionProps = {
  /** Open the install-log modal so the user can watch progress while
   *  `reinstallEngine` runs. EngineTab owns the modal and the confirm
   *  flow that decides between `'fix'` and `'nuke'` modes. */
  onFixInPlaceClick: () => void
  onTotalReinstallClick: () => void
  onInstallClick: () => void
}

/** Status indicator + install/repair affordance for the standalone-managed
 *  engine. The visible CTA depends on the current StartupState:
 *
 *    preparing      → "Starting…", yellow dot, no buttons.
 *    ready          → "Ready", green dot, Fix In Place + Total Reinstall.
 *    not_installed  → "Not installed", red dot, single Install CTA.
 *    failed         → "Failed (error)", red dot, single Reinstall CTA.
 *
 *  The user can reach this view at any phase (the splash is dismissable
 *  by design now), so the dot acts as the at-a-glance state signal. */
const WorldEngineSection = ({ onFixInPlaceClick, onTotalReinstallClick, onInstallClick }: WorldEngineSectionProps) => {
  const { t } = useTranslation()
  const { state } = useStartup()

  const dot = (() => {
    switch (state.kind) {
      case 'ready':
        return (
          <span
            className="
              inline-block h-[0.98cqh] w-[0.98cqh] rounded-full bg-[rgba(100,220,100,0.95)]
              shadow-[0_0_5px_1px_rgba(100,220,100,0.4)]
            "
          />
        )
      case 'preparing':
        return (
          <span
            className="
              inline-block h-[0.98cqh] w-[0.98cqh] rounded-full bg-[rgba(240,200,80,0.95)]
              shadow-[0_0_5px_1px_rgba(240,200,80,0.4)]
            "
          />
        )
      default:
        return (
          <span
            className="
              inline-block h-[0.98cqh] w-[0.98cqh] rounded-full bg-[rgba(255,120,80,0.95)]
              shadow-[0_0_5px_1px_rgba(255,120,80,0.4)]
            "
          />
        )
    }
  })()

  const statusLabel = (() => {
    switch (state.kind) {
      case 'ready':
        return t('app.settings.worldEngine.ready')
      case 'preparing':
        return t('app.settings.worldEngine.starting')
      case 'not_installed':
        return t('app.settings.worldEngine.notInstalled')
      case 'failed':
        return t('app.settings.worldEngine.failed')
    }
  })()

  return (
    <SettingsSection
      title="app.settings.worldEngine.title"
      rawDescription={
        <span className="inline-flex items-center gap-[0.71cqh]">
          {t('app.settings.worldEngine.description')} {statusLabel}
          {dot}
        </span>
      }
    >
      <div className="flex flex-col gap-[0.25cqh]">
        {state.kind === 'ready' && (
          <div className="flex justify-start gap-[1.2cqh]">
            <SettingsButton
              variant="secondary"
              label="app.settings.worldEngine.fixInPlace"
              onClick={onFixInPlaceClick}
            />
            <SettingsButton
              variant="danger"
              label="app.settings.worldEngine.totalReinstall"
              onClick={onTotalReinstallClick}
            />
          </div>
        )}
        {state.kind === 'not_installed' && (
          <>
            <SettingsButton
              variant="primary"
              label="app.settings.worldEngine.install"
              onClick={onInstallClick}
              className="w-full"
            />
            <p
              className={`
                ${SETTINGS_MUTED_TEXT}
                m-0
              `}
            >
              {t('app.settings.worldEngine.notInstalledNote')}
            </p>
          </>
        )}
        {state.kind === 'failed' && (
          <>
            <SettingsButton
              variant="primary"
              label="app.settings.worldEngine.reinstall"
              onClick={onInstallClick}
              className="w-full"
            />
            <p
              className={`
                ${SETTINGS_MUTED_TEXT}
                m-0
              `}
            >
              {state.error}
            </p>
          </>
        )}
      </div>
    </SettingsSection>
  )
}

export default WorldEngineSection
