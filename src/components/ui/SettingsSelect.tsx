import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import { SETTINGS_CONTROL_BASE, SETTINGS_CONTROL_TEXT, SETTINGS_OUTLINE_HOVER } from '../../styles'
import { useUISound } from '../../hooks/audio/useUISound'

type SettingsSelectOptionBase = {
  value: string
  prefix?: string
  cacheDeletable?: boolean
  dimmed?: boolean
}

type SettingsSelectOption = SettingsSelectOptionBase &
  ({ label: TranslationKey; rawLabel?: never } | { label?: never; rawLabel: string })

type SettingsSelectProps = {
  options: SettingsSelectOption[]
  value: string
  onChange: (value: string) => void
  onCacheDelete?: (value: string) => void
  disabled?: boolean
  /** Native HTML tooltip shown on hover when `disabled` is true. Used to
   *  explain *why* the control is greyed out (e.g. "install the engine
   *  first"). Ignored when the control is enabled. */
  disabledTooltip?: TranslationKey
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
  onCacheDelete,
  disabled,
  disabledTooltip,
  cacheDeleteLabel,
  hideSelectedInDropdown
}: SettingsSelectProps) => {
  const { t } = useTranslation()
  const resolveLabel = (option: SettingsSelectOption) => (option.label ? t(option.label) : option.rawLabel)
  const { playHover, playClick } = useUISound()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((o) => o.value === value)

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
        // Hide the selected option from the dropdown when there's at least
        // one alternative — collapsing to zero rows would leave the menu
        // visually empty in the (unusual but reachable) case where the
        // picker is showing exactly one entry, the currently-selected one.
        .filter((option, _, all) => !hideSelectedInDropdown || all.length === 1 || option.value !== value)
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
                ${option.cacheDeletable && onCacheDelete ? '' : 'pr-[4.98cqh]'}
                bg-transparent text-[2.67cqh] text-inherit
              `}
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
          </div>
        ))}
    </div>
  ) : null

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
        title={disabled && disabledTooltip ? t(disabledTooltip) : undefined}
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
