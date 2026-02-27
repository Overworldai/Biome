import type { ReactNode } from 'react'

type SettingsSectionProps = {
  title: string
  description?: ReactNode
  children?: ReactNode
}

const SettingsSection = ({ title, description, children }: SettingsSectionProps) => (
  <div>
    <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[7.47cqh] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
      {title}
    </h2>
    {description != null && (
      <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[2.4cqh] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
        {description}
      </p>
    )}
    {children}
  </div>
)

export default SettingsSection
