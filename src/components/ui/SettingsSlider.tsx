import { useRef, useCallback } from 'react'
import { SETTINGS_CONTROL_BASE, SETTINGS_OUTLINE_HOVER, SETTINGS_MUTED_TEXT } from '../../styles'

type SettingsSliderProps = {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  label?: string
}

const SettingsSlider = ({ value, onChange, min, max, label }: SettingsSliderProps) => {
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
      const target = event.currentTarget as HTMLElement
      target.setPointerCapture(event.pointerId)
      onChange(valueFromEvent(event.clientX))
    },
    [onChange, valueFromEvent]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      onChange(valueFromEvent(event.clientX))
    },
    [onChange, valueFromEvent]
  )

  return (
    <div className="flex flex-col items-end gap-[0.4cqh]">
      <div
        ref={trackRef}
        className={`relative w-full ${SETTINGS_CONTROL_BASE} cursor-pointer leading-[1.2] p-[0.275cqh_1.42cqh] text-[1.33cqh] ${SETTINGS_OUTLINE_HOVER}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        <div
          className="absolute inset-0 bg-[rgba(245,251,255,0.95)] pointer-events-none"
          style={{ width: `${fraction * 100}%` }}
        />
        <span className="invisible">X</span>
      </div>
      {label && <span className={SETTINGS_MUTED_TEXT}>{label}</span>}
    </div>
  )
}

export default SettingsSlider
