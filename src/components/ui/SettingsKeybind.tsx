import { useState, useCallback, useRef, useEffect } from 'react'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT, SETTINGS_OUTLINE_HOVER } from '../../styles'
import { useUISound } from '../../hooks/useUISound'
import type { FixedControl } from '../../hooks/useGameInput'
import i18n from '../../i18n'

export const keyCodeToLabel = (code: string): string => {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  const map: Record<string, string> = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt'
  }
  return map[code] ?? code
}

type SettingsKeybindProps = {
  value: string
  onChange?: (code: string) => void
  disabled?: boolean
}

const SettingsKeybind = ({ value, onChange, disabled }: SettingsKeybindProps) => {
  const { playHover, playClick } = useUISound()
  const [listening, setListening] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleClick = useCallback(() => {
    if (!disabled) {
      playClick()
      setListening(true)
    }
  }, [disabled, playClick])

  const handleBlur = useCallback(() => {
    setListening(false)
  }, [])

  useEffect(() => {
    if (!listening) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.code === 'Escape') {
        setListening(false)
        return
      }

      onChange?.(e.code)
      setListening(false)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [listening, onChange])

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`w-full text-left rounded-none ${disabled ? 'cursor-default opacity-50' : 'cursor-pointer'} ${SETTINGS_CONTROL_BASE} ${SETTINGS_CONTROL_TEXT} ${SETTINGS_OUTLINE_HOVER} appearance-none ${listening ? 'border-text-primary' : ''}`}
      onMouseEnter={disabled ? undefined : playHover}
      onClick={handleClick}
      onBlur={handleBlur}
      disabled={disabled}
    >
      {listening ? 'Press a key...' : keyCodeToLabel(value)}
    </button>
  )
}

export const fixedControlLabel = (ctrl: FixedControl): string => {
  return i18n.t(`app.settings.fixedControls.labels.${ctrl.labelKey}`, { defaultValue: ctrl.label })
}

/** Human-readable display string for a fixed control entry. */
export const fixedControlDisplay = (ctrl: FixedControl): string => {
  const displayValue = ctrl.displayValue ?? keyCodeToLabel(ctrl.code)
  if (!ctrl.displayValueKey) return displayValue
  return i18n.t(`app.settings.fixedControls.values.${ctrl.displayValueKey}`, { defaultValue: displayValue })
}

export default SettingsKeybind
