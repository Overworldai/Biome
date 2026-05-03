import SettingsSection from './ui/SettingsSection'
import SettingsButton from './ui/SettingsButton'
import { useTranslation } from 'react-i18next'

type WorldEngineSectionProps = {
  engineReady: boolean | null
  onFixInPlaceClick: () => void
  onTotalReinstallClick: () => void
}

const WorldEngineSection = ({ engineReady, onFixInPlaceClick, onTotalReinstallClick }: WorldEngineSectionProps) => {
  const { t } = useTranslation()

  return (
    <SettingsSection
      title="app.settings.worldEngine.title"
      rawDescription={
        <span className="inline-flex items-center gap-[0.71cqh]">
          {t('app.settings.worldEngine.description')}{' '}
          {engineReady === null ? (
            t('app.settings.worldEngine.checking')
          ) : engineReady ? (
            <>
              {t('app.settings.worldEngine.yes')}
              <span
                className="
                  inline-block h-[0.98cqh] w-[0.98cqh] rounded-full bg-[rgba(100,220,100,0.95)]
                  shadow-[0_0_5px_1px_rgba(100,220,100,0.4)]
                "
              />
            </>
          ) : (
            <>
              {t('app.settings.worldEngine.no')}
              <span
                className="
                  inline-block h-[0.98cqh] w-[0.98cqh] rounded-full bg-[rgba(255,120,80,0.95)]
                  shadow-[0_0_5px_1px_rgba(255,120,80,0.4)]
                "
              />
            </>
          )}
        </span>
      }
    >
      <div className="flex justify-start gap-[1.2cqh]">
        <SettingsButton variant="secondary" label="app.settings.worldEngine.fixInPlace" onClick={onFixInPlaceClick} />
        <SettingsButton
          variant="danger"
          label="app.settings.worldEngine.totalReinstall"
          onClick={onTotalReinstallClick}
        />
      </div>
    </SettingsSection>
  )
}

export default WorldEngineSection
