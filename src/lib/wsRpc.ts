import { createLogger } from '../utils/logger'

const log = createLogger('WsRpc')

const DEFAULT_TIMEOUT_MS = 30_000

type PendingRequest = {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
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
      entry.reject(new Error('WebSocket disconnected'))
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
      entry.reject(new Error(String(msg.error ?? 'Request failed')))
    }

    return true
  }

  /**
   * Send a request over WS and return a Promise that resolves with the
   * response `data` field, or rejects on error / timeout / disconnect.
   */
  request<T = unknown>(type: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not connected'))
    }

    const reqId = String(this.nextReqId++)
    const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new Error(`Request "${type}" timed out after ${timeout}ms`))
      }, timeout)

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
