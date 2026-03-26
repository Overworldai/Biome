import SettingsButton from './SettingsButton'

type SettingsToggleOption = {
  value: string
  label: string
  disabled?: boolean
  disabledTooltip?: string
}

type SettingsToggleProps = {
  options: SettingsToggleOption[]
  value: string
  onChange: (value: string) => void
}

const SettingsToggle = ({ options, value, onChange }: SettingsToggleProps) => (
  <div className="flex">
    {options.map((option) => (
      <span key={option.value} className="flex-1" title={option.disabled ? option.disabledTooltip : undefined}>
        <SettingsButton
          variant={value === option.value ? 'primary' : 'secondary'}
          className={
            option.disabled
              ? 'flex-1 w-full opacity-55 cursor-not-allowed hover:bg-surface-btn-secondary hover:text-text-primary hover:translate-y-0'
              : 'flex-1 w-full'
          }
          onClick={() => onChange(option.value)}
          disabled={option.disabled}
          aria-disabled={option.disabled ? 'true' : undefined}
        >
          {option.label}
        </SettingsButton>
      </span>
    ))}
  </div>
)

export default SettingsToggle
