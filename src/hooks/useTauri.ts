import { useState, useEffect, useRef } from 'react'

// Get the current window
export const getCurrentWindow = () => {
  return window.__TAURI__.window.getCurrentWindow()
}

// Hook to get Tauri window controls
export const useTauriWindow = () => {
  const [appWindow, setAppWindow] = useState(null)

  useEffect(() => {
    setAppWindow(getCurrentWindow())
  }, [])

  const minimize = () => appWindow?.minimize()
  const maximize = async () => {
    if (appWindow) {
      if (await appWindow.isMaximized()) {
        appWindow.unmaximize()
      } else {
        appWindow.maximize()
      }
    }
  }
  const close = () => appWindow?.close()

  const setSize = async (width, height) => {
    if (appWindow) {
      await appWindow.setSize(new window.__TAURI__.dpi.LogicalSize(width, height))
    }
  }

  const getSize = async () => {
    if (appWindow) {
      const size = await appWindow.innerSize()
      return {
        width: size.width / window.devicePixelRatio,
        height: size.height / window.devicePixelRatio
      }
    }
    return { width: 800, height: 500 }
  }

  return {
    appWindow,
    minimize,
    maximize,
    close,
    setSize,
    getSize
  }
}

// Hook to resize window to fit content after resize stops
// Content maintains 800:500 (1.6) aspect ratio - snaps window to fit
export const useFitWindowToContent = (contentAspectRatio = 800 / 500, debounceMs = 250) => {
  const appWindow = useRef(null)
  const isAdjusting = useRef(false)
  const debounceTimer = useRef(null)
  const lastSetSize = useRef(null)

  useEffect(() => {
    appWindow.current = getCurrentWindow()
    if (!appWindow.current) return

    let unlisten = null

    const fitToContent = async () => {
      if (isAdjusting.current || !appWindow.current) return

      const size = await appWindow.current.innerSize()
      const position = await appWindow.current.outerPosition()
      const width = size.width / window.devicePixelRatio
      const height = size.height / window.devicePixelRatio
      const x = position.x / window.devicePixelRatio
      const y = position.y / window.devicePixelRatio

      // Calculate content size based on aspect ratio
      const windowRatio = width / height
      let contentWidth, contentHeight

      if (windowRatio > contentAspectRatio) {
        // Window is wider than content - content is height-constrained
        contentHeight = height
        contentWidth = height * contentAspectRatio
      } else {
        // Window is taller than content - content is width-constrained
        contentWidth = width
        contentHeight = width / contentAspectRatio
      }

      // If window already fits content (within 1px tolerance), no adjustment needed
      if (Math.abs(width - contentWidth) < 1 && Math.abs(height - contentHeight) < 1) {
        return
      }

      // New window size = content size
      const newWidth = Math.round(contentWidth)
      const newHeight = Math.round(contentHeight)

      // Center the new window on the old window's center
      const centerX = x + width / 2
      const centerY = y + height / 2
      const newX = Math.round(centerX - newWidth / 2)
      const newY = Math.round(centerY - newHeight / 2)

      // Remember the size we're setting so we can ignore events from it
      lastSetSize.current = { width: newWidth, height: newHeight }

      isAdjusting.current = true
      try {
        // Issue both calls in parallel to reduce judder
        await Promise.all([
          appWindow.current.setPosition(new window.__TAURI__.dpi.LogicalPosition(newX, newY)),
          appWindow.current.setSize(new window.__TAURI__.dpi.LogicalSize(newWidth, newHeight))
        ])
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

    const onResized = async () => {
      // Ignore resize events that match our last set size (triggered by our own adjustment)
      if (lastSetSize.current && appWindow.current) {
        const size = await appWindow.current.innerSize()
        const width = Math.round(size.width / window.devicePixelRatio)
        const height = Math.round(size.height / window.devicePixelRatio)

        if (width === lastSetSize.current.width && height === lastSetSize.current.height) {
          return
        }
      }

      debouncedFit()
    }

    const setupListener = async () => {
      unlisten = await appWindow.current.onResized(onResized)
    }

    setupListener()

    return () => {
      if (unlisten) unlisten()
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [contentAspectRatio, debounceMs])
}
