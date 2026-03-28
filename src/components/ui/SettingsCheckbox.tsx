import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import { SETTINGS_CONTROL_BASE, SETTINGS_LABEL_BASE, SETTINGS_MUTED_TEXT, SETTINGS_OUTLINE_HOVER } from '../../styles'
import { useUISound } from '../../hooks/useUISound'

type SettingsCheckboxProps = {
  label: TranslationKey
  description?: TranslationKey
  checked: boolean
  onChange: (checked: boolean) => void
}

const SettingsCheckbox = ({ label, description, checked, onChange }: SettingsCheckboxProps) => {
  const { t } = useTranslation()
  const { playHover, playClick } = useUISound()

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-[2cqh]">
        <span
          className={`${SETTINGS_LABEL_BASE} text-text-primary w-[25cqh] max-w-[45%] text-right shrink-0 whitespace-normal break-words leading-[1.1]`}
        >
          {t(label)}
        </span>
        <button
          type="button"
          className={`w-[3.2cqh] h-[3.2cqh] shrink-0 flex items-center justify-center cursor-pointer ${SETTINGS_CONTROL_BASE} ${SETTINGS_OUTLINE_HOVER}`}
          onMouseEnter={playHover}
          onClick={() => {
            playClick()
            onChange(!checked)
          }}
        >
          {checked && (
            <svg viewBox="0 0 16 16" fill="none" className="w-[2cqh] h-[2cqh]">
              <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
            </svg>
          )}
        </button>
      </div>
      {description && (
        <p className={`${SETTINGS_MUTED_TEXT} text-left m-0 mt-[0.4cqh] text-[1.8cqh] opacity-70 pl-[27cqh]`}>
          {t(description)}
        </p>
      )}
    </div>
  )
}

export default SettingsCheckbox
