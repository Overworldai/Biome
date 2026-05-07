# WebSocket Protocol (renderer ↔ World Engine)

The renderer connects to the World Engine at `ws(s)://{host}/ws?protocol_version=N` where `N` is the renderer's `PROTOCOL_VERSION`. All messages are JSON with a `type` field. The protocol has two layers, both modelled as Pydantic discriminated unions in `server-components/server/protocol.py` and re-exported to TypeScript via codegen (see [Cross-language types](#cross-language-types) below).

## Protocol version handshake

`server/protocol.py` defines a module-level `PROTOCOL_VERSION` constant which the codegen ships verbatim to the renderer. On every WS connect the renderer appends `?protocol_version=N` (in `useWebSocket.connect`); the server reads `websocket.query_params["protocol_version"]` immediately after `accept()` and compares against its own constant. On mismatch (or missing / unparseable value) the server pushes a typed `ErrorMessage` with `message_id: app.server.error.protocolVersionMismatch` and `params: {client, server}`, then closes the socket. The existing `error`-message machinery (`resolveServerMessage` → `TranslatableError`) surfaces this as a localised "update Biome" error in the UI without any special-case path.

**When to bump.** Any wire-incompatible change: a removed/renamed/retyped field, a new required field, an RPC semantics change, a discriminator rename. **When not to bump.** A new optional field, a new enum member that old clients won't emit, an entirely new message type that old clients won't see — those degrade gracefully through the existing receive-path validation.

**Bumping it:**

1. Increment `PROTOCOL_VERSION` in `server/protocol.py`.
2. Run the codegen — the new value flows to `src/types/protocol.generated.ts` and into `useWebSocket.ts` via the existing import.
3. Older clients connecting to the new server will get the typed mismatch error automatically; no client change required.

**Push messages** (server→client), handled in `useWebSocket.ts`:

