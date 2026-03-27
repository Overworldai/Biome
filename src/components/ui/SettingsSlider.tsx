import { useRef, useCallback } from 'react'
import { SETTINGS_CONTROL_BASE, SETTINGS_OUTLINE_HOVER, SETTINGS_MUTED_TEXT } from '../../styles'
import { useUISound } from '../../hooks/useUISound'

type SettingsSliderProps = {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  label?: string
  suffix?: string
}

const SettingsSlider = ({ value, onChange, min, max, label, suffix }: SettingsSliderProps) => {
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

  return (
    <div className="flex flex-col items-start">
      <div
        ref={trackRef}
        className={`relative w-full ${SETTINGS_CONTROL_BASE} cursor-pointer leading-[1.2] p-[0.275cqh_1.42cqh] text-[1.33cqh] ${SETTINGS_OUTLINE_HOVER}`}
        onMouseEnter={playHover}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        <div
          className="absolute inset-0 bg-surface-btn-primary pointer-events-none"
          style={{ width: `${fraction * 100}%` }}
        />
        <span className="invisible">X</span>
      </div>
      {(label || suffix) && (
        <span className={`${SETTINGS_MUTED_TEXT} flex flex-wrap w-full items-start gap-[0.6cqh_1cqh] justify-between`}>
          {label && <span className="lowercase break-words">{label}</span>}
          {suffix && <span className="ml-auto">{suffix}</span>}
        </span>
      )}
    </div>
  )
}

export default SettingsSlider
