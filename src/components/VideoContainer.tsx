import { useRef, useEffect, useCallback } from 'react'
import { useConnection } from '../context/streaming/connection'
import { useInput } from '../context/streaming/input'
import { useSession } from '../context/streaming/session'
import { useStreamingSurface } from '../context/streaming/surface'

const VideoContainer = () => {
  const { isStreaming } = useConnection()
  const session = useSession()
  const input = useInput()
  const { registerContainer, registerCanvas, handleContainerClick } = useStreamingSurface()

  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (containerRef.current) {
      registerContainer(containerRef.current)
    }
  }, [registerContainer])

  const handleCanvasRef = useCallback(
    (element: HTMLCanvasElement | null) => {
      registerCanvas(element)
    },
    [registerCanvas]
  )

  const cursorClass = input.pointerLock.isLocked
    ? 'cursor-none'
    : session.pause.kind === 'paused'
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
          ${session.pause.kind === 'paused' ? 'brightness-[0.8] saturate-[0.62]' : ''}
        `}
      />
    </div>
  )
}

export default VideoContainer
