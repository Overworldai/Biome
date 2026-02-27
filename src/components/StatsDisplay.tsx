import { useStreaming } from '../context/StreamingContext'

const StatsDisplay = () => {
  const { stats, isStreaming, showStats } = useStreaming()

  if (!isStreaming || !showStats) return null

  return (
    <div className="absolute top-[6.5%] right-[33%] flex gap-[1.5cqw] font-mono text-[1.25cqw] tracking-wide text-hud/50 [text-shadow:0_0_4px_rgba(120,255,245,0.2)] pointer-events-none z-[105]">
      <span className="uppercase">GEN {stats.gentime}ms</span>
      <span className="uppercase">RTT {stats.rtt}ms</span>
    </div>
  )
}

export default StatsDisplay
