/** Gamepad-driven UI navigation. Polls the gamepad on rAF and turns D-pad /
 *  A / B / Start presses into DOM focus moves, synthetic key events, click()s,
 *  and scope-cancel invocations.
 *
 *  Only active when `enabled` — game-input paths that also read the gamepad
 *  should be gated on `!enabled` so a D-pad press in the menu doesn't also fire
 *  as a game input. */

import { useEffect } from 'react'
import {
  findFirstFocusable,
  findFocusables,
  findInDirection,
  findNearestToViewportCenter,
  findScrollParent,
  focusSmooth,
  isInViewport,
  type NavDirection
} from '../lib/focusNavigation'
import { getActiveScopeRoot, getTopFocusScope } from '../context/focusScopeStack'
import { markGamepadInput } from '../lib/inputModality'

// Standard Gamepad mapping indices.
const BTN_A = 0
const BTN_B = 1
const BTN_START = 9
const BTN_DPAD_UP = 12
const BTN_DPAD_DOWN = 13
const BTN_DPAD_LEFT = 14
const BTN_DPAD_RIGHT = 15

const DPAD_REPEAT_DELAY_MS = 400
const DPAD_REPEAT_INTERVAL_MS = 80

const STICK_DEAD_ZONE = 0.2
/** Right-stick scroll speed, as a fraction of the scroller's clientHeight per frame. */
const STICK_SCROLL_SPEED = 0.025

const DIRECTION_KEY: Record<NavDirection, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight'
}

const isTextEntry = (el: Element | null): boolean => {
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    const nonText = ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file', 'image']
    return !nonText.includes(el.type)
  }
  return (el as HTMLElement | null)?.isContentEditable ?? false
}

const moveFocus = (direction: NavDirection) => {
  const focused = document.activeElement
  const hasRealFocus = focused instanceof HTMLElement && focused !== document.body
  const scope = getActiveScopeRoot()
  const candidates = findFocusables(scope)

  // Re-anchor: if the CFE has been scrolled off-screen (via mouse wheel or
  // right-stick scroll), the user's mental model no longer matches it. Jump
  // focus to the visible element nearest the viewport center and consume the
  // d-pad press so they can navigate from somewhere they can actually see.
  if (hasRealFocus && !isInViewport(focused)) {
    const visible = candidates.filter(isInViewport)
    const anchor = findNearestToViewportCenter(visible)
    if (anchor) {
      focusSmooth(anchor)
      return
    }
  }

  // Give the focused control a chance to consume the arrow: sliders / selects
  // use this to adjust value / cycle options inline. Skip dispatch for text
  // inputs — a gamepad user can't type, so arrow keys navigate instead of
  // moving the cursor. If preventDefault fires, we stop; otherwise we fall
  // through to spatial nav.
  if (hasRealFocus && !isTextEntry(focused)) {
    const key = DIRECTION_KEY[direction]
    const event = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true })
    focused.dispatchEvent(event)
    if (event.defaultPrevented) return
  }
  // No real focus yet (just <body>): land on the first focusable in the scope.
  // Without this, findInDirection would use body's full-viewport rect and nothing
  // would pass the "strictly in direction" filter.
  if (!hasRealFocus) {
    const first = candidates[0]
    if (first) focusSmooth(first)
    return
  }
  const next = findInDirection(focused, candidates, direction)
  if (next) focusSmooth(next)
}

const activate = () => {
  const focused = document.activeElement
  if (focused instanceof HTMLElement) focused.click()
}

const cancel = () => {
  // Dispatch a synthetic Escape first: if the focused element has a local
  // escape handler (e.g. SettingsKeybind while listening for a key to bind),
  // it gets to cancel itself instead of being exited out of its surface.
  const focused = document.activeElement
  if (focused instanceof HTMLElement) {
    const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
    focused.dispatchEvent(event)
    if (event.defaultPrevented) return
  }
  const scope = getTopFocusScope()
  const handler = scope?.getOnCancel()
  if (handler) handler()
}

