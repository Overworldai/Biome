# WebSocket Protocol (renderer ↔ World Engine)

The renderer connects to the World Engine at `ws(s)://{host}/ws?protocol_version=N` where `N` is the renderer's `PROTOCOL_VERSION`. All messages are JSON with a `type` field. The protocol has two layers, both modelled as Pydantic discriminated unions in `server-components/server/protocol.py` and re-exported to TypeScript via codegen (see [Cross-language types](#cross-language-types) below).

## Protocol version handshake

`server/protocol.py` defines a module-level `PROTOCOL_VERSION` constant that the codegen ships verbatim to the renderer. On every WS connect the renderer appends `?protocol_version=N` (in `useWebSocket.connect`); the server reads `websocket.query_params["protocol_version"]` immediately after `accept()` and compares against its own constant. On mismatch, the server pushes an `ErrorMessage` with `message_id: app.server.error.protocolVersionMismatch` and `params: {client, server}`, then closes the socket — the existing `error`-message machinery surfaces this as a localised "update Biome" error in the UI without any special-case path.

**Bump `PROTOCOL_VERSION`** for any wire-incompatible change: a removed/renamed/retyped field, a new required field, an RPC semantics change, a discriminator rename. **Don't bump** for purely additive changes (new optional field, new enum member old clients won't emit, new message type old clients won't see) — those degrade gracefully through the receive-path validation. Older clients hitting a bumped server get the typed mismatch error automatically; no client change required.

## Messages

**Push** (server→client), handled in `useWebSocket.ts`:

- `status` — `{stage: StageId, message?}`; engine progress through every `protocol.StageId`
- `system_info` — one-shot hardware identity broadcast right after handshake
- `error` / `warning` — see [Server error messages](#server-error-messages) below
- `log` — structured log event mirrored as `LogRecord` (`src/types/ipc.ts`); see [Logging](logging.md)
- (binary) — JPEG frame with a `FrameHeader` JSON prefix

**Client notifications** (fire-and-forget, no `req_id`): `control` (`{buttons[], mouse_dx, mouse_dy, ts?}`), `pause` / `resume` / `reset`, `prompt`.

**RPC** (`src/lib/wsRpc.ts`): For request/response. Request types live in `protocol.py` as `*Request` (init, scene_edit, generate_scene, check_seed_safety) and carry a `req_id`. Server replies `{type: 'response', req_id, success, data | error_id | error}`. Used via `useWebSocket().request()` or the `sendInit` helper.

## Server error messages

Server `error` and `warning` push messages use **translation keys** so the client can display localised text:

```jsonc
// Known error with a translation key
{"type": "error", "message_id": "app.server.error.serverStartupFailed", "message": "CUDA out of memory"}
// Warning with interpolation params
{"type": "warning", "message_id": "app.server.warning.seedUnsafe", "params": {"filename": "bad.jpg"}}
// Fallback: unknown/dynamic error with no translation key
{"type": "error", "message": "some unexpected exception text"}
```

- `message_id` — fully-qualified i18n key (e.g. `app.server.error.cudaRecoveryFailed`). Send the **full key path** so it's grep-able across the codebase.
- `message` — optional raw detail string. When both `message_id` and `message` are present, `message` is forwarded as the `message` interpolation param. Keys that want the detail include `{{message}}` in their string (e.g. `'Server startup failed: {{message}}'`); keys that don't just ignore it.
- `params` — optional interpolation parameters.

RPC error responses use `error_id` instead of `error`. On the client, `RpcError` (`src/lib/wsRpc.ts`) carries the `errorId` for consumers to resolve via `t()`.

## Cross-language types

`server/protocol.py` (plus a small `EXTRA_MODULES` list in the codegen for `recording.video_recorder`) is the single source of truth for every shape that crosses the Python ↔ TypeScript boundary:

```bash
cd server-components
uv run python scripts/codegen_ts.py            # writes ../src/types/protocol.generated.ts
uv run python scripts/codegen_ts.py --check    # CI freshness gate; exit 1 if stale
```

The generated file ships **both** Zod schemas and types — schemas are the source of truth on the TS side, types are derived via `z.infer<typeof FooSchema>` so drift between schema and type is structurally impossible. The one exception is the generic `RpcSuccessResponse<T>`, which keeps a hand-typed `interface` (the schema uses `data: z.unknown()` for runtime validation and the request map binds `T` at the call site).

| Python                                          | TypeScript                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `class Foo(BaseModel)`                          | `export const FooSchema = z.object({...})` + `export type Foo = z.infer<typeof FooSchema>` |
| `class Foo(StrEnum)`                            | `export const FooSchema = z.enum([...])` + inferred type alias                             |
| `Annotated[A \| B, Field(discriminator="...")]` | `z.discriminatedUnion('type', [...])` + inferred type alias                                |
| `FOO_BAR = <int \| float \| str \| bool>`       | `export const FOO_BAR = <value>` (UPPER_SNAKE_CASE, primary `protocol.py` only)            |
| `T \| None = None` / `T = <default>`            | `field: <T>.optional()` ⇒ `field?: T`                                                      |
| `Literal["x"]`                                  | `z.literal('x')` (discriminators stay required even with a default)                        |

Names that don't ship verbatim live in `_TS_RENAMES` at the top of the codegen script (e.g. `StageId` → `ServerStageId`, `RpcError` → `RpcErrorResponse` to dodge the JS `Error` name). Keep that list short and justified.

**Receive-path validation.** `useWebSocket.ts` runs `ServerMessageSchema.safeParse` on every incoming JSON message and `FrameHeaderSchema.safeParse` on every binary frame header. RPC responses validate the envelope (`type` / `req_id` / `success` / `error_id` / `error`) but leave `data` as `z.unknown()` — the request map binds the data shape at the call site. A failed validation logs the Zod error and the raw payload, then drops the message.

**Drift gates** (compile-time, in `src/i18n/index.ts` and `src/stages.ts`):

- Every server-emitted `MessageId` has a matching translation under `app.server.{error,warning}.*`, and every translation key under those subtrees has a matching `MessageId` (bidirectional check).
- Every `StageId` (server `ServerStageId` plus installer-only `InstallerStageId`) has a translation under `stage.*` and a percent in `STAGE_PERCENTS`.
- `lint-backend` CI runs `codegen_ts.py --check` after basedpyright; PRs that change `protocol.py` without regenerating fail.

## Adding new protocol shapes

Edit `protocol.py`, then run the codegen — the drift gates will tell you what else needs updating:

- **`MessageId`** — add the enum member with the full `app.server.{error,warning}.<key>` value, then add a translation in every locale.
- **`StageId`** — add the enum member, then add a percent in `STAGE_PERCENTS` (`src/stages.ts`) and a translation under `stage.*` in every locale.
- **Message / RPC type** — define the Pydantic model. Discriminated-union members go into `ClientMessage` / `ServerPushMessage`; RPCs name the request `*Request` and the payload `*ResponseData` so the codegen pairs them into `RpcRequestMap`. Wire into TS via `request('discriminator', params)` (RPC) or `sendNotif(notif)` (push).
