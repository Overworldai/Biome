import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** Frame ref bag — the canvas-render path reads `gen_ms` /
 *  `temporal_compression` / `frame_id` from useWebSocket via mutable
 *  refs (not state) so per-frame updates don't trip a React render. */
type FrameMetricsRefs = {
  gen: RefObject<number>
  compression: RefObject<number>
  id: RefObject<number>
}

type FrameTimeline = { currentIndex: number; slotDisplayAts: (number | null)[] }

/** Owns the canvas-render pipeline: a bitmap decode + scheduling queue
 *  fed from incoming frame Blobs, and a rAF draw loop that draws each
 *  bitmap once its scheduled `displayAt` arrives. The `frameTimelineRef`
 *  it returns is consumed by the timeline-overlay UI to visualise where
 *  in the current batch we are.
 *
 *  Multiframe scheduling: when the server runs the model with
 *  `temporal_compression > 1`, a single forward pass produces N frames
 *  back-to-back. Naively rendering them as they arrive front-loads the
 *  whole batch then stalls; here we chain them via `lastScheduledAtRef`
 *  spaced by `genMs / N` so they spread evenly across the generation
 *  interval regardless of display refresh rate. */
export function useFrameRenderer(opts: { frame: Blob | string | null; refs: FrameMetricsRefs }): {
  registerCanvas: (element: HTMLCanvasElement | null) => void
  canvasReady: boolean
  frameTimelineRef: RefObject<FrameTimeline>
} {
  const { frame, refs } = opts
  const { gen: frameGenMsRef, compression: frameTemporalCompressionRef, id: frameIdRef } = refs

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [canvasReady, setCanvasReady] = useState(false)
  const bitmapQueueRef = useRef<{ bitmap: ImageBitmap; displayAt: number; frameId: number; genMs: number }[]>([])
  const lastScheduledAtRef = useRef<number>(0)
  // Batch-relative timeline for the frame timeline overlay.
  // slotDisplayAts[i] holds the actual scheduled displayAt for each frame in the
  // current 4-frame bundle. Updated when bitmaps are ready (not at effect time),
  // so values are always based on real decode completion times.
  const frameTimelineRef = useRef<FrameTimeline>({ currentIndex: 0, slotDisplayAts: [] })
  const drawRafRef = useRef<number | null>(null)

  // rAF draw loop: draws the next bitmap only once its scheduled time has arrived
  useEffect(() => {
    if (!canvasReady || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawTick = () => {
      const now = performance.now()
      // Defense-in-depth: if the queue has grown well beyond one batch worth
      // of lead (e.g. rAF was paused while the window was backgrounded), drop
      // the oldest bitmaps and snap the scheduling cursor back to now so new
      // frames display live instead of replaying stale history.
      const tc = frameTemporalCompressionRef.current
      const maxQueue = Math.max(tc * 2, 8)
      if (bitmapQueueRef.current.length > maxQueue) {
        const keep = Math.max(tc, 4)
        const dropCount = bitmapQueueRef.current.length - keep
        for (let i = 0; i < dropCount; i++) {
          bitmapQueueRef.current.shift()!.bitmap.close()
        }
        lastScheduledAtRef.current = 0
      }
      const item = bitmapQueueRef.current[0]
      if (item && now >= item.displayAt) {
        bitmapQueueRef.current.shift()
        frameTimelineRef.current.currentIndex = item.frameId % frameTemporalCompressionRef.current
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(item.bitmap, 0, 0, canvas.width, canvas.height)
        item.bitmap.close()
      }
      drawRafRef.current = requestAnimationFrame(drawTick)
    }
    drawRafRef.current = requestAnimationFrame(drawTick)

    return () => {
      if (drawRafRef.current !== null) cancelAnimationFrame(drawRafRef.current)
      for (const item of bitmapQueueRef.current) item.bitmap.close()
      bitmapQueueRef.current = []
      lastScheduledAtRef.current = 0
    }
  }, [canvasReady, frameTemporalCompressionRef])

  // Decode incoming frames off-thread and push to the draw queue.
  // displayAt is computed inside the .then() callback — i.e. once the bitmap is
  // actually ready — so that if all 4 decodes finish simultaneously the
  // lastScheduledAtRef chain still spaces them correctly, and no frame is
  // scheduled in the past just because decode was slow.
  useEffect(() => {
    if (!frame || !canvasReady) return

    const temporalCompression = frameTemporalCompressionRef.current
    const genMs = frameGenMsRef.current / temporalCompression
    const capturedFrameId = frameIdRef.current

    const source =
      frame instanceof Blob
        ? Promise.resolve(frame)
        : fetch(frame.startsWith('data:') ? frame : `data:image/jpeg;base64,${frame}`).then((r) => r.blob())

    source
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        const now = performance.now()
        // Display immediately when the queue is caught up (first frame of a new
        // batch), otherwise chain after the previously reserved slot.  The slot
        // reservation (lastScheduledAtRef) always advances by genMs so that
        // subsequent frames in the same batch are evenly spaced.
        //
        // Cap the forward lead: if the server bursts frames faster than the
        // reported genMs (warmup, model switch, backgrounded window) the cursor
        // can drift far into the future and latency accumulates without bound
        // (Overworldai/Biome#79).  Allow up to ~2 batches of lead, so intra-
        // batch spacing still works, but snap back if we overshoot.
        const batchMs = Math.max(temporalCompression * genMs, 16)
        const maxLeadMs = Math.max(2 * batchMs, 100)
        const cappedBase = Math.min(lastScheduledAtRef.current, now + maxLeadMs)
        const displayAt = Math.max(cappedBase, now)
        lastScheduledAtRef.current = displayAt + genMs

        const batchIndex = capturedFrameId % temporalCompression
        if (batchIndex === 0) {
          frameTimelineRef.current.slotDisplayAts = Array.from({ length: temporalCompression }, () => null)
        }
        frameTimelineRef.current.slotDisplayAts[batchIndex] = displayAt

        bitmapQueueRef.current.push({ bitmap, displayAt, frameId: capturedFrameId, genMs })
      })
      .catch(() => {})
  }, [frame, canvasReady, frameGenMsRef, frameIdRef, frameTemporalCompressionRef])

  const registerCanvas = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element
    setCanvasReady(!!element)
  }, [])

  return { registerCanvas, canvasReady, frameTimelineRef }
}
