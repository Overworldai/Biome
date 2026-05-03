import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT } from '../../styles'

type SettingsTextInputProps = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: TranslationKey
  /** Escape hatch for placeholders that aren't translation keys (dynamic paths, etc.). */
  rawPlaceholder?: string
  disabled?: boolean
}

const SettingsTextInput = ({
  value,
  onChange,
  onBlur,
  placeholder,
  rawPlaceholder,
  disabled
}: SettingsTextInputProps) => {
  const { t } = useTranslation()

  return (
    <input
      type="text"
      className={`
        w-full cursor-text rounded-none
        ${SETTINGS_CONTROL_BASE}
        ${SETTINGS_CONTROL_TEXT}
        appearance-none outline-none
      `}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={placeholder ? t(placeholder) : rawPlaceholder}
      disabled={disabled}
    />
  )
}

export default SettingsTextInput
