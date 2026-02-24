import { useState, useEffect } from 'react'
import { ConfigProvider } from './hooks/useConfig'
import { PortalProvider, usePortal } from './context/PortalContext'
import { StreamingProvider, useStreaming } from './context/StreamingContext'
import { useFitWindowToContent } from './hooks/useTauri'
import { useAppStartup } from './hooks/useAppStartup'
import Titlebar from './components/Titlebar'
import VideoContainer from './components/VideoContainer'
import HudOverlay from './components/HudOverlay'
import BottomPanel from './components/BottomPanel'
import SettingsPanel from './components/SettingsPanel'
import WindowAnchors from './components/WindowAnchors'

const HoloFrame = () => {
  const [isReady, setIsReady] = useState(false)
  const { isConnected } = usePortal()
  const { bottomPanelHidden, setBottomPanelHidden } = useStreaming()

  // Force animation replay on mount by briefly removing the animated class
  useEffect(() => {
    // Small delay to ensure DOM is ready, then trigger animations
    const timer = requestAnimationFrame(() => {
      setIsReady(true)
    })
    return () => cancelAnimationFrame(timer)
  }, [])

  return (
    <div
      className={`holo-frame ${isReady ? 'animate' : ''} ${isConnected ? 'keyboard-open' : ''} ${bottomPanelHidden ? 'panel-hidden' : ''}`}
    >
      <div className="holo-frame-inner">
        <Titlebar />

        <main className="content-area">
          <VideoContainer />
          <div className="logo-container" id="logo-container"></div>
          <SettingsPanel />
        </main>

        <HudOverlay />

        {/* Bottom panel - always visible when streaming connected */}
        {isConnected && (
          <BottomPanel
            isOpen={true}
            isHidden={bottomPanelHidden}
            onToggleHidden={() => setBottomPanelHidden(!bottomPanelHidden)}
          />
        )}
      </div>
    </div>
  )
}

const App = () => {
  // Run startup tasks (unpack server files, etc.)
  useAppStartup()

  // Snap window to fit content after resize stops
  useFitWindowToContent()

  return (
    <ConfigProvider>
      <PortalProvider>
        <StreamingProvider>
          <WindowAnchors />
          <HoloFrame />
        </StreamingProvider>
      </PortalProvider>
    </ConfigProvider>
  )
}

export default App
