import { RESET_KEY_DISPLAY } from '../hooks/useGameInput'
import { useStreaming } from '../context/StreamingContextShared'

const PauseOverlay = ({ isActive }) => {
  const { canUnpause, unlockDelayMs, pauseElapsedMs } = useStreaming()

  const remainingMs = Math.max(0, unlockDelayMs - pauseElapsedMs)
  const remainingSeconds = (remainingMs / 1000).toFixed(1)

  return (
    <div className={`pause-overlay ${isActive ? 'active' : ''}`} id="pause-overlay">
      <div className="pause-scanlines"></div>
      <div className="pause-content">
        <span className="pause-indicator">PAUSED</span>
        <span className="pause-instruction">
          {canUnpause ? (
            'Click the feed to resume'
          ) : (
            <>Wait {remainingSeconds}s to resume</>
          )}
        </span>
        <span className="pause-instruction">Press {RESET_KEY_DISPLAY} to reset</span>
      </div>
    </div>
  )
}

export default PauseOverlay
