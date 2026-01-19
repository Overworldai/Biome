import { useState, useEffect, useCallback, useRef } from 'react'

// Map keyboard codes to button names expected by the server
// Reserved keys (not sent): U (reset), ~ (menu), Escape (menu), alt (for user to alt tab out), tab (but only if alt is held down)
const KEY_MAP = {}

// Letters A-Z
for (let i = 65; i <= 90; i++) {
  const letter = String.fromCharCode(i)
  KEY_MAP[`Key${letter}`] = letter
}
// Remove U - reserved for reset
delete KEY_MAP['KeyU']

// Numbers 0-9
for (let i = 0; i <= 9; i++) {
  KEY_MAP[`Digit${i}`] = `${i}`
}

// Arrow keys
KEY_MAP['ArrowUp'] = 'UP'
KEY_MAP['ArrowDown'] = 'DOWN'
KEY_MAP['ArrowLeft'] = 'LEFT'
KEY_MAP['ArrowRight'] = 'RIGHT'

// Modifiers and special keys (excluding alt, esc, ~) and tab (conditionally allowed if alt unpressed)
KEY_MAP['ShiftLeft'] = 'SHIFT'
KEY_MAP['ShiftRight'] = 'SHIFT'
KEY_MAP['ControlLeft'] = 'CTRL'
KEY_MAP['ControlRight'] = 'CTRL'
KEY_MAP['Space'] = 'SPACE'
KEY_MAP['Tab'] = 'TAB'
KEY_MAP['Enter'] = 'ENTER'

const MOUSE_BUTTONS = {
  0: 'MOUSE_LEFT',
  1: 'MOUSE_MIDDLE',
  2: 'MOUSE_RIGHT'
}

export const useGameInput = (enabled = false, containerRef = null, onReset = null, onToggleMenu = null) => {
  const [pressedKeys, setPressedKeys] = useState(new Set())
  const [mouseButtons, setMouseButtons] = useState(new Set())
  const [mouseDelta, setMouseDelta] = useState({ dx: 0, dy: 0 })
  const [isPointerLocked, setIsPointerLocked] = useState(false)

  const mouseDeltaAccum = useRef({ dx: 0, dy: 0 })

  const handleKeyDown = useCallback(
    (e) => {
      // ESC - let browser handle pointer lock exit
      if (e.code === 'Escape') return

      // ~ (Backquote) - toggle menu/pointer lock
      if (e.code === 'Backquote') {
        if (onToggleMenu) onToggleMenu()
        e.preventDefault()
        return
      }

      if (!enabled) return

      // U - reset game
      if (e.code === 'KeyU') {
        if (onReset) onReset()
        e.preventDefault()
        return
      }

      // Allow Tab to passthrough only when alt is not pressed (so we don't accidentally capture alt+tab)
      // Tested this locally and it works as expected, if alt tabbing out the tab key event is not captured
      if (e.code === 'Tab' && e.altKey) return

      const button = KEY_MAP[e.code]
      if (button) {
        e.preventDefault()
        setPressedKeys((prev) => new Set([...prev, button]))
      }
    },
    [enabled, onReset, onToggleMenu]
  )

  const handleKeyUp = useCallback(
    (e) => {
      if (!enabled) return

      // since reserved keys are not in KEY_MAP, they will be ignored
      const button = KEY_MAP[e.code]
      if (button) {
        e.preventDefault()
        setPressedKeys((prev) => {
          const next = new Set(prev)
          next.delete(button)
          return next
        })
      }
    },
    [enabled]
  )

  const handleMouseDown = useCallback(
    (e) => {
      if (!enabled) return

      const button = MOUSE_BUTTONS[e.button]
      if (button) {
        setMouseButtons((prev) => new Set([...prev, button]))
      }
    },
    [enabled]
  )

  const handleMouseUp = useCallback(
    (e) => {
      if (!enabled) return

      const button = MOUSE_BUTTONS[e.button]
      if (button) {
        setMouseButtons((prev) => {
          const next = new Set(prev)
          next.delete(button)
          return next
        })
      }
    },
    [enabled]
  )

  const handleMouseMove = useCallback(
    (e) => {
      if (!enabled || !isPointerLocked) return

      mouseDeltaAccum.current.dx += e.movementX
      mouseDeltaAccum.current.dy += e.movementY
    },
    [enabled, isPointerLocked]
  )

  const handlePointerLockChange = useCallback(() => {
    const locked = document.pointerLockElement === containerRef?.current
    setIsPointerLocked(locked)

    if (!locked) {
      // Clear all inputs when pointer lock is lost
      setPressedKeys(new Set())
      setMouseButtons(new Set())
      mouseDeltaAccum.current = { dx: 0, dy: 0 }
    }
  }, [containerRef])

  const handleBlur = useCallback(() => {
    // Clear all inputs when window loses focus
    setPressedKeys(new Set())
    setMouseButtons(new Set())
    mouseDeltaAccum.current = { dx: 0, dy: 0 }
  }, [])

  // Get current input state and consume mouse delta
  const getInputState = useCallback(() => {
    const buttons = [...pressedKeys, ...mouseButtons]
    const dx = mouseDeltaAccum.current.dx
    const dy = mouseDeltaAccum.current.dy

    // Reset accumulated mouse movement after reading
    mouseDeltaAccum.current = { dx: 0, dy: 0 }

    return { buttons, mouseDx: dx, mouseDy: dy }
  }, [pressedKeys, mouseButtons])

  // Always listen for pointer lock changes (even when disabled)
  useEffect(() => {
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
    }
  }, [handlePointerLockChange])

  // Always listen for keyboard (to handle events for reserved keys like ~ and Esc)
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [handleKeyDown, handleKeyUp])

  // Attach/detach mouse input listeners only when enabled
  useEffect(() => {
    if (!enabled) {
      setPressedKeys(new Set())
      setMouseButtons(new Set())
      return
    }

    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('blur', handleBlur)
    }
  }, [enabled, handleMouseDown, handleMouseUp, handleMouseMove, handleBlur])

  return {
    pressedKeys,
    mouseButtons,
    mouseDelta,
    isPointerLocked,
    getInputState
  }
}

export default useGameInput
