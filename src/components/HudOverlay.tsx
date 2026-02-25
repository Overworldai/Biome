import HudVideoFrame from './HudVideoFrame'
import StatsDisplay from './StatsDisplay'

const HudOverlay = () => {
  return (
    <div className="hud-overlay">
      <div className="hud-video-frame-container">
        <HudVideoFrame />
      </div>
      <StatsDisplay />
    </div>
  )
}

export default HudOverlay
