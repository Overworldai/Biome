import { useEffect, useMemo, useRef, useState } from 'react'
import { useStreaming } from '../context/StreamingContext'
import type { InputCode } from '../types/input'
import { CODE_MAP } from '../hooks/useGameInput'
import VirtualGamepad, { type GamepadAxes } from './VirtualGamepad'

// QWERTY keyboard layout (simple labels) — copied verbatim from owl-tube/app/InputDisplay/constants.ts
const KEYBOARD_LAYOUT = [
  ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'],
  ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
  ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter'],
  ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift'],
  ['Ctrl', 'Win', 'Alt', 'Space', 'Alt', 'Win', 'Ctrl']
]

/** Maps a keyboard-layout label to the set of `InputCode`s that should light it up
 *  when pressed. Labels not listed here are resolved via the letter/digit/function-key
 *  rules in `layoutLabelToInputCodes`. */
const LAYOUT_LABEL_TO_INPUT_CODES: Record<string, readonly InputCode[]> = {
  Esc: ['Escape'],
  Backspace: ['Backspace'],
  Tab: ['Tab'],
  Caps: ['CapsLock'],
  Enter: ['Enter'],
  Shift: ['ShiftLeft', 'ShiftRight'],
  Ctrl: ['ControlLeft', 'ControlRight'],
  Alt: ['AltLeft', 'AltRight'],
  Win: ['MetaLeft', 'MetaRight'],
  Space: ['Space'],
  '`': ['Backquote'],
  '-': ['Minus'],
  '=': ['Equal'],
  '[': ['BracketLeft'],
  ']': ['BracketRight'],
  '\\': ['Backslash'],
  ';': ['Semicolon'],
  "'": ['Quote'],
  ',': ['Comma'],
  '.': ['Period'],
  '/': ['Slash']
}

const layoutLabelToInputCodes = (label: string): readonly InputCode[] => {
  if (label in LAYOUT_LABEL_TO_INPUT_CODES) return LAYOUT_LABEL_TO_INPUT_CODES[label]
  if (/^[A-Z]$/.test(label)) return [`Key${label}`]
  if (/^\d$/.test(label)) return [`Digit${label}`]
  if (/^F\d+$/.test(label)) return [label] // F1..F12
  return []
}

const KEY_PRESSED = 'bg-white text-black border-white scale-105'
const KEY_SIMULATED = 'bg-cyan-500/60 text-white border-cyan-300'
const KEY_UNPRESSED = 'bg-black/50 border-white/20 text-white/40'
const KEY_BASE = 'flex items-center justify-center font-mono transition-all duration-75 border rounded-none select-none'

/** Base key unit in cqh — all key sizes are multiples of this */
const U = 4

/** Physical mouse delta decays shortly after the mouse stops — the arrow needs
 *  a transient rather than a continuous input to animate. */
const MOUSE_DELTA_DECAY_MS = 150
/** Pixels-per-frame at full-deflection right stick, matching `GAMEPAD_LOOK_SENSITIVITY`
 *  in useGameInput. */
const GAMEPAD_LOOK_SENSITIVITY = 18
/** How long to keep the gamepad overlay visible after the last press / stick
 *  deflection before fading it out. */
const GAMEPAD_IDLE_MS = 2500
const GAMEPAD_AXIS_ACTIVE = 0.15
/** Arrow scale for the mouse — accumulates raw pixels over a 150ms window so
 *  its magnitude is naturally 1–2 orders larger than a single-frame value. */
const MOUSE_ARROW_SCALE = 0.02
/** Arrow scale for the gamepad — shows the per-frame mouse-equivalent that the
 *  model is actually receiving (instantaneous, not accumulated), so we need a
 *  proportionally larger scale to render comparable arrow lengths on screen. */
const GAMEPAD_ARROW_SCALE = 0.6

type KeyState = 'pressed' | 'simulated' | 'none'
const keyStateClass = (s: KeyState): string =>
  s === 'pressed' ? KEY_PRESSED : s === 'simulated' ? KEY_SIMULATED : KEY_UNPRESSED

