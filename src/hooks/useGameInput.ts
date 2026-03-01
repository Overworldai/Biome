import { useState, useEffect, useCallback, useRef, type RefObject } from 'react'

export const RESET_KEY = 'KeyU'

const KEY_MAP: Record<string, string> = {}
for (let i = 65; i <= 90; i++) {
  const letter = String.fromCharCode(i)
  KEY_MAP[`Key${letter}`] = letter
}
delete KEY_MAP[RESET_KEY]
for (let i = 0; i <= 9; i++) {
  KEY_MAP[`Digit${i}`] = `${i}`
}
KEY_MAP.ArrowUp = 'UP'
KEY_MAP.ArrowDown = 'DOWN'
KEY_MAP.ArrowLeft = 'LEFT'
KEY_MAP.ArrowRight = 'RIGHT'
KEY_MAP.ShiftLeft = 'SHIFT'
KEY_MAP.ShiftRight = 'SHIFT'
KEY_MAP.ControlLeft = 'CTRL'
KEY_MAP.ControlRight = 'CTRL'
KEY_MAP.Space = 'SPACE'
KEY_MAP.Tab = 'TAB'
KEY_MAP.Enter = 'ENTER'

const MOUSE_BUTTONS: Record<number, string> = {
  0: 'MOUSE_LEFT',
  1: 'MOUSE_MIDDLE',
  2: 'MOUSE_RIGHT'
}

type UseGameInputResult = {
  pressedKeys: Set<string>
  mouseButtons: Set<string>
  mouseDelta: { dx: number; dy: number }
  isPointerLocked: boolean
  getInputState: () => { buttons: string[]; mouseDx: number; mouseDy: number }
}

export const useGameInput = (
  enabled = false,
  containerRef: RefObject<HTMLElement | null> | null = null,
  onReset: (() => void) | null = null,
  onToggleMenu: (() => void) | null = null
): UseGameInputResult => {
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set())
  const [mouseButtons, setMouseButtons] = useState<Set<string>>(new Set())
  const [mouseDelta] = useState({ dx: 0, dy: 0 })
  const [isPointerLocked, setIsPointerLocked] = useState(false)

  const mouseDeltaAccum = useRef({ dx: 0, dy: 0 })

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'Escape') return

      if (e.code === 'Backquote') {
        onToggleMenu?.()
        e.preventDefault()
        return
      }

      if (e.code === RESET_KEY) {
        onReset?.()
        e.preventDefault()
        return
      }

      if (!enabled) return
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
    (e: KeyboardEvent) => {
      if (!enabled) return
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
    (e: MouseEvent) => {
      if (!enabled) return
      const button = MOUSE_BUTTONS[e.button]
      if (button) {
        setMouseButtons((prev) => new Set([...prev, button]))
      }
    },
    [enabled]
  )

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
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
    (e: MouseEvent) => {
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
      setPressedKeys(new Set())
      setMouseButtons(new Set())
      mouseDeltaAccum.current = { dx: 0, dy: 0 }
    }
  }, [containerRef])

  const handleBlur = useCallback(() => {
    setPressedKeys(new Set())
    setMouseButtons(new Set())
    mouseDeltaAccum.current = { dx: 0, dy: 0 }
  }, [])

  const getInputState = useCallback(() => {
    const buttons = [...pressedKeys, ...mouseButtons]
    const dx = mouseDeltaAccum.current.dx
    const dy = mouseDeltaAccum.current.dy
    mouseDeltaAccum.current = { dx: 0, dy: 0 }
    return { buttons, mouseDx: dx, mouseDy: dy }
  }, [pressedKeys, mouseButtons])

  useEffect(() => {
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
    }
  }, [handlePointerLockChange])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [handleKeyDown, handleKeyUp])

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
