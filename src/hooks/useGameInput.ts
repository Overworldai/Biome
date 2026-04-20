import { useState, useEffect, useCallback, useRef, useMemo, type RefObject } from 'react'
import { DEFAULT_KEYBINDINGS, type ControlBindKey, type Keybindings } from '../types/settings'
import type { InputCode, ServerCode } from '../types/input'

// ─── Control definitions (rebindable actions + display-only entries) ─────────

/** A remappable game control, used internally by `useGameInput` to build the
 *  InputCode → ServerCode passthrough map. `labelKey` doubles as the stable id
 *  and the i18n key under `app.settings.controls.labels.*`. */
export type Control = {
  labelKey: ControlBindKey
  code: InputCode
}

/** Single source of truth for the ordered list of user-facing actions. The
 *  keybindings and gamepad settings sections both render in this order (each
 *  filtering by `keyboard` / `gamepad` presence), so reordering here moves
 *  the rows in both sections in lockstep. */
export type GameAction = {
  /** Stable id; also the i18n label key within each section's namespace. */
  id: string
  /** Keyboard binding — present when the action appears in the keybindings
   *  section. `bindKey` indexes into `keybindings`. */
  keyboard?: { bindKey: ControlBindKey; defaultCode: InputCode }
  /** Fixed gamepad binding (hardware button label shown verbatim). */
  gamepad?: { button: string }
  /** Only rendered when the experimental scene-edit flag is enabled. */
  experimental?: boolean
}

export const GAME_ACTIONS: readonly GameAction[] = [
  { id: 'moveForward', keyboard: { bindKey: 'moveForward', defaultCode: 'KeyW' } },
  { id: 'moveLeft', keyboard: { bindKey: 'moveLeft', defaultCode: 'KeyA' } },
  { id: 'moveBack', keyboard: { bindKey: 'moveBack', defaultCode: 'KeyS' } },
  { id: 'moveRight', keyboard: { bindKey: 'moveRight', defaultCode: 'KeyD' } },
  { id: 'move', gamepad: { button: 'Left Stick' } },
  { id: 'look', gamepad: { button: 'Right Stick' } },
  { id: 'jump', keyboard: { bindKey: 'jump', defaultCode: 'Space' }, gamepad: { button: 'A' } },
  { id: 'crouch', keyboard: { bindKey: 'crouch', defaultCode: 'ControlLeft' }, gamepad: { button: 'R3' } },
  { id: 'sprint', keyboard: { bindKey: 'sprint', defaultCode: 'ShiftLeft' }, gamepad: { button: 'L3' } },
  { id: 'interact', keyboard: { bindKey: 'interact', defaultCode: 'KeyE' }, gamepad: { button: 'X' } },
  { id: 'primaryFire', keyboard: { bindKey: 'primaryFire', defaultCode: 'MouseLeft' }, gamepad: { button: 'RT' } },
  {
    id: 'secondaryFire',
    keyboard: { bindKey: 'secondaryFire', defaultCode: 'MouseRight' },
    gamepad: { button: 'LT' }
  },
  { id: 'pauseMenu', keyboard: { bindKey: 'pauseMenu', defaultCode: 'Escape' }, gamepad: { button: 'Start' } },
  { id: 'resetScene', keyboard: { bindKey: 'resetScene', defaultCode: 'KeyU' }, gamepad: { button: 'Back' } },
  {
    id: 'sceneEdit',
    keyboard: { bindKey: 'sceneEdit', defaultCode: 'KeyQ' },
    gamepad: { button: 'Y' },
    experimental: true
  }
]

export const CONTROLS: readonly Control[] = GAME_ACTIONS.flatMap((a) =>
  a.keyboard ? [{ labelKey: a.keyboard.bindKey, code: a.keyboard.defaultCode }] : []
)

/** Returns data about the first conflicting binding (or null). The caller is
 *  responsible for rendering the localized message — typically via `<Trans>`
 *  so the other-action label can be highlighted inline. */