type KeyProps = {
  label: string
  state: KeyState
  width?: number
}

const Key = ({ label, state, width = U }: KeyProps) => (
  <div
    className={`${KEY_BASE} ${keyStateClass(state)}`}
    style={{ width: `${width}cqh`, height: `${U}cqh`, fontSize: `${U * 0.5}cqh` }}
  >
    <span className="truncate" style={{ padding: `0 ${U * 0.06}cqh` }}>
      {label}
    </span>
  </div>
)

type VirtualKeyboardProps = {
  pressedKeys: Set<InputCode>
  simulatedCodes: Set<InputCode>
}

const VirtualKeyboard = ({ pressedKeys, simulatedCodes }: VirtualKeyboardProps) => {
  const stateFor = (layoutLabel: string): KeyState => {
    const codes = layoutLabelToInputCodes(layoutLabel)
    if (codes.some((c) => pressedKeys.has(c))) return 'pressed'
    if (codes.some((c) => simulatedCodes.has(c))) return 'simulated'
    return 'none'
  }

  return (
    <div
      className="absolute bottom-[1.5cqh] left-[1.5cqh] z-10 pointer-events-none flex flex-col"
      style={{ gap: `${U * 0.11}cqh` }}
    >
      {KEYBOARD_LAYOUT.map((row, rowIdx) => (
        <div key={rowIdx} className="flex" style={{ gap: `${U * 0.11}cqh` }}>
          {row.map((key, colIdx) => {
            let width = U
            if (key === 'Backspace') width = U * 1.6
            else if (key === 'Tab') width = U * 1.4
            else if (key === '\\') width = U * 1.2
            else if (key === 'Caps' || key === 'Enter') width = U * 1.8
            else if (key === 'Shift') width = colIdx === 0 ? U * 2 : U * 2.4
            else if (key === 'Space') width = U * 6
            else if (key === 'Ctrl' || key === 'Alt' || key === 'Win') width = U * 1.2
            return <Key key={`${rowIdx}-${colIdx}`} label={key} state={stateFor(key)} width={width} />
          })}
        </div>
      ))}
    </div>
  )
}

type VirtualMouseProps = {
  mouseButtons: Set<InputCode>
  simulatedCodes: Set<InputCode>
  mouseDelta: { dx: number; dy: number }
  gamepadDelta: { dx: number; dy: number }
  scrollActive: { up: boolean; down: boolean }
}

const arrowFrom = (dx: number, dy: number, scale: number) => {
  const adx = dx * scale
  const ady = dy * scale
  const length = Math.sqrt(adx * adx + ady * ady)
  const angle = Math.atan2(ady, adx) * (180 / Math.PI)
  return { length, angle }
}

