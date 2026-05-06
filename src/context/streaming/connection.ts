import type { TranslatableError } from '../../i18n'
import type { StageId } from '../../stages'
import type { ConnectionStatus, ServerConnection } from '../../hooks/engine/useWebSocket'
import { createStreamingContext } from './createStreamingContext'

export type ConnectionContextValue = {
  status: ConnectionStatus
  /** Canonical user-visible error: the sticky warm-flow / lifecycle
   *  error if one is set, otherwise the transport error from the
   *  connection union. */
  error: TranslatableError | null
  /** Sticky "connection lost" overlay flag — set when streaming was
   *  active and the socket dropped, cleared on reconnect / dismissal. */
  connectionLost: boolean
  statusStage: StageId | null
  isStreaming: boolean
  isVideoReady: boolean
  /** True when the user is actively driving the game (streaming +
   *  unpaused + no menu/modal). UI surfaces consult this to decide
   *  whether gamepad input goes to the game or to UI navigation.
   *  Inverse of `inputEnabled` in game terms. */
  isUIActive: boolean
  isFreshInstall: boolean
  /** Server identity + runtime metrics (system info, model, runtime
   *  metrics, last-error snapshot). */
  server: ServerConnection
  /** Session lifecycle transitions consumers can fire. */
  dismissConnectionLost: () => Promise<void>
  reconnectAfterConnectionLost: () => Promise<void>
  cancelConnection: () => Promise<void>
  prepareReturnToMainMenu: () => Promise<void>
}

export const { Context: ConnectionContext, use: useConnection } =
  createStreamingContext<ConnectionContextValue>('Connection')
