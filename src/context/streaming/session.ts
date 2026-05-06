import type { SceneEditState, SceneEditEvent } from './sceneEditMachine'
import { createStreamingContext } from './createStreamingContext'
import type { PauseState } from '../../hooks/streaming/usePauseState'

/** Pause / scene-edit / menu lifecycle state for the active session. */
export type SessionContextValue = {
  pause: PauseState
  settingsOpen: boolean
  sceneEdit: {
    state: SceneEditState
    dispatch: (event: SceneEditEvent) => void
  }
}

export const { Context: SessionContext, use: useSession } = createStreamingContext<SessionContextValue>('Session')
