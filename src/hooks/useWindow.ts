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
      return { width: 800, height: 450 }
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

  const minimize = useCallback(async () => {
    await invoke('window-minimize')
  }, [])

  const toggleMaximize = useCallback(async () => {
    await invoke('window-toggle-maximize')
  }, [])

  const close = useCallback(async () => {
    await invoke('window-close')
  }, [])

  return {
    setSize,
    getSize,
    setPosition,
    getPosition,
    minimize,
    toggleMaximize,
    close
  }
}
