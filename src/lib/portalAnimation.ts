/**
 * Single source of truth for the portal's animation timings and target
 * values. Consumers:
 *
 *   - `useBackgroundCycle` (JS timers for the main-menu video cycle)
 *   - `usePortalAnimator`  (JS state machine for externally-driven closes)
 *   - `PortalPreview`      (writes these as CSS vars on its root element,
 *                          which the keyframe/transition rules in app.css
 *                          read bare — no fallback defaults)
 */

/** Default shrink duration for the background-video cycle on the main menu. */
export const PORTAL_SHRINK_DURATION_MS = 340

/** Faster shrink duration for externally-driven closes (e.g. Settings
 *  opening). Matches the Settings panel's fade-in (250ms from
 *  `viewFadeVariants`) so the two line up start-to-end. */
export const PORTAL_SHRINK_FAST_DURATION_MS = 250

/** Final scale the portal collapses to. 0 = fully invisible. */
export const PORTAL_SHRINK_END_SCALE = 0

/** Extra time added to the shrink duration for JS-side failsafe timers
 *  (in case the CSS animationend event never fires — tab backgrounded, etc). */
export const PORTAL_SHRINK_FAILSAFE_BUFFER_MS = 120

/** Duration of the background-video cycle's reveal animation (the clip-path
 *  ellipse expanding from a small bloom to full coverage when a new video
 *  becomes active on the main menu). Referenced by the CSS
 *  `.app-background-transition-slide` rule. */
export const PORTAL_BG_REVEAL_DURATION_MS = 960

/** Duration of the portal spawn-in (`.entering`) animation. Matched to
 *  `PORTAL_BG_REVEAL_DURATION_MS` so that the portal respawn and the
 *  background reveal run on the same clock during a cycle transition. */
export const PORTAL_ENTER_DURATION_MS = PORTAL_BG_REVEAL_DURATION_MS
