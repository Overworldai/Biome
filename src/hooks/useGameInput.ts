import { useState, useEffect, useCallback, useRef, useMemo, type RefObject } from 'react'
import { DEFAULT_KEYBINDINGS, type ControlBindKey, type Keybindings } from '../types/settings'
import i18n from '../i18n'

// ─── String types ────────────────────────────────────────────────────────────
// Three distinct kinds of strings flow through this module. They're all plain
// `string` for ergonomics (avoids casts at DOM boundaries), but the aliases
// document intent at every declaration.

/** A physical input identifier we RECEIVE from the user. Drawn from:
 *  - Keyboard: DOM `KeyboardEvent.code` values (`'KeyW'`, `'Space'`, `'Escape'`, `'ArrowUp'`).
 *  - Mouse: synthetic codes translated from `MouseEvent.button` (see `MOUSE_CODES`).
 *  - Gamepad (future): synthetic codes in the same namespace. */
export type InputCode = string

/** A canonical code we SEND to the model in `control.buttons[]`
 *  (e.g. `'W'`, `'SPACE'`, `'SHIFT'`, `'MOUSE_LEFT'`). */
export type ServerCode = string

/** A human-readable label displayed in the settings UI (e.g. `'W'`, `'Space'`, `'Left Click'`).
 *  Produced by `keyCodeToLabel` in `SettingsKeybind.tsx`; declared here for clarity. */
export type DisplayLabel = string

// ─── Control definitions (rebindable actions + display-only entries) ─────────

/** Game controls — the single source of truth for display/bindings.
 *  Entries with `code` are remappable keybindings; `code` is the default binding the user
 *  sees out-of-the-box. The actual live binding is looked up in user `keybindings.controls`.
 *  Non-remappable entries (currently just "Look") use `displayValue` for a display-only
 *  string in the settings UI.
 *  `label` is the stable internal identifier; `labelKey` and `displayValueKey` are i18n keys. */
export type Control = {
  label: string
  labelKey: string
} & (
  | { code: InputCode; remappable?: boolean; displayValue?: never; displayValueKey?: never }
  | { code?: never; remappable?: never; displayValue: DisplayLabel; displayValueKey: string }
)

export const CONTROLS: readonly Control[] = [
  { label: 'Move Forward', labelKey: 'moveForward', code: 'KeyW', remappable: true },
  { label: 'Move Left', labelKey: 'moveLeft', code: 'KeyA', remappable: true },
  { label: 'Move Back', labelKey: 'moveBack', code: 'KeyS', remappable: true },
  { label: 'Move Right', labelKey: 'moveRight', code: 'KeyD', remappable: true },
  { label: 'Jump', labelKey: 'jump', code: 'Space', remappable: true },
  { label: 'Sprint', labelKey: 'sprint', code: 'ShiftLeft', remappable: true },
  { label: 'Look', labelKey: 'look', displayValue: 'Mouse', displayValueKey: 'mouse' },
  { label: 'Interact', labelKey: 'interact', code: 'KeyE', remappable: true },
  { label: 'Primary Fire', labelKey: 'primaryFire', code: 'MouseLeft', remappable: true },
  { label: 'Secondary Fire', labelKey: 'secondaryFire', code: 'MouseRight', remappable: true },
  { label: 'Pause Menu', labelKey: 'pauseMenu', code: 'Escape', remappable: true }
]

/** Non-remappable control codes — empty now, kept as a hook for future additions. */
const NON_REMAPPABLE_CODE_TO_LABEL = new Map<InputCode, string>(
  CONTROLS.flatMap((ctrl) => (ctrl.code && !ctrl.remappable ? [[ctrl.code, ctrl.label] as const] : []))
)

/** Returns a localized warning if `code` conflicts with any code in `otherCodes`, or with a non-remappable game control. */
export const getKeybindConflict = (code: InputCode, otherCodes: InputCode[]): string | null => {
  if (otherCodes.includes(code)) {
    return i18n.t('app.settings.keybindings.conflictWithOther', {
      defaultValue: 'Conflicts with another keybinding'
    })
  }
  const fixedLabel = NON_REMAPPABLE_CODE_TO_LABEL.get(code)
  if (fixedLabel) {
    return i18n.t('app.settings.keybindings.conflictWithFixed', {
      label: fixedLabel,
      defaultValue: `Conflicts with fixed control: ${fixedLabel}`
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

// Gamepad: reserved for issue #76.

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
  mouseDelta: { dx: number; dy: number }
  isPointerLocked: boolean
  getInputState: () => { buttons: ServerCode[]; mouseDx: number; mouseDy: number }
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

    // Clear default codes for all remappable actions (semantics: user rebind replaces default).
    for (const ctrl of CONTROLS) {
      if (!ctrl.remappable || !ctrl.code) continue
      delete map[ctrl.code]
    }

    // Bind user's chosen input code → canonical server code for each remappable action.
    for (const ctrl of CONTROLS) {
      if (!ctrl.remappable || !ctrl.code) continue
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
    // Translate held InputCodes → ServerCodes for the server.
    const buttons: ServerCode[] = []
    for (const code of pressedKeys) {
      const serverCode = effectiveCodeMap[code]
      if (serverCode) buttons.push(serverCode)
    }
    for (const code of mouseButtons) {
      const serverCode = effectiveCodeMap[code]
      if (serverCode) buttons.push(serverCode)
    }
    if (scrollAccum.current < 0) buttons.push('SCROLL_UP')
    else if (scrollAccum.current > 0) buttons.push('SCROLL_DOWN')
    scrollAccum.current = 0
    const dx = mouseDeltaAccum.current.dx
    const dy = mouseDeltaAccum.current.dy
    mouseDeltaAccum.current = { dx: 0, dy: 0 }
    return { buttons, mouseDx: dx, mouseDy: dy }
  }, [pressedKeys, mouseButtons, effectiveCodeMap])

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

  return {
    pressedKeys,
    mouseButtons,
    mouseDelta,
    isPointerLocked,
    getInputState
  }
}

export default useGameInput
