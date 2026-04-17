import { useState, useCallback, useRef, useEffect } from 'react'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT, SETTINGS_OUTLINE_HOVER } from '../../styles'
import { useUISound } from '../../hooks/useUISound'
import { type Control, MOUSE_CODES } from '../../hooks/useGameInput'
import i18n from '../../i18n'

const MOUSE_CODE_LABELS: Record<string, string> = {
  [MOUSE_CODES.LEFT]: 'Left Click',
  [MOUSE_CODES.MIDDLE]: 'Middle Click',
  [MOUSE_CODES.RIGHT]: 'Right Click',
  [MOUSE_CODES.BACK]: 'Mouse Back',
  [MOUSE_CODES.FORWARD]: 'Mouse Forward'
}

const MOUSE_BUTTON_TO_CODE: Record<number, string> = {
  0: MOUSE_CODES.LEFT,
  1: MOUSE_CODES.MIDDLE,
  2: MOUSE_CODES.RIGHT,
  3: MOUSE_CODES.BACK,
  4: MOUSE_CODES.FORWARD
}

export const keyCodeToLabel = (code: string): string => {
  if (code in MOUSE_CODE_LABELS) return MOUSE_CODE_LABELS[code]
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
    Escape: 'Esc',
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
        // Cancel listening (user hit Esc to abort). If they want to *bind* Esc,
        // they can click the button again and... there's no way to bind Esc via
        // keyboard without this abort. Acceptable: Esc is reserved for cancel.
        setListening(false)
        return
      }

      onChange?.(e.code)
      setListening(false)
    }

    const handleMouseDown = (e: MouseEvent) => {
      const code = MOUSE_BUTTON_TO_CODE[e.button]
      if (!code) return
      // Ignore left-click on the button itself (that's how the user entered listening).
      if (e.button === 0 && e.target === buttonRef.current) return
      e.preventDefault()
      e.stopPropagation()
      onChange?.(code)
      setListening(false)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('mousedown', handleMouseDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('mousedown', handleMouseDown, true)
    }
  }, [listening, onChange])

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`w-full min-w-0 text-left rounded-none ${disabled ? 'cursor-default opacity-50' : 'cursor-pointer'} ${SETTINGS_CONTROL_BASE} ${SETTINGS_CONTROL_TEXT} ${SETTINGS_OUTLINE_HOVER} appearance-none break-words ${listening ? 'border-text-primary' : ''}`}
      onMouseEnter={disabled ? undefined : playHover}
      onClick={handleClick}
      onBlur={handleBlur}
      disabled={disabled}
    >
      {listening ? 'Press a key...' : keyCodeToLabel(value)}
    </button>
  )
}

export const controlLabel = (ctrl: Control): string => {
  return i18n.t(`app.settings.fixedControls.labels.${ctrl.labelKey}`, { defaultValue: ctrl.label })
}

/** Human-readable display string for a control entry. */
export const controlDisplay = (ctrl: Control): string => {
  if (ctrl.code !== undefined) return keyCodeToLabel(ctrl.code)
  return i18n.t(`app.settings.fixedControls.values.${ctrl.displayValueKey}`, { defaultValue: ctrl.displayValue })
}

export default SettingsKeybind
