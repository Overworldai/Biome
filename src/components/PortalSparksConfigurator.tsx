import { useState, useCallback, useEffect } from 'react'
import { SPARK_TUNING, SPARK_TUNING_DEFAULTS } from '../lib/portalSparksTuning'
import type { PortalSparksTuning } from '../lib/portalSparksTuning'
import { SPARK_DEBUG } from '../lib/sparkDebug'
import { invoke } from '../bridge'

type TuningKey = keyof PortalSparksTuning

const TUNING_KEYS = Object.keys(SPARK_TUNING_DEFAULTS) as TuningKey[]

type DebugBg = 'none' | 'black' | 'white' | 'gray'

const PortalSparksConfigurator = () => {
  // Force re-render when sliders change
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick((t) => t + 1), [])

  // Debug state
  const [debugBg, setDebugBg] = useState<DebugBg>('none')
  const [debugNoMask, setDebugNoMask] = useState(false)
  const [debugIsolate, setDebugIsolate] = useState(false)
  const [pauseCycling, setPauseCycling] = useState(false)
  const [debugNoHalo, setDebugNoHalo] = useState(false)
  const [debugNoOverlay, setDebugNoOverlay] = useState(false)
  const [debugNoRing, setDebugNoRing] = useState(false)
  const [debugNoRingFade, setDebugNoRingFade] = useState(false)
  const [debugNoCoreContent, setDebugNoCoreContent] = useState(false)

  // Sync pause cycling to the global debug state
  useEffect(() => {
    SPARK_DEBUG.pauseCycling = pauseCycling
  }, [pauseCycling])

  // Apply debug classes and backdrop to the portal-preview element.
  // Use a MutationObserver to re-apply when the element is re-mounted during transitions.
  useEffect(() => {
    const BG_COLORS: Record<DebugBg, string> = { none: '', black: '#000', white: '#fff', gray: '#808080' }
    const applyDebug = () => {
      const el = document.querySelector('.portal-preview')
      if (!el) return

      el.classList.toggle('spark-debug-no-mask', debugNoMask)
      el.classList.toggle('spark-debug-isolate', debugIsolate)
      el.classList.toggle('spark-debug-no-halo', debugNoHalo)
      el.classList.toggle('spark-debug-no-overlay', debugNoOverlay)
      el.classList.toggle('spark-debug-no-ring', debugNoRing)
      el.classList.toggle('spark-debug-no-ring-fade', debugNoRingFade)
      el.classList.toggle('spark-debug-no-core-content', debugNoCoreContent)

      // Manage a backdrop div that sits behind the sparks canvas
      let backdrop = el.querySelector('.spark-debug-backdrop') as HTMLDivElement | null
      if (debugBg !== 'none') {
        if (!backdrop) {
          backdrop = document.createElement('div')
          backdrop.className = 'spark-debug-backdrop'
          backdrop.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0;'
          el.prepend(backdrop)
        }
        backdrop.style.background = BG_COLORS[debugBg]
      } else if (backdrop) {
        backdrop.remove()
      }
    }
    applyDebug()
    const observer = new MutationObserver(applyDebug)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [
    debugBg,
    debugNoMask,
    debugIsolate,
    debugNoHalo,
    debugNoOverlay,
    debugNoRing,
    debugNoRingFade,
    debugNoCoreContent
  ])

  // Track raw text per field so intermediate strings like "0." or "-" aren't clobbered
  const [editing, setEditing] = useState<Partial<Record<TuningKey, string>>>({})

  const handleSliderChange = (key: TuningKey, value: number) => {
    SPARK_TUNING[key] = value
    setEditing((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    rerender()
  }

  const handleInputChange = (key: TuningKey, raw: string) => {
    setEditing((prev) => ({ ...prev, [key]: raw }))
    const value = parseFloat(raw)
    if (!isNaN(value)) {
      SPARK_TUNING[key] = value
    }
    rerender()
  }

  const handleInputBlur = (key: TuningKey) => {
    setEditing((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    rerender()
  }

  const handleReset = () => {
    for (const key of TUNING_KEYS) {
      SPARK_TUNING[key] = SPARK_TUNING_DEFAULTS[key]
    }
    setEditing({})
    rerender()
  }

  const handleSave = () => {
    invoke('write-spark-tuning', { ...SPARK_TUNING })
  }

  return (
    <div
      className="
        pointer-events-auto fixed inset-y-0 right-0 z-100 w-[320px] overflow-y-auto bg-black/80 p-3 font-mono text-xs
        text-white backdrop-blur-sm select-none
      "
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-3">
        <span className="text-sm font-bold tracking-wide">Spark Tuning</span>
      </div>
      {TUNING_KEYS.map((key) => {
        const defaultVal = SPARK_TUNING_DEFAULTS[key]
        const current = SPARK_TUNING[key]
        const sliderMax = Math.abs(defaultVal) * 10 || 10
        const sliderMin = defaultVal < 0 ? -sliderMax : 0
        const step = sliderMax / 1000
        const displayValue = editing[key] ?? String(current)

        const modified = current !== defaultVal

        return (
          <div key={key} className="mb-2">
            <label className="mb-0.5 block text-[10px] text-white/60">{key}</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={sliderMin}
                max={sliderMax}
                step={step}
                value={Math.max(sliderMin, Math.min(sliderMax, current))}
                onChange={(e) => handleSliderChange(key, parseFloat(e.target.value))}
                className="h-1 flex-1 accent-orange-400"
              />
              <input
                type="text"
                value={displayValue}
                onChange={(e) => handleInputChange(key, e.target.value)}
                onBlur={() => handleInputBlur(key)}
                className="
                  w-[72px] rounded-sm border border-white/20 bg-white/10 px-1.5 py-0.5 text-right text-[11px] text-white
                "
              />
              <button
                type="button"
                className={`
                  flex size-4 items-center justify-center rounded-sm text-[10px] leading-none
                  ${
                    modified
                      ? `
                        bg-white/10 text-white/80
                        hover:bg-white/20
                      `
                      : 'pointer-events-none text-white/10'
                  }
                `}
                onClick={() => handleSliderChange(key, defaultVal)}
                title={`Reset to ${defaultVal}`}
              >
                x
              </button>
            </div>
          </div>
        )
      })}
      <div className="mt-4 mb-2 border-t border-white/20 pt-3">
        <span className="text-sm font-bold tracking-wide">Debug Composite</span>
        <div className="mt-2 space-y-1.5">
          <div>
            <label className="mb-0.5 block text-[10px] text-white/60">Background behind sparks</label>
            <div className="flex gap-1">
              {(['none', 'black', 'white', 'gray'] as DebugBg[]).map((bg) => (
                <button
                  key={bg}
                  type="button"
                  className={`
                    rounded-sm px-2 py-0.5 text-[10px]
                    ${
                      debugBg === bg
                        ? 'bg-orange-500/80'
                        : `
                          bg-white/10
                          hover:bg-white/20
                        `
                    }
                  `}
                  onClick={() => setDebugBg(bg)}
                >
                  {bg}
                </button>
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[10px]">
            <input type="checkbox" checked={pauseCycling} onChange={(e) => setPauseCycling(e.target.checked)} />
            <span>Pause background cycling</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[10px]">
            <input type="checkbox" checked={debugNoMask} onChange={(e) => setDebugNoMask(e.target.checked)} />
            <span>Disable mask (radial fade)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[10px]">
            <input type="checkbox" checked={debugIsolate} onChange={(e) => setDebugIsolate(e.target.checked)} />
            <span>Hide portal (isolate sparks)</span>
          </label>
          <div className="mt-2">
            <label className="mb-0.5 block text-[10px] text-white/60">Portal sub-layers</label>
            <label className="flex cursor-pointer items-center gap-2 text-[10px]">
              <input type="checkbox" checked={debugNoHalo} onChange={(e) => setDebugNoHalo(e.target.checked)} />
              <span>Hide halo glow</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[10px]">
              <input type="checkbox" checked={debugNoOverlay} onChange={(e) => setDebugNoOverlay(e.target.checked)} />
              <span>Hide core overlay (vignette)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[10px]">
              <input type="checkbox" checked={debugNoRing} onChange={(e) => setDebugNoRing(e.target.checked)} />
              <span>Hide core ring (border)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[10px]">
              <input type="checkbox" checked={debugNoRingFade} onChange={(e) => setDebugNoRingFade(e.target.checked)} />
              <span>Hide ring fade (blurred borders)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[10px]">
              <input
                type="checkbox"
                checked={debugNoCoreContent}
                onChange={(e) => setDebugNoCoreContent(e.target.checked)}
              />
              <span>Hide core content (video)</span>
            </label>
          </div>
        </div>
      </div>
      <div className="sticky bottom-0 flex justify-end gap-1 bg-black/80 pt-2 pb-1">
        <button
          type="button"
          className="
            rounded-sm bg-white/10 px-2 py-0.5 text-[10px]
            hover:bg-white/20
          "
          onClick={handleReset}
        >
          Reset
        </button>
        <button
          type="button"
          className="
            rounded-sm bg-orange-500/80 px-2 py-0.5 text-[10px]
            hover:bg-orange-500
          "
          onClick={handleSave}
        >
          Save
        </button>
      </div>
    </div>
  )
}

export default PortalSparksConfigurator
