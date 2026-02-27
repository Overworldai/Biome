import type { ReactNode } from 'react'

type SettingsSectionProps = {
  title: string
  description?: ReactNode
  children?: ReactNode
}

const SettingsSection = ({ title, description, children }: SettingsSectionProps) => (
  <div>
    <h2 className="m-0 font-serif leading-[0.95] text-right text-[rgba(247,250,255,0.96)] text-[clamp(34px,4.2cqw,52px)] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]">
      {title}
    </h2>
    {description != null && (
      typeof description === 'string' ? (
        <p className="font-serif text-right text-[rgba(238,244,252,0.66)] text-[clamp(16px,1.35cqw,22px)] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0.35cqh_0_0.8cqh]">
          {description}
        </p>
      ) : (
        description
      )
    )}
    {children}
  </div>
)

export default SettingsSection
