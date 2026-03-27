import SettingsButton from './SettingsButton'

type SettingsToggleProps = {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

const SettingsToggle = ({ options, value, onChange }: SettingsToggleProps) => (
  <div className="flex flex-wrap">
    {options.map((option) => (
      <SettingsButton
        key={option.value}
        variant={value === option.value ? 'primary' : 'secondary'}
        className="flex-1 min-w-[16cqh]"
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </SettingsButton>
    ))}
  </div>
)

export default SettingsToggle
