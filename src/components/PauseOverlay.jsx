import { useState, useEffect } from 'react'
import { RESET_KEY_DISPLAY } from '../hooks/useGameInput'

const UNLOCK_DELAY_MS = 1250 // Browsers require ~1s delay before pointer lock can be re-requested

const PauseOverlay = ({ isActive, pausedAt }) => {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (!isActive || !pausedAt) {
      setElapsedMs(0)
      return
    }

    // Update elapsed time every 50ms for smooth countdown
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - pausedAt)
    }, 50)

    return () => clearInterval(interval)
  }, [isActive, pausedAt])

  const canUnpause = elapsedMs >= UNLOCK_DELAY_MS
  const remainingMs = Math.max(0, UNLOCK_DELAY_MS - elapsedMs)
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
