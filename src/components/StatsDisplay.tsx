import { useStreaming } from '../context/StreamingContext'

const StatsDisplay = () => {
  const { stats, isStreaming, showStats } = useStreaming()

  if (!isStreaming || !showStats) return null

  return (
    <div className="stats-display">
      <span className="stat">GEN {stats.gentime}ms</span>
      <span className="stat">RTT {stats.rtt}ms</span>
    </div>
  )
}

export default StatsDisplay
