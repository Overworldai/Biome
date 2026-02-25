import HudBackground from './HudBackground'
import HudVideoFrame from './HudVideoFrame'
import StatsDisplay from './StatsDisplay'

const HudOverlay = () => {
  return (
    <div className="hud-overlay">
      <HudBackground />
      <div className="hud-video-frame-container">
        <HudVideoFrame />
      </div>
      <StatsDisplay />
    </div>
  )
}

export default HudOverlay
