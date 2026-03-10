import type { ReactNode } from 'react'
import { HEADING_BASE, SETTINGS_MUTED_TEXT } from '../../styles'

type SettingsSectionProps = {
  title: string
  description?: ReactNode
  children?: ReactNode
}

const SettingsSection = ({ title, description, children }: SettingsSectionProps) => (
  <div>
    <h2 className={`${HEADING_BASE} text-left text-text-primary text-[4.5cqh]`}>{title}</h2>
    {description != null && <p className={`${SETTINGS_MUTED_TEXT} text-left [margin:0cqh_0_0.9cqh]`}>{description}</p>}
    {children}
  </div>
)

export default SettingsSection
