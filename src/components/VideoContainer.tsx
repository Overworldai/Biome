import { useRef, useEffect, useCallback } from 'react'
import { useStreaming } from '../context/streamingContextValue'

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
      className={`
        video-container absolute inset-0 z-0 flex items-center justify-center overflow-visible bg-black
        ${cursorClass}
      `}
      onClick={handleContainerClick}
    >
      <canvas
        ref={handleCanvasRef}
        width={1280}
        height={720}
        className={`
          pointer-events-none absolute inset-0 size-full object-cover select-none
          ${isPaused ? 'brightness-[0.8] saturate-[0.62]' : ''}
        `}
      />
    </div>
  )
}

export default VideoContainer
