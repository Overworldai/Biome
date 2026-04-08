import type { ReactNode } from 'react'
import { SETTINGS_LABEL_BASE, SETTINGS_MUTED_TEXT } from '../../styles'

type SettingsRowProps = {
  label: ReactNode
  hint?: ReactNode
  /** Vertical alignment of label and control. Use 'start' for short controls like checkboxes. */
  align?: 'start' | 'center'
  children: ReactNode
}

const SettingsRow = ({ label, hint, align = 'center', children }: SettingsRowProps) => {
  return (
    <div className="flex flex-col">
      <div className={`flex gap-[2cqh] ${align === 'start' ? 'items-start' : 'items-center'}`}>
        <span
          className={`${SETTINGS_LABEL_BASE} text-text-primary w-[25cqh] max-w-[45%] text-right shrink-0 whitespace-normal break-words leading-[1.1]`}
        >
          {label}
        </span>
        <div className="flex-1">{children}</div>
      </div>
      {hint && (
        <p
          className={`${SETTINGS_MUTED_TEXT} text-left m-0 mt-[0.4cqh] text-[1.8cqh] opacity-70 pl-[27cqh] whitespace-pre-line`}
        >
          {hint}
        </p>
      )}
    </div>
  )
}

export default SettingsRow
