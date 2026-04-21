import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
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
  <span className="flex w-full min-w-0 items-start justify-between gap-[1cqh]">
    <span className="min-w-0 wrap-break-word">{displayLabel}</span>
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
  // Only start in custom mode if options have actually loaded and the value isn't in them.
  // Otherwise we'd briefly render the custom input on mount before async-loaded options arrive.
  const [isCustom, setIsCustom] = useState(
    () => allowCustom === true && options.length > 0 && !options.some((o) => o.value === value)
  )
  const [customValue, setCustomValue] = useState(value)
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
    } else if (options.length > 0 && !inOptions) {
      setIsCustom(true)
    }
  }, [allowCustom, options, value])

  // Sync customValue when value changes externally
  useEffect(() => {
    setCustomValue(value)
  }, [value])

  const openDropdown = useCallback(() => setIsOpen(true), [])

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

  const cycleOption = useCallback(
    (delta: 1 | -1) => {
      if (options.length === 0) return
      const idx = options.findIndex((o) => o.value === value)
      const next = options[(idx + delta + options.length) % options.length]
      if (next) onChange(next.value)
    },
    [options, value, onChange]
  )

  // Absolute-positioned directly below the trigger (our containerRef has `position: relative`).
  // Any ancestor with `overflow: auto/hidden` — in our case the scroll container — will clip
  // the dropdown for free, so there's no need to portal, measure, or manage scroll listeners.
  const dropdownMenu = isOpen ? (
    <div
      ref={dropdownRef}
      className="
        styled-scrollbar absolute top-full left-0 z-9999 max-h-[40cqh] w-full overflow-y-auto border border-t-0
        border-border-medium bg-[rgba(2,4,8,0.78)] backdrop-blur-[1.67cqh] select-none
      "
    >
      {options
        .filter((option) => !hideSelectedInDropdown || option.value !== value)
        .map((option) => (
          <div
            key={option.value}
            className={`
              flex items-center
              ${
                option.value === value
                  ? 'bg-[rgba(245,251,255,0.15)] text-text-primary'
                  : `
                    bg-transparent text-text-modal-muted
                    hover:bg-[rgba(245,251,255,0.08)]
                  `
              }
              ${option.dimmed ? 'opacity-50' : ''}
            `}
          >
            <button
              type="button"
              className={`
                min-w-0 flex-1 cursor-pointer rounded-none border-none p-[0.55cqh_1.42cqh] font-serif outline-none
                ${(option.deletable && onDelete) || (option.cacheDeletable && onCacheDelete) ? '' : 'pr-[4.98cqh]'} bg-transparent text-[2.67cqh] text-inherit`}
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
                className="
                  flex h-full w-[3.56cqh] cursor-pointer items-center justify-center border-none bg-transparent
                  text-[rgba(238,244,252,0.45)] transition-colors
                  hover:text-[rgba(255,120,80,0.95)]
                "
                onMouseEnter={playHover}
                onClick={(e) => {
                  e.stopPropagation()
                  playClick()
                  onCacheDelete(option.value)
                }}
                title={cacheDeleteLabel ? t(cacheDeleteLabel) : undefined}
              >
                <svg className="h-[1.42cqh] w-[1.42cqh]" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
            {option.deletable && onDelete && (
              <button
                type="button"
                className="
                  flex h-full w-[3.56cqh] cursor-pointer items-center justify-center border-none bg-transparent
                  text-[rgba(238,244,252,0.45)] transition-colors
                  hover:text-[rgba(255,120,80,0.95)]
                "
                onMouseEnter={playHover}
                onClick={(e) => {
                  e.stopPropagation()
                  playClick()
                  onDelete(option.value)
                }}
                title={deleteLabel ? t(deleteLabel) : undefined}
              >
                <svg className="h-[1.42cqh] w-[1.42cqh]" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        ))}
      {allowCustom && (
        <button
          type="button"
          className="
            w-full cursor-pointer rounded-none border-none bg-transparent p-[0.55cqh_1.42cqh] pr-[4.98cqh] font-serif
            text-[2.67cqh] text-text-modal-muted outline-none
            hover:bg-[rgba(245,251,255,0.08)]
          "
          onClick={() => {
            setIsCustom(true)
            setIsOpen(false)
          }}
        >
          {customLabel ? t(customLabel) : undefined}
        </button>
      )}
    </div>
  ) : null

  if (isCustom) {
    return (
      <div ref={containerRef} className="relative">
        <div
          className={`
            flex w-full items-stretch rounded-none
            ${SETTINGS_CONTROL_BASE}
            p-0
            ${SETTINGS_OUTLINE_HOVER}
          `}
        >
          <input
            ref={inputRef}
            type="text"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className={`
              min-w-0 flex-1 border-none bg-transparent wrap-break-word outline-none
              ${SETTINGS_CONTROL_TEXT}
            `}
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
            <span
              className="
                flex items-center pr-[1cqh] text-right font-serif text-[2.67cqh] text-[rgba(238,244,252,0.45)] lowercase
              "
            >
              {rawCustomPrefix}
            </span>
          )}
          <button
            type="button"
            className="flex w-[3.56cqh] cursor-pointer items-center justify-center border-none bg-surface-btn-primary"
            onClick={() => {
              setIsCustom(false)
              openDropdown()
            }}
          >
            <svg className="h-[1.42cqh] w-[1.42cqh]" viewBox="0 0 10 6" fill="none">
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
        className={`
          flex w-full items-stretch rounded-none
          ${SETTINGS_CONTROL_BASE}
          p-0
          ${
            disabled
              ? 'cursor-not-allowed opacity-40'
              : `
                cursor-pointer
                ${SETTINGS_OUTLINE_HOVER}
              `
          }
        `}
        onMouseEnter={disabled ? undefined : playHover}
        onClick={() => {
          if (disabled) return
          playClick()
          if (isOpen) setIsOpen(false)
          else openDropdown()
        }}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            cycleOption(-1)
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            cycleOption(1)
          }
        }}
        disabled={disabled}
      >
        <span
          className={`
            min-w-0 flex-1 wrap-break-word
            ${SETTINGS_CONTROL_TEXT}
          `}
        >
          {selectedOption ? (
            <OptionContent displayLabel={resolveLabel(selectedOption)} prefix={selectedOption.prefix} />
          ) : (
            value
          )}
        </span>
        <span className="flex w-[3.56cqh] items-center justify-center bg-surface-btn-primary">
          <svg className="h-[1.42cqh] w-[1.42cqh]" viewBox="0 0 10 6" fill="none">
            <path d="M0 0L5 6L10 0H0Z" fill="rgba(10,14,24,0.95)" />
          </svg>
        </span>
      </button>

      {dropdownMenu}
    </div>
  )
}

export default SettingsSelect
