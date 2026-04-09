import { useEffect, useRef, useState } from 'react'
import { useStreaming } from '../context/StreamingContext'

const OVERLAY_BG = 'bg-black/50'
const OVERLAY_BORDER = 'border border-white/20'
const OVERLAY_TEXT = 'font-mono text-[1.6cqh] leading-[2.2cqh]'

const COLOR_CURRENT = '#78fff5'
const COLOR_QUEUED = 'rgba(255,255,255,0.5)'
const COLOR_PAST = 'rgba(255,255,255,0.2)'
const COLOR_LABEL = 'rgba(255,255,255,0.35)'

type SlotState = 'past' | 'current' | 'queued' | 'unknown'

type FrameSlot = {
  label: string
  state: SlotState
  timeMs: number | null
}

const FrameTimelineOverlay = () => {
  const { frameTimelineOverlay, isStreaming, frameTimelineRef, temporalCompression } = useStreaming()
  const [slots, setSlots] = useState<FrameSlot[]>([])
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!frameTimelineOverlay || !isStreaming) return

    const tick = () => {
      const now = performance.now()
      const { currentIndex, slotDisplayAts } = frameTimelineRef.current

      const next: FrameSlot[] = Array.from({ length: temporalCompression }, (_, i) => {
        const displayAt = slotDisplayAts[i]

        let state: SlotState
        if (displayAt === null) {
          state = i < currentIndex ? 'past' : i === currentIndex ? 'current' : 'unknown'
        } else if (i < currentIndex) {
          state = 'past'
        } else if (i === currentIndex) {
          state = 'current'
        } else {
          state = 'queued'
        }

        return {
          label: `F${i + 1}`,
          state,
          timeMs: displayAt !== null ? Math.round(displayAt - now) : null
        }
      })

      setSlots(next)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [frameTimelineOverlay, isStreaming, frameTimelineRef, temporalCompression])

  if (!frameTimelineOverlay || !isStreaming) return null

  return (
    <div
      className={`absolute top-[1.5cqh] right-[1.5cqh] z-10 pointer-events-none ${OVERLAY_BG} ${OVERLAY_BORDER} rounded-[0.4cqh] p-[1cqh] ${OVERLAY_TEXT}`}
    >
      <div style={{ color: COLOR_LABEL }} className="mb-[0.6cqh] text-center">
        FRAME TIMELINE
      </div>
      <div className="flex gap-[0.8cqh]">
        {slots.map((slot) => {
          const color = slot.state === 'current' ? COLOR_CURRENT : slot.state === 'past' ? COLOR_PAST : COLOR_QUEUED
          const timeLabel =
            slot.timeMs === null
              ? '--'
              : slot.state === 'current'
                ? 'now'
                : `${slot.timeMs > 0 ? '+' : ''}${slot.timeMs}ms`
          return (
            <div key={slot.label} className="flex flex-col items-center gap-[0.3cqh]">
              <div
                className="flex items-center justify-center rounded-[0.3cqh] tabular-nums"
                style={{
                  width: '5cqh',
                  height: '3.2cqh',
                  fontSize: '1.6cqh',
                  border: `1px solid ${slot.state === 'current' ? COLOR_CURRENT : 'rgba(255,255,255,0.2)'}`,
                  color,
                  background: slot.state === 'current' ? 'rgba(120,255,245,0.15)' : 'transparent'
                }}
              >
                {slot.label}
              </div>
              <div
                className="tabular-nums text-center"
                style={{ fontSize: '1.4cqh', lineHeight: '1.8cqh', color, minWidth: '5cqh' }}
              >
                {timeLabel}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default FrameTimelineOverlay
