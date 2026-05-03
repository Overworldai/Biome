/** Animated overlay that tracks `document.activeElement` and renders a bordered
 *  box around it. Only visible while the user is driving the UI with
 *  keyboard/gamepad (per `inputModality`). Snaps without animation when the
 *  focus target changes scope, otherwise slides smoothly. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useInputModality } from '../../lib/inputModality'

type ReticleRect = { cx: number; cy: number; w: number; h: number; radius: string; rotate: number }

const OUTER_PADDING = 4

/** If the focused element has `data-focus-target`, use the descendant matching
 *  that selector as the visual target instead. Lets a wrapping focusable (e.g.
 *  the tabindex'd portal hit-target) delegate its shape / rotation to an inner
 *  visually-distinctive element. */
const resolveVisualEl = (el: HTMLElement): HTMLElement => {
  const sel = el.dataset.focusTarget
  if (!sel) return el
  return el.querySelector<HTMLElement>(sel) ?? el
}

const resolveRadius = (outer: HTMLElement, visual: HTMLElement): string => {
  // `round` → ellipse sized to the box. Prefer the visual target's own
  // border-radius when it's non-zero; fall back to the outer's focus-shape.
  if ((outer.dataset.focusShape ?? visual.dataset.focusShape) === 'round') return '50%'
  const computed = getComputedStyle(visual).borderRadius
  if (computed && computed !== '0px') return computed
  const outerComputed = getComputedStyle(outer).borderRadius
  if (outerComputed && outerComputed !== '0px') return outerComputed
  return '0'
}

// Text-entry elements carry their own caret and focus styling; the reticle
// would sit on top and add visual noise without helping the user navigate.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', ''])
const isTextEntry = (el: HTMLElement): boolean => {
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type)
  return el.isContentEditable
}

const extractRotation = (transform: string): number => {
  if (!transform || transform === 'none') return 0
  const m = transform.match(/matrix\(([^)]+)\)/)
  if (m) {
    const [a, b] = m[1].split(',').map(Number)
    if (Number.isFinite(a) && Number.isFinite(b)) return (Math.atan2(b, a) * 180) / Math.PI
  }
  return 0
}

const readRect = (outer: HTMLElement): ReticleRect => {
  const visual = resolveVisualEl(outer)
  // Rotation preserves center; use the bounding rect's center as anchor and
  // the element's offset size as the un-rotated box dimensions.
  const r = visual.getBoundingClientRect()
  return {
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
    w: visual.offsetWidth + OUTER_PADDING * 2,
    h: visual.offsetHeight + OUTER_PADDING * 2,
    radius: resolveRadius(outer, visual),
    rotate: extractRotation(getComputedStyle(visual).transform)
  }
}

const FocusReticle = () => {
  const modality = useInputModality()
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [rect, setRect] = useState<ReticleRect | null>(null)
  const snapNextRef = useRef(true)
  // True while the target's position is changing frame-to-frame (e.g. a
  // framer-motion layout animation in progress). In that window we drop the
  // position/size CSS transitions so the reticle snaps every frame and tracks
  // the target directly — the 150ms transition turns into lag when new targets
  // arrive every 16ms.
  const continuousRef = useRef(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Track the currently-focused element. We only track "interesting" focuses —
  // if focus returns to document.body (no target), we hide rather than snap
  // to the body rectangle.
  useEffect(() => {
    const onFocusIn = () => {
      const el = document.activeElement
      if (!(el instanceof HTMLElement) || el === document.body || isTextEntry(el)) {
        setTarget(null)
        return
      }
      setTarget(el)
    }
    const onFocusOut = (e: FocusEvent) => {
      // Delay — focus may be moving to another element in the same tick.
      queueMicrotask(() => {
        const el = document.activeElement
        if (!(el instanceof HTMLElement) || el === document.body || isTextEntry(el)) {
          setTarget(null)
          return
        }
        if (e.target !== el) setTarget(el)
      })
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    // Prime from current state.
    onFocusIn()
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  // Track the target's position per-frame. Event listeners (scroll, resize,
  // ResizeObserver) miss transform-driven motion — e.g. framer-motion's layout
  // animations move the tile via `transform`, which fires none of those. rAF
  // polling is cheap and subsumes all of them: only setRect when something
  // actually changed, so React re-renders only on real movement.
  useLayoutEffect(() => {
    if (!target) {
      setRect(null)
      snapNextRef.current = true
      return
    }
    let rafId = 0
    let last: ReticleRect | null = null
    let lastChangeAt = 0
    const tick = () => {
      const next = readRect(target)
      if (
        !last ||
        last.cx !== next.cx ||
        last.cy !== next.cy ||
        last.w !== next.w ||
        last.h !== next.h ||
        last.rotate !== next.rotate ||
        last.radius !== next.radius
      ) {
        const nowMs = performance.now()
        // A change within ~2 frames of the previous one is continuous motion
        // (rAF-driven); a change after a long stable stretch is a discrete
        // scroll / resize / layout shift where the smooth slide looks better.
        continuousRef.current = nowMs - lastChangeAt < 40
        lastChangeAt = nowMs
        last = next
        setRect(next)
      } else {
        continuousRef.current = false
      }
      rafId = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(rafId)
  }, [target])

  // After a snap, re-enable transitions on the next frame.
  useLayoutEffect(() => {
    if (!snapNextRef.current) return
    snapNextRef.current = false
    const el = overlayRef.current
    if (!el) return
    // Force reflow, then restore transitions.
    el.getBoundingClientRect()
    el.style.transition = ''
  }, [target])

  if (!rect) return null

  const visible = modality !== 'mouse'
  // Anchor by the unrotated box's top-left corner, then rotate about center.
  const tx = rect.cx - rect.w / 2
  const ty = rect.cy - rect.h / 2
  const style: React.CSSProperties = {
    position: 'fixed',
    left: 0,
    top: 0,
    transform: `translate(${tx}px, ${ty}px) rotate(${rect.rotate}deg)`,
    transformOrigin: 'center center',
    width: rect.w,
    height: rect.h,
    pointerEvents: 'none',
    opacity: visible ? 1 : 0,
    // Must sit above modals (z-[10000]) and every other in-app layer, otherwise
    // the focus indicator hides behind a modal's backdrop and the modal looks
    // like it isn't receiving gamepad input even though it is.
    zIndex: 100000,
    border: '2px solid var(--color-text-primary)',
    borderRadius: rect.radius,
    boxShadow: '0 0 12px 2px var(--color-text-primary)',
    transition:
      snapNextRef.current || continuousRef.current
        ? 'opacity 100ms ease-out'
        : 'transform 150ms ease-out, width 150ms ease-out, height 150ms ease-out, opacity 100ms ease-out'
  }

  return <div ref={overlayRef} style={style} aria-hidden="true" />
}

export default FocusReticle
