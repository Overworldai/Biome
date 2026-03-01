import SettingsButton from './SettingsButton'

type SettingsToggleProps = {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

const SettingsToggle = ({ options, value, onChange }: SettingsToggleProps) => (
  <div className="flex">
    {options.map((option) => (
      <SettingsButton
        key={option.value}
        variant={value === option.value ? 'primary' : 'ghost'}
        className="flex-1"
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </SettingsButton>
    ))}
  </div>
)

export default SettingsToggle
