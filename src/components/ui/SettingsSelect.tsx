import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT, SETTINGS_OUTLINE_HOVER } from '../../styles'
import { useUISound } from '../../hooks/useUISound'

type SettingsSelectOption = {
  value: string
  label: string
  prefix?: string
  deletable?: boolean
}

type SettingsSelectProps = {
  options: SettingsSelectOption[]
  value: string
  onChange: (value: string) => void
  onDelete?: (value: string) => void
  disabled?: boolean
  allowCustom?: boolean
  onCustomBlur?: (value: string) => void
  customPrefix?: string
}

const OptionContent = ({ option }: { option: SettingsSelectOption }) => (
  <span className="flex items-center justify-between w-full">
    <span>{option.label}</span>
    {option.prefix ? <span className="text-[rgba(238,244,252,0.45)] lowercase">{option.prefix}</span> : <span />}
  </span>
)

const SettingsSelect = ({
  options,
  value,
  onChange,
  onDelete,
  disabled,
  allowCustom,
  onCustomBlur,
  customPrefix
}: SettingsSelectProps) => {
  const { playHover, playClick } = useUISound()
  const [isOpen, setIsOpen] = useState(false)
  const [isCustom, setIsCustom] = useState(() => allowCustom && !options.some((o) => o.value === value))
  const [customValue, setCustomValue] = useState(value)
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  // Track option values to detect when the options list actually changes
  // content (not just reference identity, which changes every render due to .map()).
  // Demote from custom back to dropdown when a new option appears matching the
  // current value (e.g. after validation adds it). Promote to custom when value
  // changes to something not in options.
  const prevOptionValuesRef = useRef(new Set(options.map((o) => o.value)))
  useEffect(() => {
    if (!allowCustom) return
    const currentValues = new Set(options.map((o) => o.value))
    const prevValues = prevOptionValuesRef.current
    const inOptions = currentValues.has(value)
    const isNewOption = inOptions && !prevValues.has(value)
    prevOptionValuesRef.current = currentValues
    if (isNewOption) {
      setIsCustom(false)
    } else if (!inOptions) {
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
    setCustomValue(trimmed)
    if (trimmed) {
      onChange(trimmed)
    }
  }

  const dropdownMenu =
    isOpen && dropdownRect
      ? createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] border border-border-medium border-t-0 bg-[var(--color-surface-modal)] backdrop-blur-[1.67cqh]"
            style={{
              top: dropdownRect.bottom,
              left: dropdownRect.left,
              width: dropdownRect.width
            }}
          >
            {options.map((option) => (
              <div
                key={option.value}
                className={`flex items-center ${
                  option.value === value
                    ? 'bg-[rgba(245,251,255,0.15)] text-text-primary'
                    : 'bg-transparent text-[var(--color-text-modal-muted)] hover:bg-[rgba(245,251,255,0.08)]'
                }`}
              >
                <button
                  type="button"
                  className={`flex-1 font-serif cursor-pointer rounded-none border-none outline-none p-[0.55cqh_1.42cqh] ${option.deletable && onDelete ? '' : 'pr-[4.98cqh]'} text-[2.67cqh] bg-transparent text-inherit`}
                  onMouseEnter={playHover}
                  onClick={() => {
                    playClick()
                    onChange(option.value)
                    setIsOpen(false)
                  }}
                >
                  <OptionContent option={option} />
                </button>
                {option.deletable && onDelete && (
                  <button
                    type="button"
                    className="flex items-center justify-center w-[3.56cqh] h-full bg-transparent border-none cursor-pointer text-[rgba(238,244,252,0.45)] hover:text-[rgba(255,120,80,0.95)] transition-colors"
                    onMouseEnter={playHover}
                    onClick={(e) => {
                      e.stopPropagation()
                      playClick()
                      onDelete(option.value)
                    }}
                    title="Remove custom model"
                  >
                    <svg className="w-[1.42cqh] h-[1.42cqh]" viewBox="0 0 10 10" fill="none">
                      <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
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
            onPaste={(e) => {
              e.preventDefault()
              const pasted = e.clipboardData.getData('text').trim()
              setCustomValue(pasted)
            }}
            onBlur={() => {
              commitCustomValue()
              const trimmed = customValue.trim()
              if (trimmed) onCustomBlur?.(trimmed)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            autoFocus
          />
          {customPrefix && (
            <span className="flex items-center pr-[1cqh] text-[rgba(238,244,252,0.45)] lowercase text-[2.67cqh] font-serif whitespace-nowrap">
              {customPrefix}
            </span>
          )}
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
        className={`w-full flex items-stretch rounded-none ${SETTINGS_CONTROL_BASE} p-0 ${disabled ? 'opacity-40 cursor-not-allowed' : `cursor-pointer ${SETTINGS_OUTLINE_HOVER}`}`}
        onMouseEnter={disabled ? undefined : playHover}
        onClick={() => {
          if (disabled) return
          playClick()
          isOpen ? setIsOpen(false) : openDropdown()
        }}
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
