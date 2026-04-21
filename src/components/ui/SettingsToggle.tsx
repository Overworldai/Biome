import type { TranslationKey } from '../../i18n'
import SettingsButton from './SettingsButton'

type SettingsToggleProps = {
  options: { value: string; label: TranslationKey }[]
  value: string
  onChange: (value: string) => void
}

const SettingsToggle = ({ options, value, onChange }: SettingsToggleProps) => (
  <div className="flex flex-wrap">
    {options.map((option) => (
      <SettingsButton
        key={option.value}
        variant={value === option.value ? 'primary' : 'secondary'}
        label={option.label}
        className="min-w-[16cqh] flex-1"
        onClick={() => onChange(option.value)}
      />
    ))}
  </div>
)

export default SettingsToggle
