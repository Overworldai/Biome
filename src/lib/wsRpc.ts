import { z } from 'zod'
import { createLogger } from '../utils/logger'
import { TranslatableError, type TranslationKey } from '../i18n'
import {
  RpcErrorResponseSchema,
  RpcSuccessResponseSchema,
  ServerPushMessageSchema,
  type RpcErrorResponse,
  type RpcRequestMap,
  type RpcSuccessResponse,
  type ServerPushMessage
} from '../types/protocol.generated'

const log = createLogger('WsRpc')

const DEFAULT_TIMEOUT_MS = 30_000

/** Runtime Error subclass thrown when a server RPC response signals failure.
 *  Distinct from the wire envelope `RpcErrorResponse` (which is a typed
 *  message shape); this one is what consumers `try/catch` around an
 *  `await request(...)` call. */
export class RpcError extends Error {
  readonly errorId: TranslationKey | undefined
  constructor(message: string, errorId?: TranslationKey) {
    super(message)
    this.errorId = errorId
  }
}

/** Every JSON message a client can receive over the WS. The codegen ships
 *  push messages and RPC envelopes separately; the parser needs the union. */
export type RpcResponse = RpcSuccessResponse<unknown> | RpcErrorResponse
export type ServerMessage = ServerPushMessage | RpcResponse

/** Runtime validator for incoming WS messages. Push messages get full
 *  payload validation via the discriminated union; RPC responses validate
 *  the envelope (`type` / `req_id` / `success` / `error_id` / `error`) but
 *  leave `data` as `z.unknown()` — the request map binds the data shape at
 *  the call site, so revalidating it here would be redundant. */
export const ServerMessageSchema = z.union([
  ServerPushMessageSchema,
  RpcSuccessResponseSchema,
  RpcErrorResponseSchema
]) satisfies z.ZodType<ServerMessage>

/** Function signature shared by `WsRpcClient.request` and every consumer
 *  that takes a request-sender as a callback (`StreamingContext`, hooks,
 *  components). Type-linked to the codegen `RpcRequestMap` so a typo in
 *  the discriminator literal or the params shape is a tsc error. */
export type WsRequest = <K extends keyof RpcRequestMap>(
  type: K,
  params: Omit<RpcRequestMap[K]['request'], 'type' | 'req_id'>,
  timeoutMs?: number
) => Promise<RpcRequestMap[K]['response']>

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
   * If `msg` is a `{type:"response"}` envelope, consume it (resolve or
   * reject the pending request) and narrow `msg` away from the response
   * variants. The caller's exhaustive switch then sees only push messages.
   */
  handleMessage(msg: ServerMessage): msg is RpcResponse {
    if (msg.type !== 'response') return false

    const entry = this.pending.get(msg.req_id)
    if (!entry) {
      log.warn('Received response for unknown req_id:', msg.req_id)
      return true
    }

    this.pending.delete(msg.req_id)
    clearTimeout(entry.timer)

    if (msg.success) {
      entry.resolve(msg.data)
    } else {
      // `MessageId` is a subset of `TranslationKey` (the i18n drift gate
      // in `src/i18n/index.ts` enforces this at compile time), so the
      // typed `msg.error_id` assigns to `TranslationKey | undefined`
      // without a cast.
      const errorId: TranslationKey | undefined = msg.error_id
      entry.reject(new RpcError(msg.error ?? errorId ?? 'Request failed', errorId))
    }

    return true
  }

  /**
   * Send a typed RPC request over the WebSocket. The `type` literal
   * picks the request/response shape from `RpcRequestMap` (codegen'd
   * from `*Request` ↔ `*ResponseData` pairs in `protocol.py`); `params`
   * must match the request shape minus `type`/`req_id`, and the
   * resolved value is the matching response payload.
   */
  request<K extends keyof RpcRequestMap>(
    type: K,
    params: Omit<RpcRequestMap[K]['request'], 'type' | 'req_id'>,
    timeoutMs?: number
  ): Promise<RpcRequestMap[K]['response']> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new TranslatableError('app.server.websocketNotConnected'))
    }

    const reqId = String(this.nextReqId++)
    const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise<RpcRequestMap[K]['response']>((resolve, reject) => {
      const timer =
        timeout > 0
          ? setTimeout(() => {
              this.pending.delete(reqId)
              reject(new TranslatableError('app.server.requestTimeout', { type, timeout: String(timeout) }))
            }, timeout)
          : undefined

      // The typed `resolve` (`(value: RpcRequestMap[K]['response']) => void`)
      // gets erased to `(data: unknown) => void` for storage in the
      // non-generic `pending` map. handleMessage's `entry.resolve(msg.data)`
      // re-enters the original closure, so K is preserved by capture even
      // though the Map can't track it. Necessary type-erasure at the
      // storage boundary; not a soundness hole.
      this.pending.set(reqId, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer
      })

      // Construction is correct by type: `params` is constrained to the
      // request shape minus `type`/`req_id`, so the spread plus those two
      // fields is structurally `RpcRequestMap[K]['request']`. JSON.stringify
      // accepts unknown — no cast needed.
      this.ws!.send(JSON.stringify({ type, req_id: reqId, ...params }))
    })
  }
}