export const useGamepadNavigation = (enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) {
      // UI becoming inactive (streaming resumed): clear focus so the reticle
      // doesn't linger over whatever card / button the user last navigated to.
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== document.body) active.blur()
      return
    }

    let rafId = 0
    // Seed prev state from the currently-held buttons. Without this, if a user
    // presses Start to enter the menu (which flips `enabled` → true on the next
    // frame), the first poll would see Start still held and immediately dismiss
    // the menu — a ping-pong between game input and UI nav.
    const seed = (idx: number): boolean => {
      const gps = navigator.getGamepads()
      for (const gp of gps) if (gp?.buttons[idx]?.pressed) return true
      return false
    }
    const prev = {
      a: seed(BTN_A),
      b: seed(BTN_B),
      start: seed(BTN_START),
      up: seed(BTN_DPAD_UP),
      down: seed(BTN_DPAD_DOWN),
      left: seed(BTN_DPAD_LEFT),
      right: seed(BTN_DPAD_RIGHT)
    }
    // Held-since timestamps for D-pad repeat handling.
    const heldSince: Record<NavDirection, number | null> = { up: null, down: null, left: null, right: null }
    const lastRepeat: Record<NavDirection, number> = { up: 0, down: 0, left: 0, right: 0 }

    const stepDirection = (direction: NavDirection, down: boolean, now: number) => {
      const was = prev[direction]
      prev[direction] = down
      if (down && !was) {
        heldSince[direction] = now
        lastRepeat[direction] = now
        markGamepadInput()
        moveFocus(direction)
        return
      }
      if (down && heldSince[direction] !== null) {
        const held = now - (heldSince[direction] ?? now)
        if (held < DPAD_REPEAT_DELAY_MS) return
        if (now - lastRepeat[direction] < DPAD_REPEAT_INTERVAL_MS) return
        lastRepeat[direction] = now
        markGamepadInput()
        moveFocus(direction)
        return
      }
      if (!down) heldSince[direction] = null
    }

    const scrollWithStick = (rsY: number) => {
      if (Math.abs(rsY) < STICK_DEAD_ZONE) return
      const focused = document.activeElement
      const anchor = focused instanceof HTMLElement ? focused : document.body
      const scroller = findScrollParent(anchor)
      if (!scroller) return
      scroller.scrollBy({ top: rsY * scroller.clientHeight * STICK_SCROLL_SPEED })
    }

    const poll = (now: number) => {
      const gamepads = navigator.getGamepads()
      for (const gp of gamepads) {
        if (!gp) continue
        const a = gp.buttons[BTN_A]?.pressed ?? false
        const b = gp.buttons[BTN_B]?.pressed ?? false
        const start = gp.buttons[BTN_START]?.pressed ?? false
        const dUp = gp.buttons[BTN_DPAD_UP]?.pressed ?? false
        const dDown = gp.buttons[BTN_DPAD_DOWN]?.pressed ?? false
        const dLeft = gp.buttons[BTN_DPAD_LEFT]?.pressed ?? false
        const dRight = gp.buttons[BTN_DPAD_RIGHT]?.pressed ?? false
        // Right-stick Y scrolls the focused element's scroll ancestor — lets
        // the user skim long menus without moving focus row by row.
        scrollWithStick(gp.axes[3] ?? 0)

        // Any edge-triggered press with no real focus: grab the scope's default
        // focusable (e.g. the portal on the main menu). Lets the user start
        // interacting with the gamepad without a priming d-pad press.
        const edgePressed =
          (a && !prev.a) ||
          (b && !prev.b) ||
          (start && !prev.start) ||
          (dUp && !prev.up) ||
          (dDown && !prev.down) ||
          (dLeft && !prev.left) ||
          (dRight && !prev.right)
        const active = document.activeElement
        const hasRealFocus = active instanceof HTMLElement && active !== document.body
        if (edgePressed && !hasRealFocus) {
          markGamepadInput()
          const first = findFirstFocusable(getActiveScopeRoot())
          if (first) focusSmooth(first)
          prev.a = a
          prev.b = b
          prev.start = start
          prev.up = dUp
          prev.down = dDown
          prev.left = dLeft
          prev.right = dRight
          continue
        }

        if (a && !prev.a) {
          markGamepadInput()
          activate()
        }
        prev.a = a

        if (b && !prev.b) {
          markGamepadInput()
          cancel()
        }
        prev.b = b

        // Start mirrors B for pause menus — the natural expectation is that
        // pressing Start while paused toggles back out (unpauses).
        if (start && !prev.start) {
          markGamepadInput()
          cancel()
        }
        prev.start = start

        stepDirection('up', dUp, now)
        stepDirection('down', dDown, now)
        stepDirection('left', dLeft, now)
        stepDirection('right', dRight, now)
      }
      rafId = requestAnimationFrame(poll)
    }
    rafId = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(rafId)
  }, [enabled])
}
