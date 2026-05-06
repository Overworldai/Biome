import { useEffect, useRef, useState, type RefObject } from 'react'
import useGameInput from '../../hooks/useGameInput'
import type { InputCode, ServerCode } from '../../types/input'
import type { Keybindings } from '../../types/settings'

type ScrollActive = { up: boolean; down: boolean }

/** Owns the per-frame input loop: subscribes to keyboard / mouse /
 *  gamepad via `useGameInput`, then drives a `requestAnimationFrame`
 *  tick that samples the live input state and forwards it to the
 *  server via `sendControl`. Also exposes ephemeral scroll-direction
 *  state for the input overlay (scroll wheel events have no "released"
 *  signal, so we infer it via a 150 ms timeout).
 *
 *  Held inputs (pressedKeys / mouseButtons / pressedGamepad) and
 *  pointer-lock state come from `useGameInput`; this hook just adds
 *  the rAF send loop and the scroll inference on top. */
export function useInputLoop(opts: {
  /** True when input should flow to the server (streaming +
   *  unpaused + no menu/modal). When false, the rAF loop is suspended
   *  but the held-input state still updates. */
  enabled: boolean
  containerRef: RefObject<HTMLDivElement | null>
  keybindings: Keybindings
  mouseSensitivity: number
  gamepadSensitivity: number
  sendControl: (buttons: ServerCode[], mouseDx: number, mouseDy: number) => boolean
  onReset: () => void
  /** Pass `null` when scene-authoring is disabled so the keybind is
   *  ignored (its slot can be reused for a different action without a
   *  conflict warning). */
  onSceneEdit: (() => void) | null
  onExitPointerLock: () => void
}): {
  pressedKeys: Set<InputCode>
  mouseButtons: Set<InputCode>
  pressedGamepad: Set<InputCode>
  scrollActive: ScrollActive
  isPointerLocked: boolean
} {
  const {
    enabled,
    containerRef,
    keybindings,
    mouseSensitivity,
    gamepadSensitivity,
    sendControl,
    onReset,
    onSceneEdit,
    onExitPointerLock
  } = opts

  const { pressedKeys, mouseButtons, pressedGamepad, getInputState, isPointerLocked } = useGameInput(
    enabled,
    containerRef,
    onReset,
    keybindings,
    onSceneEdit,
    onExitPointerLock
  )

  const [scrollActive, setScrollActive] = useState<ScrollActive>({ up: false, down: false })
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    const tick = () => {
      const { buttons, mouse, gamepad } = getInputState()
      const scrollUp = buttons.includes('SCROLL_UP')
      const scrollDown = buttons.includes('SCROLL_DOWN')
      if (scrollUp || scrollDown) {
        setScrollActive({ up: scrollUp, down: scrollDown })
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = setTimeout(() => setScrollActive({ up: false, down: false }), 150)
      }
      const dx = mouse.dx * mouseSensitivity + gamepad.dx * gamepadSensitivity
      const dy = mouse.dy * mouseSensitivity + gamepad.dy * gamepadSensitivity
      sendControl(buttons, Math.round(dx), Math.round(dy))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = null
      }
    }
  }, [enabled, getInputState, sendControl, mouseSensitivity, gamepadSensitivity])

  return { pressedKeys, mouseButtons, pressedGamepad, scrollActive, isPointerLocked }
}
