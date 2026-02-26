import { useState, useEffect, useRef } from 'react'

type TauriWindowApi = ReturnType<typeof window.__TAURI__.window.getCurrentWindow>

export const getCurrentWindow = (): TauriWindowApi => {
  return window.__TAURI__.window.getCurrentWindow()
}

export const useTauriWindow = () => {
  const [appWindow, setAppWindow] = useState<TauriWindowApi | null>(null)

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

  const setSize = async (width: number, height: number) => {
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
    return { width: 800, height: 450 }
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

export const useFitWindowToContent = (contentAspectRatio = 16 / 9, debounceMs = 250) => {
  const appWindow = useRef<TauriWindowApi | null>(null)
  const isAdjusting = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSetSize = useRef<{ width: number; height: number } | null>(null)

  useEffect(() => {
    appWindow.current = getCurrentWindow()
    if (!appWindow.current) return

    let unlisten: (() => void) | null = null

    const fitToContent = async () => {
      if (isAdjusting.current || !appWindow.current) return

      const size = await appWindow.current.innerSize()
      const position = await appWindow.current.outerPosition()
      const width = size.width / window.devicePixelRatio
      const height = size.height / window.devicePixelRatio
      const x = position.x / window.devicePixelRatio
      const y = position.y / window.devicePixelRatio

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
      if (!appWindow.current) return
      unlisten = await appWindow.current.onResized(onResized)
    }

    setupListener()

    return () => {
      unlisten?.()
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [contentAspectRatio, debounceMs])
}