export const getKeybindConflict = (
  code: InputCode,
  others: readonly { code: InputCode; label: string }[]
): { otherLabel: string } | null => {
  const conflict = others.find((o) => o.code === code)
  return conflict ? { otherLabel: conflict.label } : null
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
  [GAMEPAD_CODES.X]: 'E', // interact
  [GAMEPAD_CODES.LT]: 'MOUSE_RIGHT', // zoom / secondary fire
  [GAMEPAD_CODES.RT]: 'MOUSE_LEFT', // shoot / primary fire
  [GAMEPAD_CODES.L3]: 'SHIFT', // sprint (click left stick)
  [GAMEPAD_CODES.R3]: 'CTRL', // crouch (click right stick, CoD-style)
  // D-pad mirrors the left stick's WASD mapping — tapping dpad ↑ is
  // equivalent to flicking the left stick up.
  [GAMEPAD_CODES.DPAD_UP]: 'W',
  [GAMEPAD_CODES.DPAD_DOWN]: 'S',
  [GAMEPAD_CODES.DPAD_LEFT]: 'A',
  [GAMEPAD_CODES.DPAD_RIGHT]: 'D',
  [GAMEPAD_CODES.LEFT_STICK_UP]: 'W',
  [GAMEPAD_CODES.LEFT_STICK_DOWN]: 'S',
  [GAMEPAD_CODES.LEFT_STICK_LEFT]: 'A',
  [GAMEPAD_CODES.LEFT_STICK_RIGHT]: 'D'
} satisfies Record<InputCode, ServerCode>)

/** Actions that emit no server code and instead invoke a callback when their binding is pressed. */
const CALLBACK_ACTIONS = new Set<ControlBindKey>(['pauseMenu', 'resetScene', 'sceneEdit'])

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target as HTMLElement)?.isContentEditable

/** Accumulated pointer delta from one input source (mouse or gamepad stick) for the current frame. */
export type LookDelta = { dx: number; dy: number }

/** Fresh zero delta. Accumulators mutate `.dx` / `.dy` in place, so each owner
 *  needs its own object — a shared frozen constant would alias across slots. */
const zeroLookDelta = (): LookDelta => ({ dx: 0, dy: 0 })

