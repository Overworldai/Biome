import { useEffect, useRef, useState } from 'react'
import { useStreaming } from '../context/StreamingContext'
import Sparkline from './Sparkline'

const BUFFER_SIZE = 60
const FT_WINDOW_MS = 1000
const SPARK_W = 48
const SPARK_H = 14

/** Colors matching design tokens in app.css */
const COLOR_HUD = '#78fff5'
const COLOR_WARM = '#ffc864'
const COLOR_GOOD = '#64ff96'
const COLOR_ERROR = '#ff7878'
const COLOR_LABEL = 'rgba(255,255,255,0.5)'

const OVERLAY_BG = 'bg-black/50'
const OVERLAY_BORDER = 'border border-white/20'
const OVERLAY_TEXT = 'font-mono text-[1.6cqh] leading-[2.2cqh]'

const useRingBuffer = () => {
  const bufRef = useRef<number[]>([])
  const push = (value: number) => {
    bufRef.current.push(value)
    if (bufRef.current.length > BUFFER_SIZE) {
      bufRef.current = bufRef.current.slice(-BUFFER_SIZE)
    }
  }
  return { values: bufRef.current.slice(), push }
}

const colorForPercent = (pct: number) => {
  if (pct < 60) return COLOR_GOOD
  if (pct <= 85) return COLOR_WARM
  return COLOR_ERROR
}

const formatValue = (v: number, unavailable = -1) => (v === unavailable ? 'N/A' : v.toString())