- `status` — `{stage: StageId, message?}`; the engine reports progress through every stage in `protocol.StageId`
- `system_info` — one-shot hardware identity broadcast right after handshake
- `error` / `warning` — see [Server error messages](#server-error-messages) below
- `log` — structured log event `{line, level, logger?, timestamp?, fields?}` — `line` is the rendered text for display, the rest is the structlog snapshot. The renderer mirrors this shape as `LogRecord` (`src/types/ipc.ts`) for both `wsLogs` and engine-log IPC events, and rides it through to the diagnostics export so external triagers see the structured form, not just rendered text.
- (binary) — JPEG frame with a `FrameHeader` JSON prefix

**Client→server notifications** (fire-and-forget, no `req_id`):

- `control` — `{buttons[], mouse_dx, mouse_dy, ts?}`
- `pause` / `resume` / `reset`
- `prompt` — `{prompt}`

**RPC layer** (`src/lib/wsRpc.ts`): For request/response patterns. Request types live in `protocol.py` as `*Request` (init, scene_edit, generate_scene, check_seed_safety); each carries a `req_id`. Server replies with `{type: 'response', req_id, success, data | error_id | error}`. Used via `useWebSocket().request()` or the `sendInit` helper.

## Server error messages

Server `error` and `warning` push messages use **translation keys** so the client can display localised text. The protocol:

```jsonc
// Preferred: known error with a translation key
{"type": "error", "message_id": "app.server.error.serverStartupFailed", "message": "CUDA out of memory"}
// Warning with interpolation params
{"type": "warning", "message_id": "app.server.warning.seedUnsafe", "params": {"filename": "bad.jpg"}}
// Fallback: unknown/dynamic error with no translation key
{"type": "error", "message": "some unexpected exception text"}
```

- `message_id` — a fully-qualified i18n key (e.g. `app.server.error.cudaRecoveryFailed`). The server must send the **full key path** so it's searchable across the codebase.
- `message` — optional raw detail string (e.g. an exception message). When both `message_id` and `message` are present, `message` is forwarded as the `message` interpolation param to the translation key. Keys that want to surface the detail include `{{message}}` in their string (e.g. `serverStartupFailed: 'Server startup failed: {{message}}'`); keys that don't just ignore it. This keeps composed error text explicit per-key.
- `params` — optional interpolation parameters for the translation key (e.g. `{"filename": "seed.jpg"}`).

RPC error responses use the same convention with `error_id` instead of `error`:

```jsonc
{"type": "response", "req_id": "1", "success": false, "error_id": "app.server.error.someKnownError"}
{"type": "response", "req_id": "1", "success": false, "error": "unknown error text"}
```

On the client, `RpcError` (from `src/lib/wsRpc.ts`) carries the `errorId` for consumers to resolve via `t()`.

## Cross-language types

`server-components/server/protocol.py` (plus a small `EXTRA_MODULES` list in the codegen for `recording.video_recorder`) is the single source of truth for every shape that crosses the Python ↔ TypeScript boundary. A small Python script regenerates the TypeScript view:

```bash
cd server-components
uv run python scripts/codegen_ts.py            # writes ../src/types/protocol.generated.ts
uv run python scripts/codegen_ts.py --check    # CI freshness gate; exit 1 if stale
```

The generated file ships **both** Zod schemas and types. Schemas are the source of truth on the TS side; types are derived via `z.infer<typeof FooSchema>`. Drift between schema and type is structurally impossible — they're literally the same definition. The one exception is the generic `RpcSuccessResponse<T>`, which keeps a hand-typed `interface` because `z.infer` can't carry the generic parameter; the schema uses `data: z.unknown()` for runtime validation and the request map binds `T` at the call site.

What gets generated, from each Python construct:

| Python                                          | TypeScript                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `class Foo(BaseModel)`                          | `export const FooSchema = z.object({...})` + `export type Foo = z.infer<typeof FooSchema>` |
| `class Foo[T: BaseModel](BaseModel)`            | `export const FooSchema = z.object({...})` + hand-typed `export interface Foo<T>`          |
| `class Foo(StrEnum)`                            | `export const FooSchema = z.enum([...])` + inferred type alias                             |
| `Annotated[A \| B, Field(discriminator="...")]` | `z.discriminatedUnion('type', [...])` + inferred type alias                                |
| `FOO_BAR = <int \| float \| str \| bool>`       | `export const FOO_BAR = <value>` (UPPER_SNAKE_CASE, primary `protocol.py` only)            |
| `T \| None = None` / `T = <default>`            | `field: <T>.optional()` ⇒ `field?: T` (Pydantic's `exclude_none=True`)                     |
| `Literal["x"]`                                  | `z.literal('x')` ⇒ `'x'` (discriminators stay required even with a default)                |

Any `# pyright:` ignore comments inside `protocol.py` shouldn't be needed — the protocol module is pure types and basedpyright is clean there. The script's own per-rule rationale and the rename map (`StageId` → `ServerStageId` for the Python set, leaving the broader `StageId` alias for the renderer; `RpcError` / `RpcSuccess` → `*Response` to dodge a JS Error name) live in `scripts/codegen_ts.py`.

**Receive-path validation.** `useWebSocket.ts` runs `ServerMessageSchema.safeParse` on every incoming JSON message and `FrameHeaderSchema.safeParse` on every binary frame header. Push messages get full payload validation via the discriminated union; RPC responses validate the envelope (`type` / `req_id` / `success` / `error_id` / `error`) but leave `data` as `z.unknown()` — the request map binds the data shape at the call site. A failed validation logs the Zod error message and the raw payload, then drops the message rather than feeding garbage to the consumer.

**Drift gates.** `src/i18n/index.ts` carries compile-time assertions that fail if the protocol and the i18n keys diverge:

- Every `MessageId` value (server-emitted) must have a translation under `app.server.{error,warning}.*`, **and** every translation key under those subtrees must correspond to a `MessageId`. The check is bidirectional — orphan keys on either side fail tsc.
- Every `StageId` value (server `ServerStageId` plus installer-only `InstallerStageId` defined in `src/stages.ts`) must have a translation under `stage.*`, and vice versa.
- `src/stages.ts` exports `STAGE_PERCENTS: Record<StageId, number>` — the `Record<>` type forces tsc to flag any new stage that doesn't have a percent.
- `lint-backend` CI step runs `codegen_ts.py --check` after basedpyright; PRs that change `protocol.py` without regenerating the TS will fail.

**Adding new protocol shapes.** Edit `protocol.py`, then run the codegen — the drift gates above will tell you what else needs updating:

- **`MessageId`** — add the enum member with the full `app.server.{error,warning}.<key>` value, then add a translation under that key in every locale.
- **`StageId`** — add the enum member, then add a percent in `STAGE_PERCENTS` (`src/stages.ts`) and a translation under `stage.*` in every locale.
- **Message / RPC type** — define the Pydantic model. Discriminated-union members go into `ClientMessage` / `ServerPushMessage`; RPCs name the request `*Request` and the payload `*ResponseData` so the codegen pairs them into `RpcRequestMap`. Wire the typed shape into TS via `request('discriminator', params)` (RPC) or `sendNotif(notif)` (in `useWebSocket.ts`).

**Renaming the Python class.** Most `*Request` / `*Response` / `*Message` / `*Notif` names ship verbatim to TS. Exceptions live in `_TS_RENAMES` at the top of the codegen script — keep that list short and justified.
