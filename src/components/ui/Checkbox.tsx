import { SETTINGS_CONTROL_BASE, SETTINGS_OUTLINE_HOVER } from '../../styles'
import { useUISound } from '../../hooks/audio/useUISound'

type CheckboxProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Optional class overrides — typically a sizing tweak when the
   *  default 3.2cqh box doesn't fit the surrounding type scale. */
  className?: string
  /** Accessible label for screen readers when the visual label sits
   *  outside the button (e.g. wrapped in a `<label>` element). */
  ariaLabel?: string
}

/** Square checkbox button with the settings-control look (border +
 *  hover outline + checkmark SVG). Used both inside SettingsCheckbox
 *  and standalone in the Scene Edit prop picker overlay. */
const Checkbox = ({ checked, onChange, className, ariaLabel }: CheckboxProps) => {
  const { playHover, playClick } = useUISound()

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`
        flex h-[3.2cqh] w-[3.2cqh] shrink-0 cursor-pointer items-center justify-center
        ${SETTINGS_CONTROL_BASE}
        ${SETTINGS_OUTLINE_HOVER}
        ${className ?? ''}
      `}
      onMouseEnter={playHover}
      onClick={() => {
        playClick()
        onChange(!checked)
      }}
    >
      {checked && (
        <svg viewBox="0 0 16 16" fill="none" className="h-[2cqh] w-[2cqh]">
          <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
        </svg>
      )}
    </button>
  )
}

export default Checkbox
