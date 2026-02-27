import type { ReactNode } from 'react'

type SettingsSelectProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  children: ReactNode
}

const SettingsSelect = ({ value, onChange, disabled, children }: SettingsSelectProps) => (
  <div className="menu-select-wrap border border-[rgba(245,251,255,0.75)] bg-[rgba(8,12,20,0.28)]">
    <select
      className="w-full cursor-pointer border-none bg-transparent font-serif text-[rgba(245,249,255,0.92)] outline-none appearance-none p-[0.55cqh_0.8cqw] text-[clamp(18px,1.5cqw,24px)]"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      {children}
    </select>
  </div>
)

export default SettingsSelect
