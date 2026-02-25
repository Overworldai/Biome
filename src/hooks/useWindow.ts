import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke, listen } from '../bridge'

export const useWindow = () => {
  const setSize = useCallback(async (width: number, height: number) => {
    await invoke('window-set-size', width, height)
  }, [])

  const getSize = useCallback(async () => {
    try {
      return await invoke('window-get-size')
    } catch {
      return { width: 800, height: 500 }
    }
  }, [])

  const setPosition = useCallback(async (x: number, y: number) => {
    await invoke('window-set-position', x, y)
  }, [])

  const getPosition = useCallback(async () => {
    try {
      return await invoke('window-get-position')
    } catch {
      return { x: 0, y: 0 }
    }
  }, [])

  return {
    setSize,
    getSize,
    setPosition,
    getPosition
  }
}

export const useFitWindowToContent = (contentAspectRatio = 800 / 500, debounceMs = 250) => {
  const isAdjusting = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSetSize = useRef<{ width: number; height: number } | null>(null)
  const { setSize, getSize, setPosition, getPosition } = useWindow()

  useEffect(() => {
    const fitToContent = async () => {
      if (isAdjusting.current) return

      const size = await getSize()
      const position = await getPosition()
      const { width, height } = size
      const { x, y } = position

      const windowRatio = width / height
      let contentWidth: number
      let contentHeight: number

      if (windowRatio > contentAspectRatio) {
        contentHeight = height
        contentWidth = height * contentAspectRatio
      } else {
        contentWidth = width
        contentHeight = width / contentAspectRatio
      }

      if (Math.abs(width - contentWidth) < 1 && Math.abs(height - contentHeight) < 1) {
        return
      }

      const newWidth = Math.round(contentWidth)
      const newHeight = Math.round(contentHeight)
      const centerX = x + width / 2
      const centerY = y + height / 2
      const newX = Math.round(centerX - newWidth / 2)
      const newY = Math.round(centerY - newHeight / 2)

      lastSetSize.current = { width: newWidth, height: newHeight }
      isAdjusting.current = true
      try {
        await Promise.all([setPosition(newX, newY), setSize(newWidth, newHeight)])
      } catch (e) {
        console.error('[FitToContent] Error:', e)
      }
      isAdjusting.current = false
    }

    const debouncedFit = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
      debounceTimer.current = setTimeout(fitToContent, debounceMs)
    }

    const onResized = (payload: { width: number; height: number }) => {
      if (lastSetSize.current) {
        const width = Math.round(payload.width)
        const height = Math.round(payload.height)

        if (width === lastSetSize.current.width && height === lastSetSize.current.height) {
          return
        }
      }
      debouncedFit()
    }

    const unlisten = listen('window-resized', onResized)

    return () => {
      unlisten()
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [contentAspectRatio, debounceMs, setSize, getSize, setPosition, getPosition])
}
