import { useRef, useEffect, useCallback } from 'react'
import { usePortal } from '../context/PortalContext'
import { useStreaming } from '../context/StreamingContextShared'
import PortalBackgrounds from './PortalBackgrounds'
import VideoMask from './VideoMask'
import TerminalDisplay from './TerminalDisplay'
import PauseOverlay from './PauseOverlay'
import ShutdownOverlay from './ShutdownOverlay'
import ConnectionLostOverlay from './ConnectionLostOverlay'

const VideoContainer = () => {
  const { isConnected: portalConnected, isExpanded, isShuttingDown } = usePortal()
  const {
    isStreaming,
    isPaused,
    settingsOpen,
    isVideoReady,
    registerContainerRef,
    registerCanvasRef,
    handleContainerClick,
    isPointerLocked
  } = useStreaming()

  const containerRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    if (containerRef.current) {
      registerContainerRef(containerRef.current)
    }
  }, [registerContainerRef])

  // Callback ref for canvas - registers immediately when element mounts
  const handleCanvasRef = useCallback(
    (element) => {
      canvasRef.current = element
      registerCanvasRef(element)
    },
    [registerCanvasRef]
  )

  const containerClasses = [
    'video-container',
    portalConnected ? 'connected' : '',
    isExpanded ? 'expanded' : '',
    isPaused ? 'paused' : '',
    isStreaming ? 'streaming' : '',
    isPointerLocked ? 'pointer-locked' : ''
  ]
    .filter(Boolean)
    .join(' ')

  // Show media when we have frames and portal is connected
  // The actual visibility is controlled by CSS opacity based on expanded state
  const showMedia = isVideoReady && portalConnected

  const mediaStyle = {
    display: showMedia ? 'block' : 'none',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: showMedia ? 10 : 1
  }

  return (
    <div ref={containerRef} className={containerClasses} onClick={handleContainerClick}>
      <div className="video-container-inner">
        {!showMedia && <PortalBackgrounds />}

        {/* Canvas for WebSocket base64 frames */}
        <canvas ref={handleCanvasRef} width={1280} height={720} className="streaming-frame" style={mediaStyle} />

        <PauseOverlay isActive={settingsOpen && isStreaming && !isShuttingDown} />
        <ConnectionLostOverlay />
        <TerminalDisplay />
        <VideoMask />
        <ShutdownOverlay />
      </div>
    </div>
  )
}

export default VideoContainer
