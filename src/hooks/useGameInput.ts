import { useState, useEffect, useCallback, useRef, useMemo, type RefObject } from 'react'
import { DEFAULT_KEYBINDINGS, type ControlBindKey, type Keybindings } from '../types/settings'
import type { InputCode, ServerCode } from '../types/input'
import i18n from '../i18n'

// ─── Control definitions (rebindable actions + display-only entries) ─────────

/** A remappable game control. `code` is the default input binding the user sees
 *  out-of-the-box; the live binding is looked up in user `keybindings.controls`.
 *  `label` is the stable internal identifier; `labelKey` is the i18n key. */
export type Control = {
  label: string
  labelKey: string
  code: InputCode
}

export const CONTROLS: readonly Control[] = [
  { label: 'Move Forward', labelKey: 'moveForward', code: 'KeyW' },
  { label: 'Move Left', labelKey: 'moveLeft', code: 'KeyA' },
  { label: 'Move Back', labelKey: 'moveBack', code: 'KeyS' },
  { label: 'Move Right', labelKey: 'moveRight', code: 'KeyD' },
  { label: 'Jump', labelKey: 'jump', code: 'Space' },
  { label: 'Sprint', labelKey: 'sprint', code: 'ShiftLeft' },
  { label: 'Interact', labelKey: 'interact', code: 'KeyE' },
  { label: 'Primary Fire', labelKey: 'primaryFire', code: 'MouseLeft' },
  { label: 'Secondary Fire', labelKey: 'secondaryFire', code: 'MouseRight' },
  { label: 'Pause Menu', labelKey: 'pauseMenu', code: 'Escape' }
]

/** Returns a localized warning if `code` conflicts with any code in `otherCodes`. */
export const getKeybindConflict = (code: InputCode, otherCodes: InputCode[]): string | null => {
  if (otherCodes.includes(code)) {
    return i18n.t('app.settings.keybindings.conflictWithOther', {
      defaultValue: 'Conflicts with another keybinding'
    })
  }
  return null
}

// ─── InputCode registry ──────────────────────────────────────────────────────

/** Synthetic `InputCode`s for mouse buttons (keyboard codes come from the DOM). */
export const MOUSE_CODES = {
  LEFT: 'MouseLeft',
  MIDDLE: 'MouseMiddle',
  RIGHT: 'MouseRight',
  BACK: 'MouseBack',
  FORWARD: 'MouseForward'
} as const

/** `MouseEvent.button` index → `InputCode`. */
const MOUSE_BUTTON_TO_CODE: Record<number, InputCode> = {
  0: MOUSE_CODES.LEFT,
  1: MOUSE_CODES.MIDDLE,
  2: MOUSE_CODES.RIGHT,
  3: MOUSE_CODES.BACK,
  4: MOUSE_CODES.FORWARD
}

/** Synthetic `InputCode`s for gamepad buttons and stick directions. The
 *  gamepad-to-`InputCode` mapping is fixed (no user remapping for the initial
 *  release per issue #76); these codes are stable entries in `CODE_MAP`. */
export const GAMEPAD_CODES = {
  A: 'GamepadA',
  B: 'GamepadB',
  X: 'GamepadX',
  Y: 'GamepadY',
  LB: 'GamepadLB',
  RB: 'GamepadRB',
  LT: 'GamepadLT',
  RT: 'GamepadRT',
  BACK: 'GamepadBack',
  START: 'GamepadStart',
  L3: 'GamepadL3',
  R3: 'GamepadR3',
  DPAD_UP: 'GamepadDPadUp',
  DPAD_DOWN: 'GamepadDPadDown',
  DPAD_LEFT: 'GamepadDPadLeft',
  DPAD_RIGHT: 'GamepadDPadRight',
  LEFT_STICK_UP: 'GamepadLeftStickUp',
  LEFT_STICK_DOWN: 'GamepadLeftStickDown',
  LEFT_STICK_LEFT: 'GamepadLeftStickLeft',
  LEFT_STICK_RIGHT: 'GamepadLeftStickRight'
} as const

