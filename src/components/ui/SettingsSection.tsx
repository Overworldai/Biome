import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import { HEADING_BASE, SETTINGS_MUTED_TEXT } from '../../styles'

type SettingsSectionProps = {
  title: TranslationKey
  /** Short description shown below the title. Should always be phrased as a question. */
  description?: TranslationKey
  /** Escape hatch for descriptions that contain JSX or dynamic content. */
  rawDescription?: ReactNode
  children?: ReactNode
}

const SettingsSection = ({ title, description, rawDescription, children }: SettingsSectionProps) => {
  const { t } = useTranslation()
  const descriptionContent = description ? t(description) : rawDescription

  return (
    <div className="min-w-0">
      <h2 className={`${HEADING_BASE} text-left text-text-primary text-[4.5cqh] break-words`}>{t(title)}</h2>
      {descriptionContent != null && (
        <p className={`${SETTINGS_MUTED_TEXT} text-left whitespace-normal break-words [margin:0cqh_0_0.9cqh]`}>
          {descriptionContent}
        </p>
      )}
      {children}
    </div>
  )
}

export default SettingsSection
