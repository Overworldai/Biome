import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT } from '../../styles'

type SettingsTextInputProps = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: TranslationKey
  disabled?: boolean
}

const SettingsTextInput = ({ value, onChange, onBlur, placeholder, disabled }: SettingsTextInputProps) => {
  const { t } = useTranslation()

  return (
    <input
      type="text"
      className={`w-full rounded-none cursor-text ${SETTINGS_CONTROL_BASE} ${SETTINGS_CONTROL_TEXT} outline-none appearance-none`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={placeholder ? t(placeholder) : undefined}
      disabled={disabled}
    />
  )
}

export default SettingsTextInput
