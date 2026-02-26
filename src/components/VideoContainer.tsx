import { useRef, useEffect, useCallback, type CSSProperties } from 'react'
import { usePortal } from '../context/PortalContext'
import { useStreaming } from '../context/StreamingContext'

const VideoContainer = () => {
  const { isConnected: portalConnected, isExpanded } = usePortal()
  const {
    isStreaming,
    isPaused,
    isVideoReady,
    registerContainerRef,
    registerCanvasRef,
    handleContainerClick,
    isPointerLocked
  } = useStreaming()

  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (containerRef.current) {
      registerContainerRef(containerRef.current)
    }
  }, [registerContainerRef])

  // Callback ref for canvas - registers immediately when element mounts
  const handleCanvasRef = useCallback(
    (element: HTMLCanvasElement | null) => {
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

  const mediaStyle: CSSProperties = {
    display: showMedia ? 'block' : 'none',
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: showMedia ? 10 : 1
  }

  return (
    <div ref={containerRef} className={containerClasses} onClick={handleContainerClick}>
      {/* Canvas for WebSocket base64 frames */}
      <canvas ref={handleCanvasRef} width={1280} height={720} className="streaming-frame" style={mediaStyle} />
    </div>
  )
}

export default VideoContainer