const VirtualMouse = ({ mouseButtons, simulatedCodes, mouseDelta, gamepadDelta, scrollActive }: VirtualMouseProps) => {
  const stateFor = (code: InputCode): KeyState => {
    if (mouseButtons.has(code)) return 'pressed'
    if (simulatedCodes.has(code)) return 'simulated'
    return 'none'
  }

  const physical = arrowFrom(mouseDelta.dx, mouseDelta.dy, MOUSE_ARROW_SCALE)
  const simulated = arrowFrom(gamepadDelta.dx, gamepadDelta.dy, GAMEPAD_ARROW_SCALE)

  return (
    <div
      className="absolute bottom-[1.5cqh] right-[1.5cqh] z-10 pointer-events-none flex flex-col items-center"
      style={{ gap: `${U * 0.15}cqh` }}
    >
      {/* Movement arrow */}
      <div className="relative flex items-center justify-center w-[18cqh] h-[18cqh]">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-gray-800/80 w-[18cqh] h-[18cqh]" />
        </div>
        <svg width="100%" height="100%" viewBox="-50 -50 100 100" className="overflow-visible relative z-10">
          {physical.length > 0.1 && (
            <g transform={`rotate(${physical.angle})`}>
              <line x1="0" y1="0" x2={physical.length} y2="0" stroke="#d1d5db" strokeWidth="3" strokeLinecap="round" />
              <polygon
                points={`${physical.length},0 ${physical.length - 8},-5 ${physical.length - 8},5`}
                fill="#d1d5db"
              />
            </g>
          )}
          {simulated.length > 0.1 && (
            <g transform={`rotate(${simulated.angle})`}>
              <line x1="0" y1="0" x2={simulated.length} y2="0" stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" />
              <polygon
                points={`${simulated.length},0 ${simulated.length - 8},-5 ${simulated.length - 8},5`}
                fill="#67e8f9"
              />
            </g>
          )}
          {physical.length <= 0.1 && simulated.length <= 0.1 && <circle cx="0" cy="0" r="3" fill="#6b7280" />}
        </svg>
      </div>

      {/* LMB / MMB / RMB row */}
      <div className="flex" style={{ gap: `${U * 0.11}cqh` }}>
        <div
          className={`${KEY_BASE} ${keyStateClass(stateFor('MouseLeft'))} rounded-t-[0.6cqh] rounded-b-none`}
          style={{ width: `${U * 1.2}cqh`, height: `${U * 1.2}cqh`, fontSize: `${U * 0.5}cqh` }}
        >
          LMB
        </div>
        <div className="relative">
          <div
            className={`${KEY_BASE} ${keyStateClass(stateFor('MouseMiddle'))} rounded-t-[0.6cqh] rounded-b-none`}
            style={{ width: `${U * 1.2}cqh`, height: `${U * 1.2}cqh`, fontSize: `${U * 0.5}cqh` }}
          >
            MMB
          </div>
          {(scrollActive.up || scrollActive.down) && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <svg width="100%" height="100%" viewBox="0 0 20 40" className="overflow-visible">
                {scrollActive.up ? (
                  <polygon points="10,5 5,12 15,12" fill="#d1d5db" stroke="#6b7280" strokeWidth="1" />
                ) : (
                  <polygon points="10,35 5,28 15,28" fill="#d1d5db" stroke="#6b7280" strokeWidth="1" />
                )}
              </svg>
            </div>
          )}
        </div>
        <div
          className={`${KEY_BASE} ${keyStateClass(stateFor('MouseRight'))} rounded-t-[0.6cqh] rounded-b-none`}
          style={{ width: `${U * 1.2}cqh`, height: `${U * 1.2}cqh`, fontSize: `${U * 0.5}cqh` }}
        >
          RMB
        </div>
      </div>

      {/* X1 / X2 row */}
      <div className="flex" style={{ gap: `${U * 0.11}cqh` }}>
        <Key label="X1" state={stateFor('MouseBack')} width={U * 1.2} />
        <Key label="X2" state={stateFor('MouseForward')} width={U * 1.2} />
      </div>
    </div>
  )
}

/** Walk `CODE_MAP` and collect every non-gamepad `InputCode` whose server code
 *  is currently being emitted by a pressed gamepad input. These are the KB+M
 *  keys / buttons to light up as "simulated" in the overlay. */
const computeSimulatedKBM = (pressedGamepad: Set<InputCode>): Set<InputCode> => {
  const simulatedServerCodes = new Set<string>()
  for (const code of pressedGamepad) {
    const sc = CODE_MAP[code]
    if (sc) simulatedServerCodes.add(sc)
  }
  if (simulatedServerCodes.size === 0) return new Set()
  const result = new Set<InputCode>()
  for (const [code, sc] of Object.entries(CODE_MAP)) {
    if (code.startsWith('Gamepad')) continue
    if (simulatedServerCodes.has(sc)) result.add(code)
  }
  return result
}

