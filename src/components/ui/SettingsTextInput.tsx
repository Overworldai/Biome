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
    className="w-full rounded-none cursor-text border border-[rgba(245,251,255,0.75)] bg-[rgba(8,12,20,0.28)] font-serif leading-[1.2] text-right text-[rgba(245,249,255,0.92)] outline-none appearance-none p-[0.55cqh_1.42cqh] text-[2.67cqh]"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    onBlur={onBlur}
    placeholder={placeholder}
    disabled={disabled}
  />
)

export default SettingsTextInput
