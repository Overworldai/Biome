import type { TranslationKey } from '../../i18n'
import SettingsButton from './SettingsButton'

type SettingsToggleProps = {
  options: { value: string; label: TranslationKey }[]
  value: string
  onChange: (value: string) => void
  orientation?: 'horizontal' | 'vertical'
}

const SettingsToggle = ({ options, value, onChange, orientation = 'horizontal' }: SettingsToggleProps) => (
  <div className={orientation === 'vertical' ? 'flex flex-col' : 'flex flex-wrap'}>
    {options.map((option) => (
      <SettingsButton
        key={option.value}
        variant={value === option.value ? 'primary' : 'secondary'}
        label={option.label}
        // `py-[1.1cqh]!` overrides RawSettingsButton's default py (0.55cqh)
        // to give vertical-sidebar tabs more breathing room. The horizontal
        // mode keeps the stock padding to stay compact in an inline toggle.
        className={orientation === 'vertical' ? 'w-full py-[1.1cqh]!' : 'min-w-[16cqh] flex-1'}
        onClick={() => onChange(option.value)}
      />
    ))}
  </div>
)

export default SettingsToggle
