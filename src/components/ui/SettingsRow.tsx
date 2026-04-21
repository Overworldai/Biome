import type { ReactNode } from 'react'
import { SETTINGS_LABEL_BASE, SETTINGS_MUTED_TEXT } from '../../styles'

type SettingsRowProps = {
  label: ReactNode
  hint?: ReactNode
  /** Render the hint in error red rather than the default muted text. */
  hintError?: boolean
  /** Vertical alignment of label and control. Use 'start' for short controls like checkboxes. */
  align?: 'start' | 'center'
  children: ReactNode
}

const SettingsRow = ({ label, hint, hintError, align = 'center', children }: SettingsRowProps) => {
  const hintClass = hintError
    ? 'font-serif text-error text-left m-0 mt-[0.4cqh] text-[1.8cqh] pl-[27cqh] whitespace-pre-line'
    : `${SETTINGS_MUTED_TEXT} text-left m-0 mt-[0.4cqh] text-[1.8cqh] opacity-70 pl-[27cqh] whitespace-pre-line`
  return (
    <div className="flex flex-col">
      <div
        className={`
          flex gap-[2cqh]
          ${align === 'start' ? 'items-start' : 'items-center'}
        `}
      >
        <span
          className={`
            ${SETTINGS_LABEL_BASE}
            w-[25cqh] max-w-[45%] shrink-0 text-right leading-[1.1] wrap-break-word whitespace-normal text-text-primary
          `}
        >
          {label}
        </span>
        <div className="flex-1">{children}</div>
      </div>
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  )
}

export default SettingsRow
