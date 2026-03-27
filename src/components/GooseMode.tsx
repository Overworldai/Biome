import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAudio } from '../context/AudioContext'
import { useUISound } from '../hooks/useUISound'
import { SETTINGS_CONTROL_BASE, SETTINGS_LABEL_BASE, SETTINGS_OUTLINE_HOVER } from '../styles'

const GOOSE_FACT_CYCLE_MS = 5200
const GOOSE_IMAGE_URL = new URL('../../assets/goose.png', import.meta.url).href

// We seed the shuffle so each loading session gets one stable random order.
// This avoids accidental reshuffles on re-render and lets us re-randomize only when we choose.
const makeSeed = () => Math.floor(Math.random() * 0x100000000)
const makeGooseRotation = () => Math.round(Math.random() * 40 - 20)

const seededRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const shuffleWithSeed = <T,>(items: T[], seed: number): T[] => {
  const random = seededRandom(seed)
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }
  return shuffled
}

type GooseModeCheckboxProps = {
  checked: boolean
  onChange: (checked: boolean) => void
}

export const GooseModeCheckbox = ({ checked, onChange }: GooseModeCheckboxProps) => {
  const { t } = useTranslation()
  const { play } = useAudio()
  const { playHover } = useUISound()
  const [rotation, setRotation] = useState(() => makeGooseRotation())

  return (
    <div className="flex items-center gap-[2cqh]">
      <span className={`${SETTINGS_LABEL_BASE} text-text-primary w-[25cqh] text-right shrink-0`}>
        {t('app.settings.gooseMode.label')}
      </span>
      <button
        type="button"
        className={`w-[3.2cqh] h-[3.2cqh] shrink-0 flex items-center justify-center overflow-visible cursor-pointer ${SETTINGS_CONTROL_BASE} ${SETTINGS_OUTLINE_HOVER}`}
        onMouseEnter={playHover}
        onClick={() => {
          const nextChecked = !checked
          setRotation(makeGooseRotation())
          play(nextChecked ? 'goose_start' : 'goose_end')
          onChange(nextChecked)
        }}
      >
        {checked && (
          <img
            src={GOOSE_IMAGE_URL}
            alt=""
            className="w-[4.15cqh] h-[4.15cqh] max-w-none object-contain pointer-events-none select-none [filter:brightness(0)_invert(1)_drop-shadow(0_0_0.35cqh_rgba(255,255,255,0.7))]"
            style={{ transform: `rotate(${rotation}deg)` }}
          />
        )}
      </button>
    </div>
  )
}

export const GooseFactTicker = () => {
  const { t } = useTranslation()
  const [gooseFactIndex, setGooseFactIndex] = useState(0)
  const [shuffleSeed] = useState(() => makeSeed())

  const facts = t('app.settings.gooseMode.facts', { returnObjects: true }) as string[]
  const activeTips = useMemo(() => shuffleWithSeed(facts, shuffleSeed), [facts, shuffleSeed])

  useEffect(() => {
    if (activeTips.length < 2) return

    const timer = window.setInterval(() => {
      setGooseFactIndex((previous) => (previous + 1) % activeTips.length)
    }, GOOSE_FACT_CYCLE_MS)

    return () => window.clearInterval(timer)
  }, [activeTips])

  return (
    <div className="w-full text-center font-serif text-[2.35cqh] leading-[1.2] text-[rgba(233,242,255,0.86)] [text-shadow:0_0.12cqh_0.42cqh_rgba(0,0,0,0.42)]">
      {activeTips[gooseFactIndex] ?? ''}
    </div>
  )
}
