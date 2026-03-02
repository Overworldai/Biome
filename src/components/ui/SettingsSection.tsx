import type { ReactNode } from 'react'
import { HEADING_BASE, SETTINGS_MUTED_TEXT } from '../../styles'

type SettingsSectionProps = {
  title: string
  description?: ReactNode
  children?: ReactNode
}

const SettingsSection = ({ title, description, children }: SettingsSectionProps) => (
  <div>
    <h2
      className={`${HEADING_BASE} text-right text-[rgba(247,250,255,0.96)] text-[7.47cqh] [text-shadow:0_0_12px_rgba(0,0,0,0.32),0_1px_2px_rgba(0,0,0,0.45)]`}
    >
      {title}
    </h2>
    {description != null && (
      <p className={`${SETTINGS_MUTED_TEXT} text-right [text-shadow:0_1px_2px_rgba(0,0,0,0.5)] [margin:0cqh_0_0.8cqh]`}>
        {description}
      </p>
    )}
    {children}
  </div>
)

export default SettingsSection
