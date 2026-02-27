type SettingsToggleProps = {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

const SettingsToggle = ({ options, value, onChange }: SettingsToggleProps) => (
  <div className="flex border border-[rgba(245,251,255,0.75)]">
    {options.map((option, i) => (
      <button
        key={option.value}
        type="button"
        className={`flex-1 cursor-pointer font-serif p-[0.55cqh_0.8cqw] text-[clamp(18px,1.7cqw,28px)] ${i < options.length - 1 ? 'border-r border-r-[rgba(245,251,255,0.5)]' : 'border-r-0'} ${value === option.value ? 'bg-[rgba(245,251,255,0.9)] text-[rgba(15,20,32,0.95)]' : 'bg-[rgba(8,12,20,0.28)] text-[rgba(245,249,255,0.92)]'}`}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
)

export default SettingsToggle
