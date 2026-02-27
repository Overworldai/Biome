import { useRef, useEffect, useCallback } from 'react'
import { useStreaming } from '../context/StreamingContext'

const VideoContainer = () => {
  const { isStreaming, isPaused, registerContainerRef, registerCanvasRef, handleContainerClick, isPointerLocked } =
    useStreaming()

  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (containerRef.current) {
      registerContainerRef(containerRef.current)
    }
  }, [registerContainerRef])

  const handleCanvasRef = useCallback(
    (element: HTMLCanvasElement | null) => {
      registerCanvasRef(element)
    },
    [registerCanvasRef]
  )

  const cursorClass = isPointerLocked
    ? 'cursor-none'
    : isPaused
      ? 'cursor-default'
      : isStreaming
        ? 'cursor-crosshair'
        : ''

  return (
    <div
      ref={containerRef}
      className={`video-container absolute inset-0 z-0 overflow-visible bg-black flex items-center justify-center ${cursorClass}`}
      onClick={handleContainerClick}
    >
      <canvas
        ref={handleCanvasRef}
        width={1280}
        height={720}
        className={`absolute inset-0 w-full h-full object-cover pointer-events-none select-none ${isPaused ? 'saturate-[0.62] brightness-[0.8]' : ''}`}
      />
    </div>
  )
}

export default VideoContainer
