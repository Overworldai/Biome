/** Scene edit (prompt + tile-driven prop picker) state machine.
 *
 * The overlay is shown in two contexts:
 *   - Tap Q (or click): toggles the menu locked-open. Tap again / Esc closes.
 *   - Hold Q: keeps the menu open transiently for as long as Q is held.
 *     Releasing Q closes it unless a click on a tile or the prompt box
 *     promoted it to the locked state mid-hold.
 *
 * Tile click and prompt-Enter both transition to `submitting` (spinner over
 * a still-visible menu) and silently close on success. The prompt-path
 * carries an optional `preview` + `editPrompt` payload through SUCCESS so
 * existing notification / debug-preview consumers keep working; the tile
 * path never sets those.
 */

const TAP_THRESHOLD_MS = 200

export type SceneEditMode = 'inactive' | 'open' | 'submitting' | 'error'

export type SceneEditDebugPreview = {
  originalB64: string
  inpaintedB64: string
}

export type SceneEditState = {
  mode: SceneEditMode
  /** Timestamp (Date.now()) of the most recent Q keydown while in
   *  `open` mode with `locked=false`. Cleared on keyup or lock. Used
   *  to distinguish a tap from a hold on Q-up. */
  qDownAt: number | null
  /** Only meaningful when mode === 'open'. When true, the menu does not
   *  close on Q keyup; only a Q tap or Escape closes it. False means
   *  the menu is showing because Q is currently held. */
  locked: boolean
  /** Error message (only relevant in `error` mode). */
  errorMessage: string
  /** Debug preview of the last inpaint (prompt path only). */
  lastPreview: SceneEditDebugPreview | null
  /** VLM-authored edit prompt for the last prompt-path edit (used for
   *  the post-edit notification). Tile path leaves this null. */
  lastEditPrompt: string | null
}

export type SceneEditEvent =
  | { type: 'Q_DOWN'; at: number }
  | { type: 'Q_UP'; at: number }
  | { type: 'ESC' }
  /** Click on the prompt box or a tile — promotes a transient hold-Q
   *  view into a locked-open menu so it survives Q release. */
  | { type: 'LOCK' }
  /** A request has been kicked off (tile click after LOCK, or prompt
   *  Enter). Shows the spinner overlay. */
  | { type: 'SUBMIT' }
  | { type: 'SUCCESS'; preview?: SceneEditDebugPreview; editPrompt?: string }
  | { type: 'ERROR'; message: string }
  | { type: 'ERROR_TIMEOUT' }

export const initialSceneEditState: SceneEditState = {
  mode: 'inactive',
  qDownAt: null,
  locked: false,
  errorMessage: '',
  lastPreview: null,
  lastEditPrompt: null
}

const closeKeepingPreview = (state: SceneEditState): SceneEditState => ({
  ...initialSceneEditState,
  lastPreview: state.lastPreview,
  lastEditPrompt: state.lastEditPrompt
})

export function sceneEditReducer(state: SceneEditState, event: SceneEditEvent): SceneEditState {
  switch (event.type) {
    case 'Q_DOWN':
      // Repeated keydown (browser auto-repeat while Q is held) is a no-op.
      if (state.qDownAt !== null) return state
      switch (state.mode) {
        case 'inactive':
          return { ...state, mode: 'open', locked: false, qDownAt: event.at }
        case 'open':
          // Q tap while menu is already locked-open: toggle close.
          if (state.locked) return closeKeepingPreview(state)
          return state
        case 'submitting':
        case 'error':
          // Ignore Q during in-flight requests / error toast.
          return state
      }
      return state

    case 'Q_UP':
      if (state.qDownAt === null) return state
      // If something promoted us to locked while Q was held (tile/prompt
      // click), keep the menu open and just clear the timestamp.
      if (state.locked) {
        return { ...state, qDownAt: null }
      }
      // Otherwise: tap (short hold) locks the menu open; long hold closes
      // on release.
      if (event.at - state.qDownAt < TAP_THRESHOLD_MS) {
        return { ...state, locked: true, qDownAt: null }
      }
      return closeKeepingPreview(state)

    case 'ESC':
      if (state.mode === 'inactive') return state
      return closeKeepingPreview(state)

    case 'LOCK':
      if (state.mode !== 'open') return state
      return { ...state, locked: true, qDownAt: null }

    case 'SUBMIT':
      if (state.mode !== 'open') return state
      return { ...state, mode: 'submitting', locked: true, qDownAt: null }

    case 'SUCCESS':
      // Silent close — return to inactive. Carry the prompt-path
      // preview / VLM prompt forward for downstream notification UI.
      return {
        ...initialSceneEditState,
        lastPreview: event.preview ?? state.lastPreview,
        lastEditPrompt: event.editPrompt ?? null
      }

    case 'ERROR':
      return {
        ...initialSceneEditState,
        mode: 'error',
        errorMessage: event.message,
        lastPreview: state.lastPreview,
        lastEditPrompt: state.lastEditPrompt
      }

    case 'ERROR_TIMEOUT':
      if (state.mode !== 'error') return state
      return closeKeepingPreview(state)

    default:
      return state
  }
}
