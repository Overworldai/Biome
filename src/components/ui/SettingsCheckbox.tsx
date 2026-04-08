import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import { SETTINGS_CONTROL_BASE, SETTINGS_OUTLINE_HOVER } from '../../styles'
import { useUISound } from '../../hooks/useUISound'
import SettingsRow from './SettingsRow'

type SettingsCheckboxProps = {
  label: TranslationKey
  description?: TranslationKey
  checked: boolean
  onChange: (checked: boolean) => void
}

const SettingsCheckbox = ({ label, description, checked, onChange }: SettingsCheckboxProps) => {
  const { t } = useTranslation()
  const { playHover, playClick } = useUISound()

  return (
    <SettingsRow label={t(label)} hint={description && t(description)} align="start">
      <button
        type="button"
        className={`w-[3.2cqh] h-[3.2cqh] shrink-0 flex items-center justify-center cursor-pointer ${SETTINGS_CONTROL_BASE} ${SETTINGS_OUTLINE_HOVER}`}
        onMouseEnter={playHover}
        onClick={() => {
          playClick()
          onChange(!checked)
        }}
      >
        {checked && (
          <svg viewBox="0 0 16 16" fill="none" className="w-[2cqh] h-[2cqh]">
            <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
          </svg>
        )}
      </button>
    </SettingsRow>
  )
}

export default SettingsCheckbox
