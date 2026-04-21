/** Directional focus navigation — finds the spatially nearest focusable element
 *  in a given direction from the currently-focused element. Used by gamepad nav
 *  (d-pad) so a menu with a grid or multi-column layout hops to the visually
 *  expected neighbour rather than the next tabbable element in DOM order. */

export type NavDirection = 'up' | 'down' | 'left' | 'right'

// `:not([tabindex="-1"])` on every tag so explicitly-opted-out controls (window
// chrome like minimize / close) stay clickable via mouse but are skipped by
// gamepad and keyboard focus nav. Anchors (`<a href>`) are deliberately omitted
// — every anchor in the app is an info link, never a nav target.
const FOCUSABLE_SELECTOR = [
  'button:not(:disabled):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
  'input:not(:disabled):not([type="hidden"]):not([tabindex="-1"])',
  'select:not(:disabled):not([tabindex="-1"])',
  'textarea:not(:disabled):not([tabindex="-1"])',
  '[role="button"]:not([aria-disabled="true"]):not([tabindex="-1"])'
].join(', ')

const isVisible = (el: HTMLElement): boolean => {
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/** All visible focusable descendants of `root`, in document order. */
export const findFocusables = (root: ParentNode): HTMLElement[] => {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  return all.filter(isVisible)
}

/** Prefer an element marked with `data-default-focus`, else the first focusable.
 *  Delegation rules:
 *   - If the marked element is itself focusable and visible, return it.
 *   - Otherwise (including `display: contents` wrappers, which have no own layout),
 *     return its first focusable descendant.
 *   - If that also yields nothing, fall back to the first focusable in `root`. */
export const findFirstFocusable = (root: ParentNode): HTMLElement | null => {
  const marked = root.querySelector<HTMLElement>('[data-default-focus]')
  if (marked) {
    if (isVisible(marked) && marked.matches(FOCUSABLE_SELECTOR)) return marked
    const inner = findFocusables(marked)[0]
    if (inner) return inner
  }
  return findFocusables(root)[0] ?? null
}

/** Is the element's rect at least partially inside the viewport? Used to detect
 *  when a previously-focused element has scrolled off-screen so nav can
 *  re-anchor rather than navigate from somewhere the user can't see. */
export const isInViewport = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
}

/** Pick the focusable whose center is nearest the viewport center. Used to
 *  re-anchor focus after the user scrolls the CFE off-screen. */
export const findNearestToViewportCenter = (candidates: HTMLElement[]): HTMLElement | null => {
  const cx = window.innerWidth / 2
  const cy = window.innerHeight / 2
  let best: HTMLElement | null = null
  let bestDist = Infinity
  for (const el of candidates) {
    const r = el.getBoundingClientRect()
    const dx = (r.left + r.right) / 2 - cx
    const dy = (r.top + r.bottom) / 2 - cy
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      best = el
      bestDist = dist
    }
  }
  return best
}

/** Find the closest scrollable ancestor of `el` (including itself). Returns `null`
 *  if nothing in the chain has overflow auto/scroll. */
export const findScrollParent = (el: HTMLElement): HTMLElement | null => {
  let cur: HTMLElement | null = el
  while (cur && cur !== document.body) {
    const style = getComputedStyle(cur)
    if (/(auto|scroll)/.test(style.overflowY + style.overflowX)) return cur
    cur = cur.parentElement
  }
  return null
}

/** Focus an element and smoothly scroll its scroll-ancestor so the element is
 *  visible with some padding above/below. Replaces the default instant-snap
 *  behaviour of `element.focus()`, which is jarring during gamepad nav. */
export const focusSmooth = (el: HTMLElement, padding = 64): void => {
  el.focus({ preventScroll: true })
  const scroller = findScrollParent(el)
  if (!scroller) {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    return
  }
  const sr = scroller.getBoundingClientRect()
  const er = el.getBoundingClientRect()
  let delta = 0
  if (er.top < sr.top + padding) delta = er.top - sr.top - padding
  else if (er.bottom > sr.bottom - padding) delta = er.bottom - sr.bottom + padding
  if (delta !== 0) scroller.scrollBy({ top: delta, behavior: 'smooth' })
}

/** Find the best neighbour of `source` inside `candidates` in the given direction.
 *
 *  Two-phase filter:
 *    1. Keep candidates whose leading edge is strictly in the pressed direction
 *       from the source's trailing edge (so "right" requires the candidate's
 *       left edge ≥ source's right edge, not just "center to the right").
 *    2. Prefer candidates that overlap with the source on the cross axis —
 *       a button directly below wins over one that's down-and-over. Fall back
 *       to non-overlapping candidates if none overlap.
 *
 *  Scoring within a pool: edge-to-edge distance on the nav axis, weighted 10x
 *  over center-to-center distance on the cross axis. Returns null if nothing
 *  lies in the direction. */
export const findInDirection = (
  source: HTMLElement,
  candidates: HTMLElement[],
  direction: NavDirection
): HTMLElement | null => {
  const src = source.getBoundingClientRect()
  const srcCx = src.left + src.width / 2
  const srcCy = src.top + src.height / 2

  const inDirection: HTMLElement[] = []
  for (const el of candidates) {
    if (el === source) continue
    const r = el.getBoundingClientRect()
    const pass =
      direction === 'up'
        ? r.bottom <= src.top + 1
        : direction === 'down'
          ? r.top >= src.bottom - 1
          : direction === 'left'
            ? r.right <= src.left + 1
            : r.left >= src.right - 1
    if (pass) inDirection.push(el)
  }
  if (inDirection.length === 0) return null

  const overlapping: HTMLElement[] = []
  for (const el of inDirection) {
    const r = el.getBoundingClientRect()
    const overlap =
      direction === 'up' || direction === 'down'
        ? r.left < src.right && r.right > src.left
        : r.top < src.bottom && r.bottom > src.top
    if (overlap) overlapping.push(el)
  }
  const pool = overlapping.length > 0 ? overlapping : inDirection

  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of pool) {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const parallel =
      direction === 'up'
        ? src.top - r.bottom
        : direction === 'down'
          ? r.top - src.bottom
          : direction === 'left'
            ? src.left - r.right
            : r.left - src.right
    const clampedParallel = Math.max(0, parallel)
    const perpendicular = direction === 'up' || direction === 'down' ? Math.abs(cx - srcCx) : Math.abs(cy - srcCy)
    const score = clampedParallel * 10 + perpendicular
    if (score < bestScore) {
      best = el
      bestScore = score
    }
  }
  return best
}
