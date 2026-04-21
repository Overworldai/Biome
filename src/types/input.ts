// Shared string-type aliases for the input pipeline. All three are plain
// `string` for ergonomics (avoids casts at DOM / wire-format boundaries); the
// aliases exist purely to document intent at every declaration.

/** A physical input identifier we RECEIVE from the user. Drawn from:
 *  - Keyboard: DOM `KeyboardEvent.code` values (`'KeyW'`, `'Space'`, `'Escape'`, `'ArrowUp'`).
 *  - Mouse: synthetic codes translated from `MouseEvent.button` (see `MOUSE_CODES` in `useGameInput`).
 *  - Gamepad: synthetic codes from polled state (see `GAMEPAD_CODES` in `useGameInput`). */
export type InputCode = string

/** A canonical code we SEND to the model in `control.buttons[]`
 *  (e.g. `'W'`, `'SPACE'`, `'SHIFT'`, `'MOUSE_LEFT'`). */
export type ServerCode = string

/** A human-readable label displayed in the settings UI (e.g. `'W'`, `'Space'`, `'Left Click'`).
 *  Produced by `keyCodeToLabel` in `SettingsKeybind.tsx`. */
export type DisplayLabel = string
