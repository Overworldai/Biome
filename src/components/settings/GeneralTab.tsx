import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '../../bridge'
import { LOCALE_DISPLAY_NAMES, SUPPORTED_LOCALES } from '../../i18n'
import { useSettings } from '../../hooks/settingsContextValue'
import { useVolumeControls } from '../../hooks/useVolumeControls'
import { ENGINE_MODES, type AppLocale } from '../../types/settings'
import { SETTINGS_CONTROL_VMETRICS } from '../../styles'
import SettingsSection from '../ui/SettingsSection'
import SettingsSelect from '../ui/SettingsSelect'
import SettingsSlider from '../ui/SettingsSlider'
import SettingsCheckbox from '../ui/SettingsCheckbox'
import SettingsRow from '../ui/SettingsRow'
import SettingsTextInput from '../ui/SettingsTextInput'
import Button from '../ui/Button'
import RecordingsModal from './RecordingsModal'

type GeneralTabProps = {
  active: boolean
  menuSceneEditEnabled: boolean
  setMenuSceneEditEnabled: (enabled: boolean) => void
}

const GeneralTab = ({ active, menuSceneEditEnabled, setMenuSceneEditEnabled }: GeneralTabProps) => {
  const { t } = useTranslation()
  const { settings, saveSettings } = useSettings()
  const volume = useVolumeControls()
  const [menuLocale, setMenuLocale] = useState<AppLocale>(settings.locale)

  const recordingEnabled = settings.recording?.enabled ?? false
  const configuredDir = settings.recording?.output_dir ?? ''
  const [draftDir, setDraftDir] = useState(configuredDir)
  const [defaultDir, setDefaultDir] = useState('')
  const [showRecordingsModal, setShowRecordingsModal] = useState(false)

  // Keep the draft text input in sync with external setting changes (e.g. Browse dialog)
  useEffect(() => {
    setDraftDir(configuredDir)
  }, [configuredDir])

  useEffect(() => {
    invoke('get-default-video-dir')
      .then(setDefaultDir)
      .catch(() => null)
  }, [])

  const handleLocaleChange = (locale: AppLocale) => {
    setMenuLocale(locale)
    void saveSettings({ ...settings, locale })
  }

  const saveRecordingPatch = useCallback(
    (patch: Partial<{ enabled: boolean; output_dir: string }>) => {
      void saveSettings({
        ...settings,
        recording: {
          enabled: settings.recording?.enabled ?? false,
          output_dir: settings.recording?.output_dir ?? '',
          ...patch
        }
      })
    },
    [settings, saveSettings]
  )

  const handleBrowse = useCallback(async () => {
    const picked = await invoke('pick-video-dir', draftDir || defaultDir)
    if (!picked) return
    setDraftDir(picked)
    saveRecordingPatch({ output_dir: picked })
  }, [draftDir, defaultDir, saveRecordingPatch])

  const handleOpenRecordings = useCallback(() => {
    setShowRecordingsModal(true)
  }, [])

  const showRecording = settings.engine_mode === ENGINE_MODES.STANDALONE

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

      {showRecording && (
        <SettingsSection title="app.settings.recording.title" description="app.settings.recording.description">
          <div className="flex flex-col gap-[1cqh]">
            <SettingsCheckbox
              label="app.settings.recording.enabled"
              description="app.settings.recording.enabledDescription"
              checked={recordingEnabled}
              onChange={(v) => saveRecordingPatch({ enabled: v })}
            />
            {recordingEnabled && (
              <SettingsRow
                label={t('app.settings.recording.outputFolder')}
                hint={t('app.settings.recording.outputFolderHint')}
              >
                <div className="flex items-center gap-[0.6cqh]">
                  <div className="min-w-0 flex-1">
                    <SettingsTextInput
                      value={draftDir}
                      onChange={setDraftDir}
                      onBlur={() => {
                        if (draftDir !== configuredDir) saveRecordingPatch({ output_dir: draftDir })
                      }}
                      rawPlaceholder={defaultDir || undefined}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    autoShrinkLabel
                    label="app.settings.recording.browse"
                    className={`
                      px-[1.4cqh]
                      ${SETTINGS_CONTROL_VMETRICS}
                    `}
                    onClick={() => void handleBrowse()}
                  />
                </div>
              </SettingsRow>
            )}
            <SettingsRow
              label={t('app.settings.recording.manage')}
              hint={t('app.settings.recording.manageDescription')}
              align="start"
            >
              <Button
                variant="secondary"
                autoShrinkLabel
                label="app.buttons.open"
                className="px-[1.4cqh] py-[0.2cqh] text-[2cqh]"
                onClick={handleOpenRecordings}
              />
            </SettingsRow>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="app.settings.experimental.title" description="app.settings.experimental.description">
        <SettingsCheckbox
          label="app.settings.experimental.sceneEdit"
          description="app.settings.experimental.sceneEditDescription"
          checked={menuSceneEditEnabled}
          onChange={setMenuSceneEditEnabled}
        />
      </SettingsSection>

      {showRecordingsModal && (
        <RecordingsModal configuredDir={draftDir || defaultDir} onClose={() => setShowRecordingsModal(false)} />
      )}
    </div>
  )
}

export default GeneralTab
