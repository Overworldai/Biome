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
  const overlayRef = useRef<HTMLDivElement>(null)

  // Track the currently-focused element. We only track "interesting" focuses —
  // if focus returns to document.body (no target), we hide rather than snap
  // to the body rectangle.
  useEffect(() => {
    const onFocusIn = () => {
      const el = document.activeElement
      if (!(el instanceof HTMLElement) || el === document.body) {
        setTarget(null)
        return
      }
      setTarget(el)
    }
    const onFocusOut = (e: FocusEvent) => {
      // Delay — focus may be moving to another element in the same tick.
      queueMicrotask(() => {
        const el = document.activeElement
        if (!(el instanceof HTMLElement) || el === document.body) {
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

  // Recompute position when the target or its layout changes.
  useLayoutEffect(() => {
    if (!target) {
      setRect(null)
      snapNextRef.current = true
      return
    }
    const update = () => setRect(readRect(target))
    update()

    const ro = new ResizeObserver(update)
    ro.observe(target)

    // Scroll changes anywhere in the tree can move the target — listen broadly.
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
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
    zIndex: 9999,
    border: '2px solid var(--color-text-primary)',
    borderRadius: rect.radius,
    boxShadow: '0 0 12px 2px var(--color-text-primary)',
    transition: snapNextRef.current
      ? 'none'
      : 'transform 150ms ease-out, width 150ms ease-out, height 150ms ease-out, opacity 100ms ease-out'
  }

  return <div ref={overlayRef} style={style} aria-hidden="true" />
}

export default FocusReticle
