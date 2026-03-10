import { useState, useEffect, useCallback, useRef, useMemo, type RefObject } from 'react'
import { DEFAULT_KEYBINDINGS, type Keybindings } from '../types/settings'

/** Fixed game controls — the single source of truth for non-rebindable bindings.
 *  Entries with `code` are real keyboard keys (used for conflict detection).
 *  Entries with `displayValue` are display-only (mouse, clicks). */
export type FixedControl = { label: string } & (
  | { code: string; displayValue?: never }
  | { code?: never; displayValue: string }
)

export const FIXED_CONTROLS: readonly FixedControl[] = [
  { label: 'Move Forward', code: 'KeyW' },
  { label: 'Move Left', code: 'KeyA' },
  { label: 'Move Back', code: 'KeyS' },
  { label: 'Move Right', code: 'KeyD' },
  { label: 'Jump', code: 'Space' },
  { label: 'Sprint', code: 'ShiftLeft' },
  { label: 'Look', displayValue: 'Mouse' },
  { label: 'Interact', code: 'KeyE' },
  { label: 'Primary Fire', displayValue: 'Left Click' },
  { label: 'Secondary Fire', displayValue: 'Right Click' },
  { label: 'Pause Menu', code: 'Escape' }
]

const FIXED_CODE_TO_LABEL = new Map(
  FIXED_CONTROLS.flatMap((ctrl) => (ctrl.code ? [[ctrl.code, ctrl.label] as const] : []))
)

/** Returns a warning if `code` conflicts with any code in `otherCodes`, or with a fixed game control. */
export const getKeybindConflict = (code: string, otherCodes: string[]): string | null => {
  if (otherCodes.includes(code)) return 'Conflicts with another keybinding'
  const fixedLabel = FIXED_CODE_TO_LABEL.get(code)
  if (fixedLabel) return `Conflicts with fixed control: ${fixedLabel}`
  return null
}

export const KEY_MAP: Record<string, string> = {}
for (let i = 65; i <= 90; i++) {
  const letter = String.fromCharCode(i)
  KEY_MAP[`Key${letter}`] = letter
}
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

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target as HTMLElement)?.isContentEditable

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
  keybindings: Keybindings = DEFAULT_KEYBINDINGS
): UseGameInputResult => {
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set())
  const [mouseButtons, setMouseButtons] = useState<Set<string>>(new Set())
  const [mouseDelta] = useState({ dx: 0, dy: 0 })
  const [isPointerLocked, setIsPointerLocked] = useState(false)

  const mouseDeltaAccum = useRef({ dx: 0, dy: 0 })

  const effectiveKeyMap = useMemo(() => {
    const map = { ...KEY_MAP }
    delete map[keybindings.reset_scene]
    return map
  }, [keybindings.reset_scene])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'Escape') return

      // Allow system shortcuts (Ctrl+C, Ctrl+V, Cmd+A, etc.) and skip editable targets
      if (e.ctrlKey || e.metaKey) return
      if (isEditableTarget(e.target)) return

      if (e.code === keybindings.reset_scene) {
        onReset?.()
        e.preventDefault()
        return
      }
      if (e.code === 'Tab' && e.altKey) return

      const button = effectiveKeyMap[e.code]
      if (button) {
        e.preventDefault()
        setPressedKeys((prev) => new Set([...prev, button]))
      }
    },
    [enabled, onReset, keybindings.reset_scene, effectiveKeyMap]
  )

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (!enabled) return
      const button = effectiveKeyMap[e.code]
      if (button) {
        e.preventDefault()
        setPressedKeys((prev) => {
          const next = new Set(prev)
          next.delete(button)
          return next
        })
      }
    },
    [enabled, effectiveKeyMap]
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