const InputOverlay = () => {
  const { inputOverlay, isStreaming, pressedKeys, mouseButtons, pressedGamepad, scrollActive, gamepadSensitivity } =
    useStreaming()

  const mouseDeltaRef = useRef({ dx: 0, dy: 0 })
  const [mouseDelta, setMouseDelta] = useState({ dx: 0, dy: 0 })
  const decayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live gamepad axes (polled on rAF). Kept in state so the widgets re-render.
  const [axes, setAxes] = useState<GamepadAxes>({ lx: 0, ly: 0, rx: 0, ry: 0 })
  const [gamepadActive, setGamepadActive] = useState(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!inputOverlay || !isStreaming) {
      if (decayTimeoutRef.current) clearTimeout(decayTimeoutRef.current)
      return
    }

    const handleMouseMove = (e: MouseEvent) => {
      mouseDeltaRef.current.dx += e.movementX
      mouseDeltaRef.current.dy += e.movementY
      if (decayTimeoutRef.current) clearTimeout(decayTimeoutRef.current)
      decayTimeoutRef.current = setTimeout(() => {
        mouseDeltaRef.current = { dx: 0, dy: 0 }
        setMouseDelta({ dx: 0, dy: 0 })
      }, MOUSE_DELTA_DECAY_MS)
      setMouseDelta({ ...mouseDeltaRef.current })
    }

    document.addEventListener('mousemove', handleMouseMove)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      if (decayTimeoutRef.current) clearTimeout(decayTimeoutRef.current)
    }
  }, [inputOverlay, isStreaming])

  useEffect(() => {
    if (!inputOverlay || !isStreaming) return
    let raf = 0
    const poll = () => {
      const pads = navigator.getGamepads()
      let lx = 0
      let ly = 0
      let rx = 0
      let ry = 0
      let anyPressed = false
      for (const gp of pads) {
        if (!gp) continue
        lx = gp.axes[0] ?? 0
        ly = gp.axes[1] ?? 0
        rx = gp.axes[2] ?? 0
        ry = gp.axes[3] ?? 0
        anyPressed = gp.buttons.some((b) => b.pressed)
        break
      }
      setAxes({ lx, ly, rx, ry })
      const axisActive =
        Math.abs(lx) > GAMEPAD_AXIS_ACTIVE ||
        Math.abs(ly) > GAMEPAD_AXIS_ACTIVE ||
        Math.abs(rx) > GAMEPAD_AXIS_ACTIVE ||
        Math.abs(ry) > GAMEPAD_AXIS_ACTIVE
      if (anyPressed || axisActive) {
        setGamepadActive(true)
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        idleTimerRef.current = setTimeout(() => setGamepadActive(false), GAMEPAD_IDLE_MS)
      }
      raf = requestAnimationFrame(poll)
    }
    raf = requestAnimationFrame(poll)
    return () => {
      cancelAnimationFrame(raf)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [inputOverlay, isStreaming])

  const simulatedCodes = useMemo(() => computeSimulatedKBM(pressedGamepad), [pressedGamepad])

  // Per-frame mouse-equivalent delta the model sees from the right stick —
  // instantaneous, not accumulated. Scaled by the user's gamepad sensitivity
  // so the arrow reflects what the server is actually receiving this frame.
  const gamepadDelta = useMemo(() => {
    const scale = GAMEPAD_LOOK_SENSITIVITY * gamepadSensitivity
    const dx = Math.abs(axes.rx) > GAMEPAD_AXIS_ACTIVE ? axes.rx * scale : 0
    const dy = Math.abs(axes.ry) > GAMEPAD_AXIS_ACTIVE ? axes.ry * scale : 0
    return { dx, dy }
  }, [axes.rx, axes.ry, gamepadSensitivity])

  if (!inputOverlay || !isStreaming) return null

  return (
    <>
      <VirtualKeyboard pressedKeys={pressedKeys} simulatedCodes={simulatedCodes} />
      <VirtualGamepad pressedGamepad={pressedGamepad} axes={axes} visible={gamepadActive} />
      <VirtualMouse
        mouseButtons={mouseButtons}
        simulatedCodes={simulatedCodes}
        mouseDelta={mouseDelta}
        gamepadDelta={gamepadDelta}
        scrollActive={scrollActive}
      />
    </>
  )
}

export default InputOverlay
