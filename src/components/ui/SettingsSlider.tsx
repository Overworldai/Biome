import { useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranslationKey } from '../../i18n'
import { SETTINGS_CONTROL_BASE, SETTINGS_OUTLINE_HOVER, SETTINGS_MUTED_TEXT } from '../../styles'
import { useUISound } from '../../hooks/useUISound'

type SettingsSliderProps = {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  label?: TranslationKey
  suffix?: string
}

const SettingsSlider = ({ value, onChange, min, max, label, suffix }: SettingsSliderProps) => {
  const { t } = useTranslation()
  const { playHover, playClick } = useUISound()
  const trackRef = useRef<HTMLDivElement>(null)

  const fraction = (value - min) / (max - min)

  const valueFromEvent = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return value
      const rect = track.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return Math.round(min + ratio * (max - min))
    },
    [min, max, value]
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      playClick()
      const target = event.currentTarget as HTMLElement
      target.setPointerCapture(event.pointerId)
      onChange(valueFromEvent(event.clientX))
    },
    [onChange, valueFromEvent, playClick]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      onChange(valueFromEvent(event.clientX))
    },
    [onChange, valueFromEvent]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Arrow Left/Right adjust the value and prevent default so gamepad nav
      // (which dispatches these keys) treats the input as consumed.
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onChange(Math.max(min, value - 1))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onChange(Math.min(max, value + 1))
      }
    },
    [onChange, value, min, max]
  )

  return (
    <div className="flex flex-col items-start">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        className={`
          relative w-full
          ${SETTINGS_CONTROL_BASE}
          cursor-pointer p-[0.275cqh_1.42cqh] text-[1.33cqh] leading-[1.2]
          ${SETTINGS_OUTLINE_HOVER}
          focus:outline-none
        `}
        onMouseEnter={playHover}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onKeyDown={handleKeyDown}
      >
        <div
          className="pointer-events-none absolute inset-0 bg-surface-btn-primary"
          style={{ width: `${fraction * 100}%` }}
        />
        <span className="invisible">X</span>
      </div>
      {(label || suffix) && (
        <span
          className={`
            ${SETTINGS_MUTED_TEXT}
            flex w-full flex-wrap items-start justify-between gap-[0.6cqh_1cqh]
          `}
        >
          {label && <span className="wrap-break-word lowercase">{t(label)}</span>}
          {suffix && <span className="ml-auto">{suffix}</span>}
        </span>
      )}
    </div>
  )
}

export default SettingsSlider
