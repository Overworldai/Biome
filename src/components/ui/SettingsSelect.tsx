import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import type { TranslationKey } from '../../i18n'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT, SETTINGS_OUTLINE_HOVER } from '../../styles'
import { useUISound } from '../../hooks/useUISound'

type SettingsSelectOptionBase = {
  value: string
  prefix?: string
  deletable?: boolean
  cacheDeletable?: boolean
  dimmed?: boolean
}

type SettingsSelectOption = SettingsSelectOptionBase &
  ({ label: TranslationKey; rawLabel?: never } | { label?: never; rawLabel: string })

type SettingsSelectProps = {
  options: SettingsSelectOption[]
  value: string
  onChange: (value: string) => void
  onDelete?: (value: string) => void
  onCacheDelete?: (value: string) => void
  disabled?: boolean
  allowCustom?: boolean
  onCustomBlur?: (value: string) => void
  rawCustomPrefix?: string
  customLabel?: TranslationKey
  deleteLabel?: TranslationKey
  cacheDeleteLabel?: TranslationKey
  hideSelectedInDropdown?: boolean
}

const OptionContent = ({ displayLabel, prefix }: { displayLabel: string; prefix?: string }) => (
  <span className="flex items-start justify-between gap-[1cqh] w-full min-w-0">
    <span className="min-w-0 break-words">{displayLabel}</span>
    {prefix ? <span className="shrink-0 text-[rgba(238,244,252,0.45)] lowercase">{prefix}</span> : <span />}
  </span>
)

const SettingsSelect = ({
  options,
  value,
  onChange,
  onDelete,
  onCacheDelete,
  disabled,
  allowCustom,
  onCustomBlur,
  rawCustomPrefix,
  customLabel,
  deleteLabel,
  cacheDeleteLabel,
  hideSelectedInDropdown
}: SettingsSelectProps) => {
  const { t } = useTranslation()
  const resolveLabel = (option: SettingsSelectOption) => (option.label ? t(option.label) : option.rawLabel)
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
            className="fixed z-[9999] border border-border-medium border-t-0 bg-[var(--color-surface-modal)] backdrop-blur-[1.67cqh] overflow-y-auto styled-scrollbar"
            style={{
              top: dropdownRect.bottom,
              left: dropdownRect.left,
              width: dropdownRect.width,
              maxHeight: window.innerHeight - dropdownRect.bottom - 8
            }}
          >
            {options
              .filter((option) => !hideSelectedInDropdown || option.value !== value)
              .map((option) => (
                <div
                  key={option.value}
                  className={`flex items-center ${
                    option.value === value
                      ? 'bg-[rgba(245,251,255,0.15)] text-text-primary'
                      : 'bg-transparent text-[var(--color-text-modal-muted)] hover:bg-[rgba(245,251,255,0.08)]'
                  } ${option.dimmed ? 'opacity-50' : ''}`}
                >
                  <button
                    type="button"
                    className={`flex-1 min-w-0 font-serif cursor-pointer rounded-none border-none outline-none p-[0.55cqh_1.42cqh] ${(option.deletable && onDelete) || (option.cacheDeletable && onCacheDelete) ? '' : 'pr-[4.98cqh]'} text-[2.67cqh] bg-transparent text-inherit`}
                    onMouseEnter={playHover}
                    onClick={() => {
                      playClick()
                      onChange(option.value)
                      setIsOpen(false)
                    }}
                  >
                    <OptionContent displayLabel={resolveLabel(option)} prefix={option.prefix} />
                  </button>
                  {option.cacheDeletable && onCacheDelete && (
                    <button
                      type="button"
                      className="flex items-center justify-center w-[3.56cqh] h-full bg-transparent border-none cursor-pointer text-[rgba(238,244,252,0.45)] hover:text-[rgba(255,120,80,0.95)] transition-colors"
                      onMouseEnter={playHover}
                      onClick={(e) => {
                        e.stopPropagation()
                        playClick()
                        onCacheDelete(option.value)
                      }}
                      title={cacheDeleteLabel ? t(cacheDeleteLabel) : undefined}
                    >
                      <svg className="w-[1.42cqh] h-[1.42cqh]" viewBox="0 0 10 10" fill="none">
                        <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
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
                      title={deleteLabel ? t(deleteLabel) : undefined}
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
                {customLabel ? t(customLabel) : undefined}
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
            className={`flex-1 min-w-0 bg-transparent border-none outline-none break-words ${SETTINGS_CONTROL_TEXT}`}
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
          {rawCustomPrefix && (
            <span className="flex items-center pr-[1cqh] text-[rgba(238,244,252,0.45)] lowercase text-[2.67cqh] font-serif text-right">
              {rawCustomPrefix}
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
        <span className={`flex-1 min-w-0 break-words ${SETTINGS_CONTROL_TEXT}`}>
          {selectedOption ? (
            <OptionContent displayLabel={resolveLabel(selectedOption)} prefix={selectedOption.prefix} />
          ) : (
            value
          )}
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