/** `Gamepad.buttons` index → `InputCode` (Standard Gamepad mapping per W3C). */
const GAMEPAD_BUTTON_TO_CODE: Record<number, InputCode> = {
  0: GAMEPAD_CODES.A,
  1: GAMEPAD_CODES.B,
  2: GAMEPAD_CODES.X,
  3: GAMEPAD_CODES.Y,
  4: GAMEPAD_CODES.LB,
  5: GAMEPAD_CODES.RB,
  6: GAMEPAD_CODES.LT,
  7: GAMEPAD_CODES.RT,
  8: GAMEPAD_CODES.BACK,
  9: GAMEPAD_CODES.START,
  10: GAMEPAD_CODES.L3,
  11: GAMEPAD_CODES.R3,
  12: GAMEPAD_CODES.DPAD_UP,
  13: GAMEPAD_CODES.DPAD_DOWN,
  14: GAMEPAD_CODES.DPAD_LEFT,
  15: GAMEPAD_CODES.DPAD_RIGHT
}

/** Dead zone for analog stick axes (noise floor; below this the stick is treated as neutral). */
const GAMEPAD_DEAD_ZONE = 0.15
/** Threshold above which a directional stick deflection registers as a virtual directional "button". */
const GAMEPAD_STICK_DIRECTION_THRESHOLD = 0.5
/** Right-stick look sensitivity, in mouse pixels per frame at full deflection. */
const GAMEPAD_LOOK_SENSITIVITY = 18

// ─── Default passthrough map: InputCode → ServerCode ───────────────────────
// Grouped by input source. User rebindings mutate a copy of this at runtime.

/** Every `InputCode` the model recognises, mapped to the `ServerCode` it emits. */
export const CODE_MAP: Record<InputCode, ServerCode> = {}

// Keyboard
for (let i = 65; i <= 90; i++) {
  const letter = String.fromCharCode(i)
  CODE_MAP[`Key${letter}`] = letter
}
for (let i = 0; i <= 9; i++) {
  CODE_MAP[`Digit${i}`] = `${i}`
}
Object.assign(CODE_MAP, {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  ControlLeft: 'CTRL',
  ControlRight: 'CTRL',
  AltLeft: 'ALT',
  AltRight: 'ALT',
  Space: 'SPACE',
  Tab: 'TAB',
  Enter: 'ENTER'
} satisfies Record<InputCode, ServerCode>)

// Mouse
Object.assign(CODE_MAP, {
  [MOUSE_CODES.LEFT]: 'MOUSE_LEFT',
  [MOUSE_CODES.MIDDLE]: 'MOUSE_MIDDLE',
  [MOUSE_CODES.RIGHT]: 'MOUSE_RIGHT',
  [MOUSE_CODES.BACK]: 'MOUSE_X1',
  [MOUSE_CODES.FORWARD]: 'MOUSE_X2'
} satisfies Record<InputCode, ServerCode>)

// Gamepad (fixed mapping per issue #76 — no user remapping for the initial release)
Object.assign(CODE_MAP, {
  [GAMEPAD_CODES.A]: 'SPACE', // jump
  [GAMEPAD_CODES.B]: 'CTRL', // crouch
  [GAMEPAD_CODES.X]: 'E', // interact
  [GAMEPAD_CODES.LT]: 'MOUSE_RIGHT', // zoom / secondary fire
  [GAMEPAD_CODES.RT]: 'MOUSE_LEFT', // shoot / primary fire
  [GAMEPAD_CODES.L3]: 'SHIFT', // sprint (click left stick)
  [GAMEPAD_CODES.DPAD_UP]: 'UP',
  [GAMEPAD_CODES.DPAD_DOWN]: 'DOWN',
  [GAMEPAD_CODES.DPAD_LEFT]: 'LEFT',
  [GAMEPAD_CODES.DPAD_RIGHT]: 'RIGHT',
  [GAMEPAD_CODES.LEFT_STICK_UP]: 'W',
  [GAMEPAD_CODES.LEFT_STICK_DOWN]: 'S',
  [GAMEPAD_CODES.LEFT_STICK_LEFT]: 'A',
  [GAMEPAD_CODES.LEFT_STICK_RIGHT]: 'D'
  // Y / LB / RB / Back / R3: intentionally unmapped.
} satisfies Record<InputCode, ServerCode>)

