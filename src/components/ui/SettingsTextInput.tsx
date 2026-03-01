import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT } from '../../styles'

type SettingsTextInputProps = {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
}

const SettingsTextInput = ({ value, onChange, onBlur, placeholder, disabled }: SettingsTextInputProps) => (
  <input
    type="text"
    className={`w-full rounded-none cursor-text ${SETTINGS_CONTROL_BASE} ${SETTINGS_CONTROL_TEXT} outline-none appearance-none`}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    onBlur={onBlur}
    placeholder={placeholder}
    disabled={disabled}
  />
)

export default SettingsTextInput
