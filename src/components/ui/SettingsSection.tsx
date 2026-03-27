import type { ReactNode } from 'react'
import { HEADING_BASE, SETTINGS_MUTED_TEXT } from '../../styles'

type SettingsSectionProps = {
  title: string
  /** Short description shown below the title. Should always be phrased as a question. */
  description?: ReactNode
  children?: ReactNode
}

const SettingsSection = ({ title, description, children }: SettingsSectionProps) => (
  <div className="min-w-0">
    <h2 className={`${HEADING_BASE} text-left text-text-primary text-[4.5cqh] break-words`}>{title}</h2>
    {description != null && (
      <p className={`${SETTINGS_MUTED_TEXT} text-left whitespace-normal break-words [margin:0cqh_0_0.9cqh]`}>
        {description}
      </p>
    )}
    {children}
  </div>
)

export default SettingsSection
