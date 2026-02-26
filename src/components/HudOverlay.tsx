import HudVideoFrame from './HudVideoFrame'
import StatsDisplay from './StatsDisplay'

const HudOverlay = () => {
  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
      <div className="absolute left-[10%] top-[14%] w-[80%] h-[72%] pointer-events-none z-10 flex items-center justify-center overflow-visible">
        <HudVideoFrame />
      </div>
      <StatsDisplay />
    </div>
  )
}

export default HudOverlay