const formatElapsed = (seconds: number) => {
  const totalSec = Math.floor(seconds)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

type FrametimeStats = { mean: number; stddev: number; min: number; max: number; p1: number; p99: number }

const computeFrametimeStats = (entries: { time: number; value: number }[]): FrametimeStats | null => {
  const now = performance.now()
  const samples = entries.filter((e) => e.time >= now - FT_WINDOW_MS).map((e) => e.value)
  if (samples.length < 2) return null
  const sorted = samples.slice().sort((a, b) => a - b)
  const n = sorted.length
  const mean = samples.reduce((a, b) => a + b, 0) / n
  const stddev = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  const pct = (p: number) => sorted[Math.floor(p * (n - 1))]
  return { mean, stddev, min: sorted[0], max: sorted[n - 1], p1: pct(0.01), p99: pct(0.99) }
}

const PerformanceStatsOverlay = () => {
  const { performanceStatsOverlay, isStreaming, connection, inputLatency, latentGenMs, temporalCompression, frameId } =
    useStreaming()
  const [, setTick] = useState(0)
  const [ftStats, setFtStats] = useState<FrametimeStats | null>(null)

  // Ring buffers for sparklines
  const fpsBuf = useRingBuffer()
  const lfpsBuf = useRingBuffer()
  const genBuf = useRingBuffer()
  const vramBuf = useRingBuffer()
  const gpuBuf = useRingBuffer()
  const latBuf = useRingBuffer()
  const ftBufRef = useRef<{ time: number; value: number }[]>([])

  // Derive LFPS and FPS from gen time
  const latentFps = latentGenMs !== null && latentGenMs > 0 ? 1000 / latentGenMs : 0
  const perceivedFps = latentFps * temporalCompression

  // Static identifiers come from the init payload; runtime metrics from frame headers.
  const systemInfo = connection.systemInfo
  const runtime = connection.runtime
  const vramTotalBytes = systemInfo?.vram_total_bytes ?? null
  const vramPercent =
    runtime && runtime.vramUsedBytes >= 0 && vramTotalBytes && vramTotalBytes > 0
      ? Math.round((runtime.vramUsedBytes / vramTotalBytes) * 1000) / 10
      : -1

  // Change-detection refs (all declared before any conditional logic)
  const prevRuntimeRef = useRef(runtime)
  const prevLatentGenMsRef = useRef(latentGenMs)
  const prevLatencyRef = useRef(inputLatency)

  // Push GPU metrics into ring buffers when they update
  if (runtime && runtime !== prevRuntimeRef.current) {
    prevRuntimeRef.current = runtime
    if (vramPercent >= 0) vramBuf.push(vramPercent)
    if (runtime.gpuUtilPercent >= 0) gpuBuf.push(runtime.gpuUtilPercent)
  }

  // Accumulate per-latent-pass gen times for sparklines and distribution stats
  if (latentGenMs !== null && latentGenMs !== prevLatentGenMsRef.current) {
    prevLatentGenMsRef.current = latentGenMs
    genBuf.push(latentGenMs)
    fpsBuf.push(perceivedFps)
    lfpsBuf.push(latentFps)
    const now = performance.now()
    ftBufRef.current.push({ time: now, value: latentGenMs })
    const cutoff = now - FT_WINDOW_MS
    while (ftBufRef.current.length > 0 && ftBufRef.current[0].time < cutoff) ftBufRef.current.shift()
  }

  // Push latency
  if (inputLatency !== null && inputLatency !== prevLatencyRef.current) {
    prevLatencyRef.current = inputLatency
    latBuf.push(inputLatency)
  }

  // Re-render at 2Hz to update sparklines and recompute frametime stats
  useEffect(() => {
    if (!performanceStatsOverlay || !isStreaming) return
    const interval = setInterval(() => {
      setTick((t) => t + 1)
      setFtStats(computeFrametimeStats(ftBufRef.current))
    }, 500)
    return () => clearInterval(interval)
  }, [performanceStatsOverlay, isStreaming])

  if (!performanceStatsOverlay || !isStreaming) return null

  const p = runtime?.profile ?? null

  return (
    <div
      className={`absolute top-[1.5cqh] left-[1.5cqh] z-10 pointer-events-none ${OVERLAY_BG} ${OVERLAY_BORDER} rounded-[0.4cqh] p-[1cqh] ${OVERLAY_TEXT}`}
    >
      <Row label="CPU" value={systemInfo?.cpu_name ?? '[Unknown CPU]'} color={COLOR_HUD} />
      <Row label="GPU" value={systemInfo?.gpu_name ?? '[Unknown GPU]'} color={COLOR_HUD} />
      <Row label="MDL" value={connection.model || '\u2014'} color={COLOR_WARM} />
      <Row
        label="ROLL"
        value={`${connection.inferenceFps ? formatElapsed(frameId / connection.inferenceFps) : '--'} (${frameId}f)`}
        color={COLOR_HUD}
        className="mb-[0.4cqh]"
      />
      <Row
        label="FPS"
        value={perceivedFps > 0 ? `${perceivedFps.toFixed(2)} fps` : '--'}
        color={COLOR_HUD}
        sparkValues={fpsBuf.values}
        sparkColor={COLOR_HUD}
      />
      {temporalCompression > 1 && (
        <Row
          label="LFPS"
          value={latentFps > 0 ? `${latentFps.toFixed(2)} lfps` : '--'}
          color={COLOR_HUD}
          sparkValues={lfpsBuf.values}
          sparkColor={COLOR_HUD}
        />
      )}
      <Row
        label="GEN"
        value={ftStats ? `${ftStats.mean.toFixed(1)} ms` : '--'}
        color={COLOR_WARM}
        sparkValues={genBuf.values}
        sparkColor={COLOR_WARM}
      />
      <Row
        label="VRAM"
        value={
          runtime && runtime.vramUsedBytes >= 0
            ? vramTotalBytes
              ? `${Math.round(runtime.vramUsedBytes / (1024 * 1024))} / ${Math.round(vramTotalBytes / (1024 * 1024))} MB`
              : `${Math.round(runtime.vramUsedBytes / (1024 * 1024))} MB`
            : '--'
        }
        color={vramPercent >= 0 ? colorForPercent(vramPercent) : COLOR_HUD}
        sparkValues={vramBuf.values}
        sparkColor={vramPercent >= 0 ? colorForPercent(vramPercent) : COLOR_HUD}
        sparkMax={100}
      />
      <Row
        label="GPU"
        value={runtime ? `${formatValue(runtime.gpuUtilPercent)}%` : '--'}
        color={runtime && runtime.gpuUtilPercent >= 0 ? colorForPercent(runtime.gpuUtilPercent) : COLOR_HUD}
        sparkValues={gpuBuf.values}
        sparkColor={runtime && runtime.gpuUtilPercent >= 0 ? colorForPercent(runtime.gpuUtilPercent) : COLOR_HUD}
        sparkMax={100}
      />
      <Row
        label="LAT"
        value={inputLatency !== null ? `${inputLatency} ms` : '--'}
        color={COLOR_WARM}
        sparkValues={latBuf.values}
        sparkColor={COLOR_WARM}
      />
      <div className="border-t border-white/15 mt-[0.5cqh] mb-[0.3cqh]" />
      <div className="flex gap-[1.5cqh]">
        <div className="flex-1">
          <div style={{ color: COLOR_LABEL }} className="text-center mb-[0.3cqh]">
            GEN stats
          </div>
          <Row label="MEAN" value={ftStats ? `${ftStats.mean.toFixed(1)} ms` : '--'} color={COLOR_WARM} />
          <Row label="SDEV" value={ftStats ? `${ftStats.stddev.toFixed(1)} ms` : '--'} color={COLOR_LABEL} />
          <Row label="MIN" value={ftStats ? `${ftStats.min.toFixed(1)} ms` : '--'} color={COLOR_GOOD} />
          <Row label="P1" value={ftStats ? `${ftStats.p1.toFixed(1)} ms` : '--'} color={COLOR_GOOD} />
          <Row label="P99" value={ftStats ? `${ftStats.p99.toFixed(1)} ms` : '--'} color={COLOR_ERROR} />
          <Row label="MAX" value={ftStats ? `${ftStats.max.toFixed(1)} ms` : '--'} color={COLOR_ERROR} />
        </div>
        {p && (
          <div className="flex-1">
            <div style={{ color: COLOR_LABEL }} className="text-center mb-[0.3cqh]">
              Frame profile
            </div>
            <Row label="INFER" value={`${p.inferMs.toFixed(1)} ms`} color={COLOR_HUD} />
            <Row label="SYNC" value={`${p.syncMs.toFixed(1)} ms`} color={COLOR_WARM} />
            <Row label="ENC" value={`${p.encMs.toFixed(1)} ms`} color={COLOR_WARM} />
            <Row label="MTRC" value={`${p.metricsMs.toFixed(1)} ms`} color={COLOR_LABEL} />
            <Row label="OVER" value={`${p.overheadMs.toFixed(1)} ms`} color={COLOR_LABEL} />
            {inputLatency !== null && (
              <Row
                label="XMIT"
                value={`${Math.max(0, inputLatency - p.inferMs - p.syncMs - p.encMs - p.metricsMs - p.overheadMs).toFixed(1)} ms`}
                color={COLOR_ERROR}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type RowProps = {
  label: string
  value: string
  color: string
  sparkValues?: number[]
  sparkColor?: string
  sparkMax?: number
  className?: string
}

const Row = ({ label, value, color, sparkValues, sparkColor, sparkMax, className = '' }: RowProps) => (
  <div className={`flex items-center gap-[0.8cqh] ${className}`}>
    <span className={`text-[${COLOR_LABEL}] w-[5.5cqh] text-right shrink-0`}>{label}</span>
    {sparkValues !== undefined ? (
      <>
        <span style={{ color }} className="w-[14cqh] shrink-0 tabular-nums">
          {value}
        </span>
        <Sparkline values={sparkValues} width={SPARK_W} height={SPARK_H} color={sparkColor!} maxValue={sparkMax} />
      </>
    ) : (
      <span style={{ color }} className="truncate">
        {value}
      </span>
    )}
  </div>
)

export default PerformanceStatsOverlay
