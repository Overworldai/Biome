import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import { HEADING_BASE, SETTINGS_MUTED_TEXT } from '../../styles'

type SettingsSectionProps = {
  /** Section heading. Use Title Case (e.g. "Scene Authoring", "Offline Mode"). */
  title: TranslationKey
  /**
   * Short description shown below the title. Phrase as a **lower-case question addressed to the user**
   * (e.g. "want to compose and modify scenes with text prompts?", "how loud should things be?"),
   * not a statement or label. The title names the thing; the description asks what the user wants to do with it.
   */
  description?: TranslationKey
  /** Escape hatch for descriptions that contain JSX or dynamic content. Same phrasing rules as `description`. */
  rawDescription?: ReactNode
  children?: ReactNode
}

const SettingsSection = ({ title, description, rawDescription, children }: SettingsSectionProps) => {
  const { t } = useTranslation()
  const descriptionContent = description ? t(description) : rawDescription

  return (
    <div className="min-w-0">
      <h2
        className={`
          ${HEADING_BASE}
          text-left text-[4.5cqh] wrap-break-word text-text-primary
        `}
      >
        {t(title)}
      </h2>
      {descriptionContent != null && (
        <p
          className={`
            ${SETTINGS_MUTED_TEXT}
            m-[0cqh_0_0.9cqh] text-left wrap-break-word whitespace-normal
          `}
        >
          {descriptionContent}
        </p>
      )}
      {children}
    </div>
  )
}

export default SettingsSection
