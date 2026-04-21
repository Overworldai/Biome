import { createLogger } from '../utils/logger'
import { TranslatableError, type TranslationKey } from '../i18n'

const log = createLogger('WsRpc')

const DEFAULT_TIMEOUT_MS = 30_000

/** Error from a server RPC response, optionally carrying a translation key. */
export class RpcError extends Error {
  readonly errorId: TranslationKey | undefined
  constructor(message: string, errorId?: TranslationKey) {
    super(message)
    this.errorId = errorId
  }
}

type PendingRequest = {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

export class WsRpcClient {
  private nextReqId = 1
  private pending = new Map<string, PendingRequest>()
  private ws: WebSocket | null = null

  attach(ws: WebSocket): void {
    this.ws = ws
  }

  detach(): void {
    this.ws = null
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new TranslatableError('app.server.websocketDisconnected'))
    }
    this.pending.clear()
  }

  /**
   * Returns true if `msg` was a `{type:"response"}` and was consumed.
   * The caller should skip further processing of the message.
   */
  handleMessage(msg: Record<string, unknown>): boolean {
    if (msg.type !== 'response') return false

    const reqId = String(msg.req_id ?? '')
    const entry = this.pending.get(reqId)
    if (!entry) {
      log.warn('Received response for unknown req_id:', reqId)
      return true
    }

    this.pending.delete(reqId)
    clearTimeout(entry.timer)

    if (msg.success) {
      entry.resolve(msg.data)
    } else {
      const errorId = msg.error_id as TranslationKey | undefined
      entry.reject(new RpcError(String(msg.error ?? errorId ?? 'Request failed'), errorId))
    }

    return true
  }

  /**
   * Handle a binary RPC response. Returns true if the header contained a
   * `req_id` that matched a pending request (i.e. it was consumed).
   */
  handleBinaryResponse(header: Record<string, unknown>, blob: Blob): boolean {
    const reqId = header.req_id != null ? String(header.req_id) : null
    if (!reqId) return false

    const entry = this.pending.get(reqId)
    if (!entry) {
      log.warn('Received binary response for unknown req_id:', reqId)
      return true
    }

    this.pending.delete(reqId)
    clearTimeout(entry.timer)

    if (header.success) {
      entry.resolve({ blob })
    } else {
      const errorId = header.error_id as TranslationKey | undefined
      entry.reject(new RpcError(String(header.error ?? errorId ?? 'Request failed'), errorId))
    }

    return true
  }

  /**
   * Send a request over WS and return a Promise that resolves with the
   * response `data` field, or rejects on error / timeout / disconnect.
   */
  request<T = unknown>(type: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new TranslatableError('app.server.websocketNotConnected'))
    }

    const reqId = String(this.nextReqId++)
    const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise<T>((resolve, reject) => {
      const timer =
        timeout > 0
          ? setTimeout(() => {
              this.pending.delete(reqId)
              reject(new TranslatableError('app.server.requestTimeout', { type, timeout: String(timeout) }))
            }, timeout)
          : undefined

      this.pending.set(reqId, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer
      })

      this.ws!.send(
        JSON.stringify({
          type,
          req_id: reqId,
          ...(params ?? {})
        })
      )
    })
  }
}
