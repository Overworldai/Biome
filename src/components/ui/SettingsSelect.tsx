import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT, SETTINGS_OUTLINE_HOVER } from '../../styles'

type SettingsSelectOption = {
  value: string
  label: string
  prefix?: string
}

type SettingsSelectProps = {
  options: SettingsSelectOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  allowCustom?: boolean
}

const OptionContent = ({ option }: { option: SettingsSelectOption }) => (
  <span className="flex items-center justify-between w-full">
    <span>{option.label}</span>
    {option.prefix ? <span className="text-[rgba(238,244,252,0.45)] lowercase">{option.prefix}</span> : <span />}
  </span>
)

const SettingsSelect = ({ options, value, onChange, disabled, allowCustom }: SettingsSelectProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [isCustom, setIsCustom] = useState(() => allowCustom && !options.some((o) => o.value === value))
  const [customValue, setCustomValue] = useState(value)
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  // Sync isCustom when options or value change — only promote to custom,
  // never demote, so that clicking "Custom..." isn't immediately undone.
  useEffect(() => {
    if (allowCustom && !options.some((o) => o.value === value)) {
      setIsCustom(true)
    }
  }, [allowCustom, options, value])

  // Sync customValue when value changes externally
  useEffect(() => {
    setCustomValue(value)
  }, [value])

  // Measure trigger position when opening
  const openDropdown = useCallback(() => {
    if (containerRef.current) {
      setDropdownRect(containerRef.current.getBoundingClientRect())
    }
    setIsOpen(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const commitCustomValue = () => {
    const trimmed = customValue.trim()
    if (trimmed) {
      onChange(trimmed)
    }
  }

  const dropdownMenu =
    isOpen && dropdownRect
      ? createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] border border-border-medium border-t-0 bg-[var(--color-surface-modal)]"
            style={{
              top: dropdownRect.bottom,
              left: dropdownRect.left,
              width: dropdownRect.width
            }}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`w-full font-serif cursor-pointer rounded-none border-none outline-none p-[0.55cqh_1.42cqh] pr-[4.98cqh] text-[2.67cqh] ${
                  option.value === value
                    ? 'bg-[rgba(245,251,255,0.15)] text-text-primary'
                    : 'bg-transparent text-[var(--color-text-modal-muted)] hover:bg-[rgba(245,251,255,0.08)]'
                }`}
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
              >
                <OptionContent option={option} />
              </button>
            ))}
            {allowCustom && (
              <button
                type="button"
                className="w-full font-serif cursor-pointer rounded-none border-none outline-none p-[0.55cqh_1.42cqh] pr-[4.98cqh] text-[2.67cqh] bg-transparent text-[var(--color-text-modal-muted)] hover:bg-[rgba(245,251,255,0.08)]"
                onClick={() => {
                  setIsCustom(true)
                  setIsOpen(false)
                }}
              >
                Custom...
              </button>
            )}
          </div>,
          document.body
        )
      : null

  if (isCustom) {
    return (
      <div ref={containerRef} className="relative">
        <div
          className={`w-full flex items-stretch rounded-none ${SETTINGS_CONTROL_BASE} p-0 ${SETTINGS_OUTLINE_HOVER}`}
        >
          <input
            ref={inputRef}
            type="text"
            className={`flex-1 bg-transparent border-none outline-none ${SETTINGS_CONTROL_TEXT}`}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onBlur={commitCustomValue}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="flex items-center justify-center w-[3.56cqh] bg-surface-btn-primary cursor-pointer border-none"
            onClick={() => {
              setIsCustom(false)
              setCustomValue(options[0]?.value ?? '')
              onChange(options[0]?.value ?? '')
              openDropdown()
            }}
          >
            <svg className="w-[1.42cqh] h-[1.42cqh]" viewBox="0 0 10 6" fill="none">
              <path d="M0 0L5 6L10 0H0Z" fill="rgba(10,14,24,0.95)" />
            </svg>
          </button>
        </div>
        {dropdownMenu}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className={`w-full flex items-stretch cursor-pointer rounded-none ${SETTINGS_CONTROL_BASE} p-0 ${SETTINGS_OUTLINE_HOVER}`}
        onClick={() => !disabled && (isOpen ? setIsOpen(false) : openDropdown())}
        disabled={disabled}
      >
        <span className={`flex-1 ${SETTINGS_CONTROL_TEXT}`}>
          {selectedOption ? <OptionContent option={selectedOption} /> : value}
        </span>
        <span className="flex items-center justify-center w-[3.56cqh] bg-surface-btn-primary">
          <svg className="w-[1.42cqh] h-[1.42cqh]" viewBox="0 0 10 6" fill="none">
            <path d="M0 0L5 6L10 0H0Z" fill="rgba(10,14,24,0.95)" />
          </svg>
        </span>
      </button>

      {dropdownMenu}
    </div>
  )
}

export default SettingsSelect
