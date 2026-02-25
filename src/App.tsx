import { useState, useEffect } from 'react'
import { ConfigProvider } from './hooks/useConfig'
import { PortalProvider, usePortal } from './context/PortalContext'
import { StreamingProvider, useStreaming } from './context/StreamingContext'
import { useFitWindowToContent } from './hooks/useTauri'
import { useAppStartup } from './hooks/useAppStartup'
import VideoContainer from './components/VideoContainer'
import BottomPanel from './components/BottomPanel'
import SettingsPanel from './components/SettingsPanel'
import BackgroundSlideshow from './components/BackgroundSlideshow'
import PortalPreview from './components/PortalPreview'
import useBackgroundCycle from './hooks/useBackgroundCycle'
import useSceneGlowColor from './hooks/useSceneGlowColor'

const HoloFrame = () => {
  const [isReady, setIsReady] = useState(false)
  const { isConnected, isSettingsOpen } = usePortal()
  const { bottomPanelHidden, setBottomPanelHidden } = useStreaming()
  const {
    images,
    currentIndex,
    nextIndex,
    isTransitioning,
    isPortalShrinking,
    transitionKey,
    portalVisible,
    isPortalEntering,
    completePortalShrink,
    completeTransition
  } = useBackgroundCycle()

  const nextScenePreview = images[nextIndex] ?? null
  const backgroundBlurPx = isSettingsOpen ? 8 : 2
  const portalGlowRgb = useSceneGlowColor(images, currentIndex)

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
        <BackgroundSlideshow
          images={images}
          currentIndex={currentIndex}
          nextIndex={nextIndex}
          blurPx={backgroundBlurPx}
          isTransitioning={isTransitioning}
          transitionKey={transitionKey}
          onTransitionComplete={completeTransition}
        />
        <PortalPreview
          image={nextScenePreview}
          visible={!isConnected && portalVisible}
          isShrinking={isPortalShrinking}
          isEntering={isPortalEntering}
          glowRgb={portalGlowRgb}
          onShrinkComplete={completePortalShrink}
        />

        <main className="content-area">
          <VideoContainer />
          <div className="logo-container" id="logo-container"></div>
          <SettingsPanel />
        </main>

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
          <HoloFrame />
        </StreamingProvider>
      </PortalProvider>
    </ConfigProvider>
  )
}

export default App
