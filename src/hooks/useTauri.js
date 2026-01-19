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

// Hook to constrain window aspect ratio within a range (width/height)
// maxRatio: maximum allowed ratio (e.g. 2 means width can be at most 2x height)
// minRatio: minimum allowed ratio (e.g. 1.25 means width must be at least 1.25x height)
export const useAspectRatioConstraint = (maxRatio = 2, minRatio = 1.25, debounceMs = 350) => {
  const appWindow = useRef(null)
  const isAdjusting = useRef(false)
  const debounceTimer = useRef(null)
  const lastBounds = useRef(null)

  useEffect(() => {
    appWindow.current = getCurrentWindow()
    if (!appWindow.current) return

    let unlisten = null

    const updateLastBounds = async () => {
      if (isAdjusting.current || !appWindow.current) return

      const size = await appWindow.current.innerSize()
      const position = await appWindow.current.outerPosition()
      lastBounds.current = {
        x: position.x / window.devicePixelRatio,
        y: position.y / window.devicePixelRatio,
        width: size.width / window.devicePixelRatio,
        height: size.height / window.devicePixelRatio
      }
    }

    // Initialize lastBounds
    updateLastBounds()

    const constrainAspectRatio = async () => {
      if (isAdjusting.current || !appWindow.current) return

      const size = await appWindow.current.innerSize()
      const position = await appWindow.current.outerPosition()
      const width = size.width / window.devicePixelRatio
      const height = size.height / window.devicePixelRatio
      const x = position.x / window.devicePixelRatio
      const y = position.y / window.devicePixelRatio

      const ratio = width / height

      console.log('[AspectRatio] Current:', { x, y, width, height, ratio })
      console.log('[AspectRatio] Bounds:', { maxRatio, minRatio })

      let newWidth = width
      let newHeight = height

      // Check if ratio exceeds bounds
      if (ratio > maxRatio) {
        // Too wide - constrain width
        newWidth = Math.round(height * maxRatio)
        console.log('[AspectRatio] Too wide, constraining width to:', newWidth)
      } else if (ratio < minRatio) {
        // Too tall - constrain height
        newHeight = Math.round(width / minRatio)
        console.log('[AspectRatio] Too tall, constraining height to:', newHeight)
      } else {
        // Ratio is within bounds, update lastBounds and return
        console.log('[AspectRatio] Within bounds, no adjustment needed')
        lastBounds.current = { x, y, width, height }
        return
      }

      // Determine which edges were being dragged by comparing to last known good bounds
      // An edge was dragged if the position changed (for left/top) or size changed while position stayed (for right/bottom)
      const prev = lastBounds.current || { x, y, width, height }

      const leftMoved = Math.abs(x - prev.x) > 1
      const topMoved = Math.abs(y - prev.y) > 1
      const rightMoved = Math.abs(x + width - (prev.x + prev.width)) > 1
      const bottomMoved = Math.abs(y + height - (prev.y + prev.height)) > 1

      console.log('[AspectRatio] Prev bounds:', prev)
      console.log('[AspectRatio] Edge detection:', { leftMoved, topMoved, rightMoved, bottomMoved })

      let newX = x
      let newY = y

      // The goal: center the new constrained window on the center of the unconstrained window,
      // but anchor the edge that was NOT being dragged.

      // Horizontal adjustment
      if (newWidth !== width) {
        const widthDelta = width - newWidth
        // Center of the unconstrained window
        const unconstrainedCenterX = x + width / 2

        if (rightMoved && !leftMoved) {
          // Dragged right edge - center new window on unconstrained center
          newX = unconstrainedCenterX - newWidth / 2
          console.log('[AspectRatio] Right edge dragged, centering on unconstrained center. newX:', newX)
        } else if (leftMoved && !rightMoved) {
          // Dragged left edge - center new window on unconstrained center
          newX = unconstrainedCenterX - newWidth / 2
          console.log('[AspectRatio] Left edge dragged, centering on unconstrained center. newX:', newX)
        } else {
          // Both or neither - center horizontally on unconstrained center
          newX = unconstrainedCenterX - newWidth / 2
          console.log('[AspectRatio] Centering horizontally on unconstrained center. newX:', newX)
        }
      }

      // Vertical adjustment
      if (newHeight !== height) {
        const heightDelta = height - newHeight
        // Center of the unconstrained window
        const unconstrainedCenterY = y + height / 2

        if (bottomMoved && !topMoved) {
          // Dragged bottom edge - center new window on unconstrained center
          newY = unconstrainedCenterY - newHeight / 2
        } else if (topMoved && !bottomMoved) {
          // Dragged top edge - center new window on unconstrained center
          newY = unconstrainedCenterY - newHeight / 2
        } else {
          // Both or neither - center vertically on unconstrained center
          newY = unconstrainedCenterY - newHeight / 2
        }
      }

      newX = Math.round(newX)
      newY = Math.round(newY)

      console.log('[AspectRatio] Applying:', { newX, newY, newWidth, newHeight })

      isAdjusting.current = true
      try {
        await appWindow.current.setPosition(new window.__TAURI__.dpi.LogicalPosition(newX, newY))
        await appWindow.current.setSize(new window.__TAURI__.dpi.LogicalSize(newWidth, newHeight))
        console.log('[AspectRatio] Applied successfully')
      } catch (e) {
        console.error('[AspectRatio] Error applying:', e)
      }

      // Update lastBounds to the new constrained bounds
      lastBounds.current = { x: newX, y: newY, width: newWidth, height: newHeight }
      isAdjusting.current = false
    }

    const debouncedConstrain = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
      debounceTimer.current = setTimeout(constrainAspectRatio, debounceMs)
    }

    const setupListener = async () => {
      unlisten = await appWindow.current.onResized(debouncedConstrain)
    }

    setupListener()

    return () => {
      if (unlisten) unlisten()
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [maxRatio, minRatio, debounceMs])
}