/** Actions that emit no server code and instead invoke a callback when their binding is pressed. */
const CALLBACK_ACTIONS = new Set<ControlBindKey>(['pauseMenu'])

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target as HTMLElement)?.isContentEditable

type UseGameInputResult = {
  /** Physical keyboard `InputCode`s currently held down (e.g. `'KeyW'`, `'ArrowUp'`). */
  pressedKeys: Set<InputCode>
  /** Physical mouse `InputCode`s currently held down (e.g. `'MouseLeft'`). */
  mouseButtons: Set<InputCode>
  /** Gamepad `InputCode`s currently held down (buttons + stick directions). */
  pressedGamepad: Set<InputCode>
  mouseDelta: { dx: number; dy: number }
  isPointerLocked: boolean
  getInputState: () => { buttons: ServerCode[]; mouseDx: number; mouseDy: number }
}

/** Reflects whether any gamepad is currently connected.
 *  Browsers may not fire `gamepadconnected` until the user presses a button on
 *  the pad (security / privacy), so an initial probe of `navigator.getGamepads()`
 *  will typically be empty until then — that's expected. */
export const useGamepadConnected = (): boolean => {
  const [connected, setConnected] = useState(() => {
    if (typeof navigator === 'undefined') return false
    const pads = navigator.getGamepads?.() ?? []
    return pads.some((p) => p != null)
  })

  useEffect(() => {
    const update = () => {
      const pads = navigator.getGamepads?.() ?? []
      setConnected(pads.some((p) => p != null))
    }
    window.addEventListener('gamepadconnected', update)
    window.addEventListener('gamepaddisconnected', update)
    return () => {
      window.removeEventListener('gamepadconnected', update)
      window.removeEventListener('gamepaddisconnected', update)
    }
  }, [])

  return connected
}