type UseGameInputResult = {
  /** Physical keyboard `InputCode`s currently held down (e.g. `'KeyW'`, `'ArrowUp'`). */
  pressedKeys: Set<InputCode>
  /** Physical mouse `InputCode`s currently held down (e.g. `'MouseLeft'`). */
  mouseButtons: Set<InputCode>
  /** Gamepad `InputCode`s currently held down (buttons + stick directions). */
  pressedGamepad: Set<InputCode>
  mouseDelta: LookDelta
  isPointerLocked: boolean
  getInputState: () => { buttons: ServerCode[]; mouse: LookDelta; gamepad: LookDelta }
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
  const [mouseDelta] = useState(zeroLookDelta())
  const [isPointerLocked, setIsPointerLocked] = useState(false)

  const mouseDeltaAccum = useRef<LookDelta>(zeroLookDelta())
  const gamepadDeltaAccum = useRef<LookDelta>(zeroLookDelta())
  const scrollAccum = useRef(0)

  /** Effective `InputCode` → `ServerCode` map after applying user rebindings.
   *  For each remappable action we: (a) remove its default input code from the
   *  passthrough map (so the default no longer emits the canonical server code
   *  after a rebind), and (b) bind the user-chosen input code to the action's
   *  canonical server code. Callback actions (pauseMenu, resetScene, sceneEdit)
   *  have no canonical server code and are handled via callback, not through
   *  this map. */
  const effectiveCodeMap = useMemo(() => {
    const map = { ...CODE_MAP }

    // Clear default codes for all actions (semantics: user rebind replaces default).
    for (const ctrl of CONTROLS) {
      delete map[ctrl.code]
    }

    // Bind user's chosen input code → canonical server code for each action.
    for (const ctrl of CONTROLS) {
      if (CALLBACK_ACTIONS.has(ctrl.labelKey)) continue
      const serverCode = CODE_MAP[ctrl.code]
      if (!serverCode) continue
      const userCode = keybindings[ctrl.labelKey]
      if (!userCode) continue
      map[userCode] = serverCode
    }

    return map
  }, [keybindings])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // When game input is active, capture Ctrl/Alt as game buttons.
      // When inactive, allow system shortcuts (Ctrl+C, Ctrl+V, etc.) through.
      if (!enabled && (e.ctrlKey || e.metaKey)) return
      // Always let Cmd (Meta) shortcuts through — they're OS-level on macOS.
      if (e.metaKey) return
      if (isEditableTarget(e.target)) return

      // Callback keybindings — route to their handler instead of emitting a server code.
      // Ordered same as before the flat-schema refactor: reset / sceneEdit / pauseMenu.
      const callbackHandlers: Array<[ControlBindKey, (() => void) | null | undefined]> = [
        ['resetScene', onReset],
        ['sceneEdit', onSceneEdit],
        ['pauseMenu', onPauseMenu]
      ]
      for (const [bindKey, handler] of callbackHandlers) {
        // Skip callbacks with no handler wired (e.g. sceneEdit when the experimental
        // flag is off) — otherwise we'd swallow the key and prevent it from reaching
        // whatever the user actually bound to that code.
        if (!handler) continue
        if (e.code !== keybindings[bindKey]) continue
        handler()
        // Don't preventDefault Escape — the browser still exits pointer lock natively,
        // which is the expected path when pauseMenu is kept at its default.
        if (e.code !== 'Escape') e.preventDefault()
        return
      }
      if (e.code === 'Escape') return
      if (e.code === 'Tab' && e.altKey) return

      // When game input isn't active, don't consume keys for game passthrough —
      // otherwise synthetic arrow-key dispatches from gamepad UI navigation get
      // preventDefaulted here and spatial focus movement breaks.
      if (!enabled) return

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
      keybindings.resetScene,
      keybindings.sceneEdit,
      keybindings.pauseMenu,
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
      if (inputCode === keybindings.pauseMenu) {
        onPauseMenu?.()
        return
      }
      if (effectiveCodeMap[inputCode]) {
        setMouseButtons((prev) => new Set([...prev, inputCode]))
      }
    },
    [enabled, onPauseMenu, keybindings.pauseMenu, effectiveCodeMap]
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
      mouseDeltaAccum.current = zeroLookDelta()
      gamepadDeltaAccum.current = zeroLookDelta()
    }
  }, [containerRef])

  const handleBlur = useCallback(() => {
    setPressedKeys(new Set())
    setMouseButtons(new Set())
    mouseDeltaAccum.current = zeroLookDelta()
    gamepadDeltaAccum.current = zeroLookDelta()
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
    const mouse = mouseDeltaAccum.current
    const gamepad = gamepadDeltaAccum.current
    mouseDeltaAccum.current = zeroLookDelta()
    gamepadDeltaAccum.current = zeroLookDelta()
    return { buttons: [...buttons], mouse, gamepad }
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
    // Seed from the currently-held buttons so a Start press that just switched
    // the app from paused→playing (via the UI nav layer) doesn't immediately
    // trigger another pauseMenu on the first frame of game input.
    const seedHeld = (idx: number): boolean => {
      const gps = navigator.getGamepads()
      for (const gp of gps) if (gp?.buttons[idx]?.pressed) return true
      return false
    }
    let prevStartDown = seedHeld(9)
    let prevBackDown = seedHeld(8)
    let prevYDown = seedHeld(3)
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
      let backDown = false
      let yDown = false

      for (const gp of gamepads) {
        if (!gp) continue

        for (let i = 0; i < gp.buttons.length; i++) {
          if (!gp.buttons[i].pressed) continue
          // Start/Back/Y drive edge-triggered callbacks (pause / reset / scene-edit).
          // Flag them separately but still include them in `pressedGamepad` so the
          // input overlay can render the held state. They have no server-code entry
          // in `CODE_MAP`, so getInputState skips them when building `buttons[]`.
          if (i === 9) startDown = true
          else if (i === 8) backDown = true
          else if (i === 3) yDown = true
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
          gamepadDeltaAccum.current.dx += rsX * GAMEPAD_LOOK_SENSITIVITY
        }
        if (Math.abs(rsY) > GAMEPAD_DEAD_ZONE) {
          gamepadDeltaAccum.current.dy += rsY * GAMEPAD_LOOK_SENSITIVITY
        }
      }

      if (startDown && !prevStartDown) onPauseMenu?.()
      if (backDown && !prevBackDown) onReset?.()
      if (yDown && !prevYDown) onSceneEdit?.()
      prevStartDown = startDown
      prevBackDown = backDown
      prevYDown = yDown

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
  }, [enabled, onPauseMenu, onReset, onSceneEdit])

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
