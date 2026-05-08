import type { TranslatableError } from '../../i18n'
import type { StageId } from '../../stages'
import type { ConnectionStatus, ServerConnection } from '../../hooks/engine/useWebSocket'
import type { ServerCapabilities } from '../../types/ipc'
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
  /** Per-config support sets the server reports it can run, from the
   *  warm-flow `/health` probe. `null` until a probe completes (or on
   *  failed probes / older servers without the field). The settings
   *  UI uses this to filter dropdowns (backend, quant) against real
   *  server capability — important in server mode where the remote
   *  may be on a different platform than the client. */
  serverCapabilities: ServerCapabilities | null
  /** Setter for `serverCapabilities`. The warm-flow probe populates
   *  this once a session enters LOADING, but the settings UI also
   *  probes the typed server URL for live validation — that probe
   *  has the same payload, so call this to feed its result into the
   *  context and the dropdowns react before streaming starts. */
  setServerCapabilities: (capabilities: ServerCapabilities | null) => void
  /** Session lifecycle transitions consumers can fire. */
  dismissConnectionLost: () => Promise<void>
  reconnectAfterConnectionLost: () => Promise<void>
  cancelConnection: () => Promise<void>
  prepareReturnToMainMenu: () => Promise<void>
}

export const { Context: ConnectionContext, use: useConnection } =
  createStreamingContext<ConnectionContextValue>('Connection')