export const useGameInput = (
  enabled = false,
  containerRef: RefObject<HTMLElement | null> | null = null,
  onReset: (() => void) | null = null,
  keybindings: Keybindings = DEFAULT_KEYBINDINGS,
  onSceneEdit?: (() => void) | null,
  onPauseMenu?: (() => void) | null
): UseGameInputResult => {
  const [pressedKeys, setPressedKeys] = useState<Set<InputCode>>(new Set())
  const [mouseButtons, setMouseButtons] = useState<Set<InputCode>>(new Set())
  const [pressedGamepad, setPressedGamepad] = useState<Set<InputCode>>(new Set())
  const [mouseDelta] = useState({ dx: 0, dy: 0 })
  const [isPointerLocked, setIsPointerLocked] = useState(false)

  const mouseDeltaAccum = useRef({ dx: 0, dy: 0 })
  const scrollAccum = useRef(0)

  /** Effective `InputCode` → `ServerCode` map after applying user rebindings.
   *  For each remappable action we: (a) remove its default input code from the
   *  passthrough map (so the default no longer emits the canonical server code
   *  after a rebind), and (b) bind the user-chosen input code to the action's
   *  canonical server code. pauseMenu has no canonical server code and is
   *  handled via callback, not through this map. */
  const effectiveCodeMap = useMemo(() => {
    const map = { ...CODE_MAP }

    // Reset/scene-edit are callback keybindings; free their codes from passthroughs.
    delete map[keybindings.reset_scene]
    delete map[keybindings.scene_edit]

    // Clear default codes for all actions (semantics: user rebind replaces default).
    for (const ctrl of CONTROLS) {
      delete map[ctrl.code]
    }

    // Bind user's chosen input code → canonical server code for each action.
    for (const ctrl of CONTROLS) {
      if (CALLBACK_ACTIONS.has(ctrl.labelKey as ControlBindKey)) continue
      const serverCode = CODE_MAP[ctrl.code]
      if (!serverCode) continue
      const userCode = keybindings.controls[ctrl.labelKey as ControlBindKey]
      if (!userCode) continue
      map[userCode] = serverCode
    }

    return map
  }, [keybindings.reset_scene, keybindings.scene_edit, keybindings.controls])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // When game input is active, capture Ctrl/Alt as game buttons.
      // When inactive, allow system shortcuts (Ctrl+C, Ctrl+V, etc.) through.
      if (!enabled && (e.ctrlKey || e.metaKey)) return
      // Always let Cmd (Meta) shortcuts through — they're OS-level on macOS.
      if (e.metaKey) return
      if (isEditableTarget(e.target)) return

      if (e.code === keybindings.reset_scene) {
        onReset?.()
        e.preventDefault()
        return
      }
      if (e.code === keybindings.scene_edit) {
        onSceneEdit?.()
        e.preventDefault()
        return
      }
      if (e.code === keybindings.controls.pauseMenu) {
        onPauseMenu?.()
        // Don't preventDefault Escape — the browser still exits pointer lock natively,
        // which is the expected path when pauseMenu is kept at its default.
        if (e.code !== 'Escape') e.preventDefault()
        return
      }
      if (e.code === 'Escape') return
      if (e.code === 'Tab' && e.altKey) return

      // Store the physical InputCode; translation to ServerCode happens in getInputState.
      if (effectiveCodeMap[e.code]) {
        e.preventDefault()
        setPressedKeys((prev) => new Set([...prev, e.code]))
      }
    },
    [
      enabled,
      onReset,
      onSceneEdit,
      onPauseMenu,
      keybindings.reset_scene,
      keybindings.scene_edit,
      keybindings.controls.pauseMenu,
      effectiveCodeMap
    ]
  )

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (!enabled) return
      if (effectiveCodeMap[e.code]) {
        e.preventDefault()
        setPressedKeys((prev) => {
          const next = new Set(prev)
          next.delete(e.code)
          return next
        })
      }
    },
    [enabled, effectiveCodeMap]
  )

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (!enabled) return
      const inputCode = MOUSE_BUTTON_TO_CODE[e.button]
      if (!inputCode) return
      if (inputCode === keybindings.controls.pauseMenu) {
        onPauseMenu?.()
        return
      }
      if (effectiveCodeMap[inputCode]) {
        setMouseButtons((prev) => new Set([...prev, inputCode]))
      }
    },
    [enabled, onPauseMenu, keybindings.controls.pauseMenu, effectiveCodeMap]
  )

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (!enabled) return
      const inputCode = MOUSE_BUTTON_TO_CODE[e.button]
      if (!inputCode) return
      if (effectiveCodeMap[inputCode]) {
        setMouseButtons((prev) => {
          const next = new Set(prev)
          next.delete(inputCode)
          return next
        })
      }
    },
    [enabled, effectiveCodeMap]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!enabled || !isPointerLocked) return
      mouseDeltaAccum.current.dx += e.movementX
      mouseDeltaAccum.current.dy += e.movementY
    },
    [enabled, isPointerLocked]
  )

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!enabled) return
      scrollAccum.current += e.deltaY
    },
    [enabled]
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
    // Translate held InputCodes → ServerCodes for the server. A Set collapses
    // duplicates that arise when the same ServerCode is produced by multiple
    // input sources (e.g. both keyboard W and gamepad left-stick up → 'W').
    const buttons = new Set<ServerCode>()
    for (const code of pressedKeys) {
      const serverCode = effectiveCodeMap[code]
      if (serverCode) buttons.add(serverCode)
    }
    for (const code of mouseButtons) {
      const serverCode = effectiveCodeMap[code]
      if (serverCode) buttons.add(serverCode)
    }
    for (const code of pressedGamepad) {
      const serverCode = effectiveCodeMap[code]
      if (serverCode) buttons.add(serverCode)
    }
    if (scrollAccum.current < 0) buttons.add('SCROLL_UP')
    else if (scrollAccum.current > 0) buttons.add('SCROLL_DOWN')
    scrollAccum.current = 0
    const dx = mouseDeltaAccum.current.dx
    const dy = mouseDeltaAccum.current.dy
    mouseDeltaAccum.current = { dx: 0, dy: 0 }
    return { buttons: [...buttons], mouseDx: dx, mouseDy: dy }
  }, [pressedKeys, mouseButtons, pressedGamepad, effectiveCodeMap])

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
    window.addEventListener('wheel', handleWheel, { passive: true })
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('wheel', handleWheel)
      window.removeEventListener('blur', handleBlur)
    }
  }, [enabled, handleMouseDown, handleMouseUp, handleMouseMove, handleWheel, handleBlur])

  // Gamepad polling loop. We poll `navigator.getGamepads()` on rAF rather than
  // reacting to events because the Gamepad API doesn't dispatch per-button events.
  // Button presses / stick directions are mirrored into `pressedGamepad` state;
  // right-stick deflection feeds `mouseDeltaAccum`; Start is edge-triggered into
  // `onPauseMenu`. State updates only when the pressed-set membership changes,
  // so holding a stick direction doesn't thrash React rendering each frame.
  useEffect(() => {
    if (!enabled) {
      setPressedGamepad(new Set())
      return
    }

    let rafId = 0
    let prevStartDown = false
    let prevSet: Set<InputCode> = new Set()

    const sameMembership = (a: Set<InputCode>, b: Set<InputCode>): boolean => {
      if (a.size !== b.size) return false
      for (const v of a) if (!b.has(v)) return false
      return true
    }

    const poll = () => {
      const gamepads = navigator.getGamepads()
      const nextSet = new Set<InputCode>()
      let startDown = false

      for (const gp of gamepads) {
        if (!gp) continue

        for (let i = 0; i < gp.buttons.length; i++) {
          if (!gp.buttons[i].pressed) continue
          if (i === 9) {
            startDown = true // Start is a callback, not a held button.
            continue
          }
          const code = GAMEPAD_BUTTON_TO_CODE[i]
          if (code) nextSet.add(code)
        }

        const lsX = gp.axes[0] ?? 0
        const lsY = gp.axes[1] ?? 0
        if (Math.abs(lsX) > GAMEPAD_STICK_DIRECTION_THRESHOLD) {
          nextSet.add(lsX < 0 ? GAMEPAD_CODES.LEFT_STICK_LEFT : GAMEPAD_CODES.LEFT_STICK_RIGHT)
        }
        if (Math.abs(lsY) > GAMEPAD_STICK_DIRECTION_THRESHOLD) {
          nextSet.add(lsY < 0 ? GAMEPAD_CODES.LEFT_STICK_UP : GAMEPAD_CODES.LEFT_STICK_DOWN)
        }

        const rsX = gp.axes[2] ?? 0
        const rsY = gp.axes[3] ?? 0
        if (Math.abs(rsX) > GAMEPAD_DEAD_ZONE) {
          mouseDeltaAccum.current.dx += rsX * GAMEPAD_LOOK_SENSITIVITY
        }
        if (Math.abs(rsY) > GAMEPAD_DEAD_ZONE) {
          mouseDeltaAccum.current.dy += rsY * GAMEPAD_LOOK_SENSITIVITY
        }
      }

      if (startDown && !prevStartDown) onPauseMenu?.()
      prevStartDown = startDown

      if (!sameMembership(nextSet, prevSet)) {
        prevSet = nextSet
        setPressedGamepad(nextSet)
      }

      rafId = requestAnimationFrame(poll)
    }

    rafId = requestAnimationFrame(poll)
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [enabled, onPauseMenu])

  return {
    pressedKeys,
    mouseButtons,
    pressedGamepad,
    mouseDelta,
    isPointerLocked,
    getInputState
  }
}

export default useGameInput
