import { useState, useEffect } from 'react'
import { PortalProvider, usePortal } from './context/PortalContext'
import { StreamingProvider } from './context/StreamingContext'
import Titlebar from './components/Titlebar'
import VideoContainer from './components/VideoContainer'
import HudOverlay from './components/HudOverlay'
import BottomPanel from './components/BottomPanel'
import SettingsPanel from './components/SettingsPanel'
import WindowAnchors from './components/WindowAnchors'

const HoloFrame = () => {
  const [isReady, setIsReady] = useState(false)
  const { isConnected } = usePortal()

  // Force animation replay on mount by briefly removing the animated class
  useEffect(() => {
    // Small delay to ensure DOM is ready, then trigger animations
    const timer = requestAnimationFrame(() => {
      setIsReady(true)
    })
    return () => cancelAnimationFrame(timer)
  }, [])

  return (
    <div className={`holo-frame ${isReady ? 'animate' : ''} ${isConnected ? 'keyboard-open' : ''}`}>
      <div className="holo-frame-inner">
        <Titlebar />

        <main className="content-area">
          <VideoContainer />
          <div className="logo-container" id="logo-container"></div>
          <SettingsPanel />
        </main>

        <HudOverlay />

        {/* Bottom panel - always visible when streaming connected */}
        {isConnected && <BottomPanel isOpen={true} />}
      </div>
    </div>
  )
}

const App = () => {
  return (
    <PortalProvider>
      <StreamingProvider>
        <WindowAnchors />
        <HoloFrame />
      </StreamingProvider>
    </PortalProvider>
  )
}

export default App
