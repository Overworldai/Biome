import { useState } from 'react'
import { LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES } from '../../i18n'
import { useSettings } from '../../hooks/settingsContextValue'
import { useVolumeControls } from '../../hooks/useVolumeControls'
import type { AppLocale } from '../../types/settings'
import SettingsSection from '../ui/SettingsSection'
import SettingsSelect from '../ui/SettingsSelect'
import SettingsSlider from '../ui/SettingsSlider'
import SettingsCheckbox from '../ui/SettingsCheckbox'

type GeneralTabProps = {
  active: boolean
  menuSceneEditEnabled: boolean
  setMenuSceneEditEnabled: (enabled: boolean) => void
}

const GeneralTab = ({ active, menuSceneEditEnabled, setMenuSceneEditEnabled }: GeneralTabProps) => {
  const { settings, saveSettings } = useSettings()
  const volume = useVolumeControls()
  const [menuLocale, setMenuLocale] = useState<AppLocale>(settings.locale)

  const handleLocaleChange = (locale: AppLocale) => {
    setMenuLocale(locale)
    void saveSettings({ ...settings, locale })
  }

  return (
    <div className={active ? 'flex flex-col gap-[2.3cqh]' : 'hidden'}>
      <SettingsSection title="app.settings.language.title" description="app.settings.language.description">
        <SettingsSelect
          options={[
            { value: 'system', label: 'app.settings.language.system' },
            ...SUPPORTED_LOCALES.map((locale) => ({
              value: locale,
              rawLabel: LOCALE_DISPLAY_NAMES[locale]
            }))
          ]}
          value={menuLocale}
          onChange={(value) => handleLocaleChange(value as AppLocale)}
        />
      </SettingsSection>

      <SettingsSection title="app.settings.volume.title" description="app.settings.volume.description">
        <div className="flex flex-col gap-[1.5cqh]">
          <SettingsSlider
            min={0}
            max={100}
            value={volume.master}
            onChange={volume.setMaster}
            label="app.settings.volume.master"
            suffix={`${volume.master}%`}
          />
          <SettingsSlider
            min={0}
            max={100}
            value={volume.sfx}
            onChange={volume.setSfx}
            label="app.settings.volume.soundEffects"
            suffix={`${volume.sfx}%`}
          />
          <SettingsSlider
            min={0}
            max={100}
            value={volume.music}
            onChange={volume.setMusic}
            label="app.settings.volume.music"
            suffix={`${volume.music}%`}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="app.settings.experimental.title" description="app.settings.experimental.description">
        <SettingsCheckbox
          label="app.settings.experimental.sceneEdit"
          description="app.settings.experimental.sceneEditDescription"
          checked={menuSceneEditEnabled}
          onChange={setMenuSceneEditEnabled}
        />
      </SettingsSection>
    </div>
  )
}

export default GeneralTab
