/** Xbox-style gamepad visualisation for the input debug overlay. Mirrors the
 *  currently-pressed buttons (from `pressedGamepad` in StreamingContext) and
 *  the live stick deflections (polled directly from `navigator.getGamepads()`).
 *  Fades out after a few seconds of inactivity. */

import { GAMEPAD_CODES } from '../hooks/useGameInput'
import type { InputCode } from '../types/input'

const U = 4 // matches VirtualKeyboard/VirtualMouse unit (cqh)

const BTN_BASE =
  'flex items-center justify-center font-mono transition-all duration-75 border rounded-none select-none text-white'
const BTN_PRESSED = 'bg-white text-black border-white scale-105'
const BTN_UNPRESSED = 'bg-black/50 border-white/20 text-white/40'

type BtnProps = { label: string; pressed: boolean; w?: number; h?: number }
const Btn = ({ label, pressed, w = 1, h = 1 }: BtnProps) => (
  <div
    className={`${BTN_BASE} ${pressed ? BTN_PRESSED : BTN_UNPRESSED}`}
    style={{ width: `${U * w}cqh`, height: `${U * h}cqh`, fontSize: `${U * 0.45}cqh` }}
  >
    {label}
  </div>
)

type StickProps = { x: number; y: number; pressed: boolean }
const Stick = ({ x, y, pressed }: StickProps) => {
  const size = U * 2.2
  const indicator = 0.32
  return (
    <div
      className="relative rounded-full border transition-colors duration-75"
      style={{
        width: `${size}cqh`,
        height: `${size}cqh`,
        borderColor: pressed ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.25)',
        background: pressed ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.5)'
      }}
    >
      <div
        className="absolute rounded-full bg-white/80"
        style={{
          width: `${indicator * 100}%`,
          height: `${indicator * 100}%`,
          left: `${50 + x * 32}%`,
          top: `${50 + y * 32}%`,
          transform: 'translate(-50%, -50%)'
        }}
      />
    </div>
  )
}

type DpadProps = { pressed: (code: InputCode) => boolean }
const Dpad = ({ pressed }: DpadProps) => (
  <div className="relative" style={{ width: `${U * 2.2}cqh`, height: `${U * 2.2}cqh` }}>
    <div className="absolute left-1/2 top-0 -translate-x-1/2">
      <Btn label="↑" pressed={pressed(GAMEPAD_CODES.DPAD_UP)} w={0.7} h={0.7} />
    </div>
    <div className="absolute left-0 top-1/2 -translate-y-1/2">
      <Btn label="←" pressed={pressed(GAMEPAD_CODES.DPAD_LEFT)} w={0.7} h={0.7} />
    </div>
    <div className="absolute right-0 top-1/2 -translate-y-1/2">
      <Btn label="→" pressed={pressed(GAMEPAD_CODES.DPAD_RIGHT)} w={0.7} h={0.7} />
    </div>
    <div className="absolute left-1/2 bottom-0 -translate-x-1/2">
      <Btn label="↓" pressed={pressed(GAMEPAD_CODES.DPAD_DOWN)} w={0.7} h={0.7} />
    </div>
  </div>
)

type FaceProps = { pressed: (code: InputCode) => boolean }
const FaceButtons = ({ pressed }: FaceProps) => (
  <div className="relative" style={{ width: `${U * 2.2}cqh`, height: `${U * 2.2}cqh` }}>
    <div className="absolute left-1/2 top-0 -translate-x-1/2">
      <Btn label="Y" pressed={pressed(GAMEPAD_CODES.Y)} w={0.7} h={0.7} />
    </div>
    <div className="absolute left-0 top-1/2 -translate-y-1/2">
      <Btn label="X" pressed={pressed(GAMEPAD_CODES.X)} w={0.7} h={0.7} />
    </div>
    <div className="absolute right-0 top-1/2 -translate-y-1/2">
      <Btn label="B" pressed={pressed(GAMEPAD_CODES.B)} w={0.7} h={0.7} />
    </div>
    <div className="absolute left-1/2 bottom-0 -translate-x-1/2">
      <Btn label="A" pressed={pressed(GAMEPAD_CODES.A)} w={0.7} h={0.7} />
    </div>
  </div>
)

export type GamepadAxes = { lx: number; ly: number; rx: number; ry: number }

type VirtualGamepadProps = {
  pressedGamepad: Set<InputCode>
  axes: GamepadAxes
  visible: boolean
}

const VirtualGamepad = ({ pressedGamepad, axes, visible }: VirtualGamepadProps) => {
  const p = (code: InputCode): boolean => pressedGamepad.has(code)

  return (
    <div
      className="absolute bottom-[1.5cqh] left-1/2 -translate-x-1/2 z-10 pointer-events-none transition-opacity duration-[400ms] ease-out"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div className="flex flex-col" style={{ gap: `${U * 0.28}cqh` }}>
        {/* Shoulders + triggers */}
        <div className="flex justify-between">
          <div className="flex flex-col items-center" style={{ gap: `${U * 0.1}cqh` }}>
            <Btn label="LT" pressed={p(GAMEPAD_CODES.LT)} w={1.2} h={0.7} />
            <Btn label="LB" pressed={p(GAMEPAD_CODES.LB)} w={1.2} h={0.7} />
          </div>
          <div className="flex flex-col items-center" style={{ gap: `${U * 0.1}cqh` }}>
            <Btn label="RT" pressed={p(GAMEPAD_CODES.RT)} w={1.2} h={0.7} />
            <Btn label="RB" pressed={p(GAMEPAD_CODES.RB)} w={1.2} h={0.7} />
          </div>
        </div>

        {/* Main body: L cluster · center buttons · R cluster */}
        <div className="flex items-center justify-between" style={{ gap: `${U * 0.4}cqh` }}>
          <div className="flex flex-col items-center" style={{ gap: `${U * 0.2}cqh` }}>
            <Stick x={axes.lx} y={axes.ly} pressed={p(GAMEPAD_CODES.L3)} />
            <Dpad pressed={p} />
          </div>

          <div className="flex flex-col items-center" style={{ gap: `${U * 0.1}cqh` }}>
            <Btn label="◱" pressed={p(GAMEPAD_CODES.BACK)} w={0.8} h={0.5} />
            <Btn label="◲" pressed={p(GAMEPAD_CODES.START)} w={0.8} h={0.5} />
          </div>

          <div className="flex flex-col items-center" style={{ gap: `${U * 0.2}cqh` }}>
            <FaceButtons pressed={p} />
            <Stick x={axes.rx} y={axes.ry} pressed={p(GAMEPAD_CODES.R3)} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default VirtualGamepad
