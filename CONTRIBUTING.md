## Commands

```bash
npm run dev          # Start dev server (Electron Forge + Vite hot-reload)
npm run build        # Production build with installers
npm run package      # Package without installers
npm run lint         # Check formatting (Prettier) + type-check (tsc)
npm run lint-fix     # Auto-fix formatting (Prettier) + type-check (tsc) — run after finishing work
```

For the Python server in `server-components/`, run lint and type-check with:

```bash
cd server-components
uvx ruff check .          # Lint
uvx ruff format .         # Auto-format (also: --check to verify without rewriting)
uvx ruff check --fix .    # Auto-fix lint issues where ruff has a safe rewrite
uvx basedpyright .        # Type-check (strict mode)
uv lock --check           # Verify uv.lock is in sync with pyproject.toml
```

All must pass before a commit lands. The typed Pydantic boundaries in `server/protocol.py` and the `Connection` invariants in `server/session/` are what we rely on to catch real semantic errors.

### Suppressions strategy

`pyproject.toml` carries **zero project-wide ruff or basedpyright suppressions** — every silenced lint/type report is scoped to the line or file that triggers it, so a new violation in pure-Python code surfaces under strict mode. Three layers, in order of preference:

1. **Fix the underlying issue.** Narrow `except Exception` to the actual raisers (`OSError`, `pydantic.ValidationError`, `binascii.Error`, etc.); add a `_require_X()` helper instead of repeating `if self._x is None: raise` (see `WorldEngineManager._require_engine`); hoist module-level loops into a function so cleanup vars don't leak; replace `try/except/pass` with `contextlib.suppress(...)`.
2. **Per-line ignore.** `# noqa: BLE001  -- <reason>` for ruff, `# pyright: ignore[reportXxx]  -- <reason>` for basedpyright. The trailing `-- <reason>` is required — ruff and pyright both ignore everything after the rule, but future readers shouldn't have to guess. Stack both on one line if needed: `# noqa: BLE001  # pyright: ignore[reportUnusedExcept]  -- ...`.
3. **Per-file pragma.** `# pyright: reportUnknownMemberType=none, ...` at the top of the module (after the docstring). Only for files that touch torch / `world_engine` / diffusers / transformers / `llama_cpp` / pynvml / `py-cpuinfo` — third-party libs whose stubs are partial or absent. Add a rule to the pragma only if it fires on third-party type leakage; never to silence a real local issue. Ruff has no equivalent — use per-line `# noqa` everywhere.

### Concrete exception classes

Ruff's `TRY003` flags long messages passed to bare `RuntimeError` / `ValueError`. Define a typed subclass in the same module instead — see `EngineNotLoadedError`, `ModelUriRequiredError`, `UnsupportedModelTypeError`, `VlmNotLoadedError`, `KleinPipelineNotLoadedError`, `NoToolCallsError`, `VlmToolCallRetryError`. The class owns the message and (where useful) carries structured payload fields the catch site can inspect.

### Structured logging

Both sides of Biome (the Python server and the Electron main process) emit the same structured `LogRecord` shape: `{event, level, logger, timestamp, fields?, exception?}`. The `logger` field is how the Python ↔ Electron distinction is made — `engine.manager` / `server.routes` come from Python, `engine.setup` / `electron.main` come from Electron — so message text never carries `[ENGINE]` / `[SERVER]` / `[UV]`-style prefixes on either side. The renderer (`ServerLogDisplay` in `src/components/`) renders the same `LogLine` for every record, with the logger pill providing the visual attribution.

#### Python (structlog)

Server-side logs go through `structlog` (configured once in `util/server_logging.py`). Get a logger with `log = structlog.stdlib.get_logger(__name__)` at the top of each module — the module name is the scope, and an event renders as:

```
12:34:56 [info    ] [engine.manager] Loading model client_host=127.0.0.1 model=waypoint-1.5 current_step=1 total_steps=3
```

- **Pass dynamic data as kwargs, not f-strings.** `logger.info("Loading seed", filename=name)` over `logger.info(f"Loading seed {name}")`. The renderer prints them as `key=value`; the WS broadcast and diagnostics export keep them as a structured `dict`.
- **Per-connection scope.** The WS endpoint wraps each session in `structlog.contextvars.bound_contextvars(client_host=...)` so every event under that connection auto-tags `client_host`. Asyncio tasks inherit the contextvars; the generator thread is wired explicitly via `contextvars.copy_context()` (see `server/session/workers.run_generator`).
- **Sub-operation scope.** Inside a routine that owns a multi-step operation, bind once with `log = logger.bind(operation="reset")` and re-use `log` for the rest of that scope. Use `current_step=N, total_steps=TOTAL` (with `TOTAL` as a module-level constant — see `LOAD_ENGINE_TOTAL_STEPS` / `WARMUP_TOTAL_STEPS` in `engine/manager.py`) rather than `[1/3]` in the message text.
- **No bracketed prefixes** (`[ENGINE]`, `[RECV]`, `[GENERATE_SCENE]`, …). The logger name and bound contextvars already carry scope; if the current scope isn't enough, bind another contextvar or `operation` rather than re-introducing prefixes.
- **Broadcast and file mirroring are split.** `LogBroadcast` is fed by a structlog processor and fans each event out as a typed `LogMessage` (`event` + `level` + `logger` + `timestamp` + `exception` + `fields`) to every connected WS client. `TeeStream` only mirrors stdout/stderr into `server.log`. The WS broadcast always carries the structured form regardless of the local renderer.

#### Electron (`getLogger`)

Electron-side logs go through a hand-rolled mirror of structlog at `electron/lib/logger.ts`:

```ts
import { getLogger } from '../lib/logger.js'

const log = getLogger('engine.setup', { defaultBroadcast: true })

log.info('Setting up server components')
log.info('Removed engine directory', { fields: { path: engineDir } })
log.warning('Stale lockfile', { fields: { age_days: 12 } })
log.error('Setup failed', { exception: err.stack })
```

- **One logger per module / concern.** Names are dotted paths matching Python's convention. Established names: `electron.main` (app lifecycle), `electron.config` (settings load/migrate), `electron.seeds` (seed thumbnails), `electron.recordings`, `electron.update`; `engine.setup` (install / sync / nuke), `engine.diagnostics` (`check-engine-status` internals), `engine.server` (server lifecycle + Python-stdout fallback attribution), `engine.uv-sync` (uv subprocess fallback attribution).
- **`defaultBroadcast: true`** for loggers whose every event should also reach the renderer's log buffer (engine setup phases, server lifecycle). Per-call `broadcast: true | false` overrides the default. `engine.diagnostics` defaults off — its check-engine-status spam stays on the Electron-process console.
- **Pass dynamic data as `fields`, not template strings.** `log.info('Removed engine directory', { fields: { path } })` over `log.info(\`Removed ${path}\`)`. Same rationale as Python kwargs — preserves type fidelity in the diagnostic export.
- **Subprocess pass-through is a separate path.** Lines from the Python server's stdout / `uv sync`'s stdout aren't logged via `getLogger`; they ride through `parseLogLine` (`electron/lib/logRecord.ts`) which JSON-parses each line if possible, falls back to `{ event: line }` otherwise, and accepts a `fallbackLogger` so unparseable lines still get attributed (`engine.server` for Python stdout, `engine.uv-sync` for uv's). The raw line is also written through to Electron's stdout/stderr unchanged so a developer reading `npm run dev` sees the original Python output (which is itself structured in JSON mode).
- **No bracketed prefixes.** Same rule as Python: never `console.log('[ENGINE] ...')` or write `'[engine.setup] foo'` as the event string. Authors call `log.info('foo')` and the renderer / formatter renders the logger pill from the typed field.

#### stdout / `server.log` / Electron-stdout format — text vs JSON

Both sides use the same TTY heuristic and override env var (`BIOME_LOG_FORMAT=text|json`):

| `BIOME_LOG_FORMAT` | TTY?    | Format chosen                                       |
| ------------------ | ------- | --------------------------------------------------- |
| `text`             | (any)   | One human-readable line per event                   |
| `json`             | (any)   | One JSON object per line (JSON-Lines)               |
| _unset_            | TTY     | text (developer running `npm run dev` / `python`)   |
| _unset_            | non-TTY | JSON (CI, packaged binary spawned with piped stdio) |

Resolved by `_resolve_log_format()` (Python, `util/server_logging.py`) and `resolveLogFormat()` (TS, `electron/lib/logger.ts`). Each format reads:

```
# text mode
22:20:06 [info    ] [engine.setup] Loading uv version=0.10.9
22:20:06 [warning ] [engine.setup] Stale lockfile

# JSON mode (one event per line, formatted here for readability)
{"event": "Loading uv", "level": "info", "logger": "engine.setup", "timestamp": "22:20:06", "fields": {"version": "0.10.9"}}
{"event": "Stale lockfile", "level": "warning", "logger": "engine.setup", "timestamp": "22:20:06"}
```

In JSON mode, the Python server's `read_log_tail_records` parses each replayed `server.log` line back into a `LogMessage` so the WS log replay carries the same fidelity as live events; in text mode each line replays as `LogMessage(event=line)` (degraded — only matters across server restarts).

#### Renderer-side rendering

`ServerLogDisplay`'s `LogLine` component renders each `LogRecord` (whether sourced from a Python WS log push or an Electron `engine-log` IPC event) with a fixed visual hierarchy that matches the text-mode formatters:

- timestamp — dim, mono
- level — uppercase, color-coded (`info` body, `warning` warm, `error`/`critical` bright)
- logger — `[name]` mono, dim (this is what tells the user "Python vs Electron")
- event — body color
- fields — `key=value` pairs, dim
- exception — preformatted block underneath, error-colored

Plain-text formatting for clipboard / GitHub-issue exports goes through `formatLogRecordPlainText` in the same file so the on-screen and exported strings stay aligned.

A future port to Rust's `tracing` should map cleanly: spans ↔ contextvars / `getLogger`, fields ↔ kwargs / `fields`, the `tracing_subscriber` JSON layer ↔ `JSONRenderer`, the console layer ↔ `ConsoleRenderer`.

### Logging exceptions

Prefer `logger.exception("...")` over `logger.error("...", exc_info=True)` — ruff's `TRY400` enforces this so the traceback always logs. The exception is a status notice where the traceback is noise: timeouts, recovery success/failure messages, an `error()` immediately followed by `raise CustomError() from e`. Suppress per-line with `# noqa: TRY400  -- <reason>` and keep `.error(...)`.

### FastAPI dependencies

Use `Annotated[T, Depends(fn)]` rather than `T = Depends(fn)` for route parameters — the latter trips `B008` (function call in default arg). See `server/routes.py` for the pattern.

No test framework is configured.

Run `npm run lint` after every major block of work to catch formatting and type errors early. Use `npm run lint-fix` to auto-fix formatting issues found by the linter.

## Cutting a Release

```bash
node scripts/release.mjs          # Print current version
node scripts/release.mjs <version> # Bump versions, commit, and tag
```

This updates version numbers across the project, creates a commit, and tags it. Follow the script's output for next steps.

### Release Checklist

The goal is to verify that the release behaves reasonably on an arbitrary user system, regardless of what is or isn't already installed globally. At the time of writing, Biome is expected to work on **Linux and Windows with an NVIDIA GPU**; other platforms and GPU vendors are out of scope for functional testing but should still fail gracefully. The compatibility target is not fixed — re-check it when cutting each release.

**Fresh install** — on a clean environment without pre-existing Python, Node, CUDA toolchain, or C compiler (Windows Sandbox; a fresh Ubuntu / Fedora / Arch container via `./scripts/appimage-docker-desktop.sh`):

- [ ] Installer / AppImage launches
- [ ] Standalone mode unpacks `world_engine/`, installs UV + managed Python, runs `uv sync`, and reaches engine-ready without manual intervention
- [ ] First frame streams end-to-end
- [ ] Install / run path contains spaces and/or non-ASCII characters (e.g. `C:\Users\Café\...`) — standalone's `uv sync` and `world_engine/` unpack still work

**Upgrade path** — install the new release on top of a previous version under the same user account:

- [ ] Existing settings load; no reset prompt and no lost fields
- [ ] Previously-downloaded models in the HF cache are reused (no surprise re-download)
- [ ] `.uv/` cache is reused where possible; `uv sync` only re-runs for genuinely changed deps

**Unsupported systems** — on macOS, a non-NVIDIA Linux/Windows host, or a host without a working CUDA driver:

- [ ] The app opens and surfaces a localised, actionable error (no silent hang, no unhandled exception dialog)
- [ ] UI remains responsive; settings can still be opened and exited

**Engine error surfaces** — force server-originated `error` / `warning` push messages (easiest repro: set `engine_model` to a model that won't fit in VRAM to trigger CUDA OOM):

- [ ] Known errors (messages with `message_id`) render using the translated string, with any `{{message}}` detail interpolated
- [ ] Unknown errors (no `message_id`) show the raw `message` text rather than swallowing it
- [ ] After a recoverable error, the UI returns to a usable state without a full app restart

**Models** — each published Waypoint model (`Waypoint-1-Small`, `Waypoint-1.1-Small`, `Waypoint-1.5-1B`, `Waypoint-1.5-1B-360P`) should:

- [ ] Appear in the model picker (populated from the `Overworld/waypoint` HF collection)
- [ ] Download and load successfully on a cold cache
- [ ] Stream at least one frame before any prompt change
- [ ] `DEFAULT_WORLD_ENGINE_MODEL` (in `src/types/settings.ts` and `electron/ipc/models.ts`) points at the flagship model for this release

**Seed images** — test at least one seed from each of the five defaults in `DEFAULT_PINNED_SCENES`.

**Engine modes** — both must work:

- [ ] **Standalone**: cold start, warm restart, "Reinstall" rebuilds `world_engine/` and recovers
- [ ] **Server**: reachable `ws://` and `wss://` endpoints; invalid URL shows an error; unreachable URL does not freeze the UI
- [ ] **Server disconnect recovery**: kill the remote server mid-stream — client surfaces a localised error and reconnects cleanly once the server is back
- [ ] Toggling between modes mid-session stops the local server and reconnects cleanly

**Setting permutations** — toggle each **mid-stream** (not just at startup) to exercise state-machine transitions. Settings live in `src/types/settings.ts`:

- [ ] `engine_quant`: all of `none` / `fp8w8a8` / `intw8a8` — the first `intw8a8` run triggers a long optimisation pass (expected; must not hang the UI)
- [ ] `cap_inference_fps`: on and off
- [ ] `engine_model`: switch between a default model and a custom HF repo; try a private / non-existent repo (surface an error, do not crash)
- [ ] `locale`: `ja` or `zh` (non-Latin), `he` (RTL), `goose` (novelty locale still renders without crashing)
- [ ] `scene_authoring_enabled`: off by default — when off, the Scene Authoring UI and keybind are hidden; when on, both the edit-existing-scene and generate-from-prompt flows work end-to-end
- [ ] `scene_authoring_save_generated`: on and off — when on, generated scenes are saved to disk for replay
- [ ] `debug_overlays.*`: each of the four overlays individually, then all four at once

**Keybindings**

- [ ] Bind `resetScene` and `sceneEdit` to the same key — conflict warning appears
- [ ] Bind either to a movement / camera key — in-game input remains usable (or the conflict is surfaced)

**Long-session stability** — stream for ~10 minutes, with several prompt changes and at least one model switch. Each of these resets world state, but host resources should not accumulate across resets:

- [ ] Renderer and Python server memory usage stabilises rather than climbing across resets
- [ ] No stray child processes or dangling file handles linger after a model switch
- [ ] Frame generation times stay consistent from the start of the session to the end

**Settings robustness** — with the app closed, mutate the settings file on disk:

- [ ] Delete the file entirely — app boots with all defaults and no error dialog
- [ ] Remove individual fields — Zod defaults fill them in, other fields are preserved
- [ ] Write malformed JSON — app boots and falls back to defaults rather than refusing to start

## Running Offline

To reproduce issues tied to missing internet access — and to verify the **Offline Mode** toggle in General Settings — you don't need to unplug your machine. Use a network namespace.

```bash
bwrap --dev-bind / / --unshare-net npm run dev
```

- `--dev-bind / /` keeps the root filesystem visible.
- `--unshare-net` creates an isolated net namespace; bwrap sets up loopback automatically, so `ws://localhost:PORT/ws` (the World Engine WebSocket) still works.

**Before running**, do one full online run so the UV binary under `.uv/`, the Python `.venv`, and the HuggingFace model cache are populated.

## Architecture

Biome is an Electron desktop app that runs AI-generated worlds locally on GPU via a Python-based World Engine server.

### Process Model

There are two distinct "servers" in the architecture — don't confuse them:

1. **Electron main process** (`electron/`): The Node.js backend of the desktop app. Manages the window, settings, file system, and server process lifecycle. The renderer communicates with it over **Electron IPC**.
2. **World Engine server** (`server-components/`): A separate Python process that runs the AI model on GPU and streams frames. The renderer communicates with it over **WebSocket**.

The renderer (`src/`) talks to both: IPC for app operations (settings, window control, engine setup), WebSocket for real-time world streaming.

### Electron IPC (renderer ↔ main process)

Type-safe IPC contract defined in `src/types/ipc.ts`:

- `IpcCommandMap` — renderer→main commands (request/response via `invoke`)
- `IpcEventMap` — main→renderer events (broadcast via `on`)
- All channels use **kebab-case** (e.g. `read-settings`, `start-engine-server`)

Frontend uses typed wrappers in `src/bridge.ts`:

```typescript
const result = await invoke('read-settings')
const unsubscribe = listen('server-ready', callback)
```

IPC handlers are organized one file per domain in `electron/ipc/` (config, models, engine, server, seeds, backgrounds, window).

### WebSocket Protocol (renderer ↔ World Engine)

The renderer connects to the World Engine at `ws(s)://{host}/ws?protocol_version=N` where `N` is the renderer's `PROTOCOL_VERSION`. All messages are JSON with a `type` field. The protocol has two layers, both modelled as Pydantic discriminated unions in `server-components/server/protocol.py` and re-exported to TypeScript via codegen (see [Cross-language types](#cross-language-types) below).

#### Protocol version handshake

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

#### Server error messages

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

#### Cross-language types

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
| `T \| None = None`                              | `field: <T>.optional()` ⇒ `field?: T` (Pydantic's `exclude_none=True`)                     |
| `T = <default>` (non-Literal)                   | `field: <T>.optional()` ⇒ `field?: T`                                                      |
| `T` (no default)                                | `field: <T>` ⇒ `field: T` (required)                                                       |
| `Literal["x"]`                                  | `z.literal('x')` ⇒ `'x'` (discriminators stay required even with a default)                |

Any `# pyright:` ignore comments inside `protocol.py` shouldn't be needed — the protocol module is pure types and basedpyright is clean there. The script's own per-rule rationale and the rename map (`StageId` → `ServerStageId` for the Python set, leaving the broader `StageId` alias for the renderer; `RpcError` / `RpcSuccess` → `*Response` to dodge a JS Error name) live in `scripts/codegen_ts.py`.

**Receive-path validation.** `useWebSocket.ts` runs `ServerMessageSchema.safeParse` on every incoming JSON message and `FrameHeaderSchema.safeParse` on every binary frame header. Push messages get full payload validation via the discriminated union; RPC responses validate the envelope (`type` / `req_id` / `success` / `error_id` / `error`) but leave `data` as `z.unknown()` — the request map binds the data shape at the call site. A failed validation logs the Zod error message and the raw payload, then drops the message rather than feeding garbage to the consumer.

**Drift gates.** `src/i18n/index.ts` carries compile-time assertions that fail if the protocol and the i18n keys diverge:

- Every `MessageId` value (server-emitted) must have a translation under `app.server.{error,warning}.*`, **and** every translation key under those subtrees must correspond to a `MessageId`. The check is bidirectional — orphan keys on either side fail tsc.
- Every `StageId` value (server `ServerStageId` plus installer-only `InstallerStageId` defined in `src/stages.ts`) must have a translation under `stage.*`, and vice versa.
- `src/stages.ts` exports `STAGE_PERCENTS: Record<StageId, number>` — the `Record<>` type forces tsc to flag any new stage that doesn't have a percent.
- `lint-backend` CI step runs `codegen_ts.py --check` after basedpyright; PRs that change `protocol.py` without regenerating the TS will fail.

**Adding a new `MessageId`:**

1. Add the enum member in `protocol.py` with the full `app.server.{error,warning}.<key>` value.
2. Run the codegen.
3. Add a translation for the new key to **every** locale under `src/i18n/` — `tsc` will tell you which ones you missed.

**Adding a new `StageId`:**

1. Add the enum member in `protocol.py`.
2. Run the codegen.
3. Add the percent in `STAGE_PERCENTS` in `src/stages.ts` and the translation under `stage.*` in every locale.

**Adding a new message / RPC type:**

1. Define the Pydantic model in `protocol.py`. If it's a discriminated union member, add it to the `ClientMessage` / `ServerPushMessage` union. If it's an RPC, name the request `*Request` and the response payload `*ResponseData` so the codegen picks them up as a pair into `RpcRequestMap`.
2. Run the codegen.
3. Wire the typed shape into the relevant TS consumer. RPC sends use `request('discriminator', params)` — the request map infers both the params shape and the response type. Notifs send via the typed `sendNotif(notif)` helper in `useWebSocket.ts`.

**Renaming the Python class.** Most `*Request` / `*Response` / `*Message` / `*Notif` names from the Python side ship verbatim to TS. The exceptions live in `_TS_RENAMES` at the top of the codegen script — keep that list short and justified.

### State Management

React Context + hooks, no external state library:

- **SettingsProvider** (`src/hooks/useSettings.tsx`): User settings persistence
- **PortalContext** (`src/context/PortalContext.tsx`): App state machine (MAIN_MENU, LOADING, STREAMING, etc.)
- **StreamingContext** (`src/context/StreamingContext.tsx`): WebSocket connection and streaming lifecycle
- **VortexContext** (`src/context/VortexContext.tsx`): Loading animation renderer

State machines in `src/context/portalStateMachine.ts` and `src/context/streamingLifecycleMachine.ts`.

### Engine Modes: Standalone vs Server

Biome supports two engine modes (`engine_mode` in settings, type `EngineMode`), toggled in the settings UI. **Standalone is the default.**

**Standalone** (`'standalone'`): Biome manages a local Python server process. Setup and launch are handled by the Electron main process (`electron/ipc/engine.ts` and `electron/ipc/server.ts`):

1. **Unpack server components**: Bundled Python files (`pyproject.toml`, `main.py`, the `server/`, `engine/`, `recording/`, and `util/` packages, etc.) are copied from the app's `server-components` resource into a `world_engine/` directory next to the executable.
2. **Install UV**: The [uv](https://github.com/astral-sh/uv) package manager binary is downloaded from GitHub releases into `.uv/bin/`. All UV state (cache, Python installs, tool dirs) is kept under `.uv/` via env vars (`UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`, etc.) so nothing touches the system Python.
3. **Sync dependencies**: `uv sync` is run in `world_engine/`, which reads `pyproject.toml`, downloads a managed Python interpreter, creates an isolated `.venv`, and installs all packages.
4. **Start server**: The server is spawned via `uv run python -u main.py --port {port}` in the `world_engine/` directory. It auto-assigns a port starting from 7987, polls `/health` until the server responds, then connects via `ws://localhost:{port}/ws`.

Process lifecycle is managed by `electron/lib/serverState.ts`. The UI shows engine health status and a "Reinstall" button (`WorldEngineSection`).

**Server** (`'server'`): Biome connects to a pre-existing remote server.

- Uses the user-configured `server_url` setting
- No local process spawning — derives WebSocket URL from `server_url`
- Supports secure transport (`wss://`) when the URL uses HTTPS
- UI shows a "Server URL" text input instead of engine status

Connection flow for both modes is in `src/context/streamingWarmConnection.ts` (`runWarmConnectionFlow`). Mode switching during an active session triggers teardown-and-reconnect in `StreamingContext.tsx` — if switching away from standalone, the local server is stopped.

Communication with the server (in either mode) uses WebSocket RPC (`src/lib/wsRpc.ts`).

### Build System

Electron Forge with Vite plugin. Three separate Vite configs and tsconfigs:

- **Main** (`vite.main.config.ts` / `tsconfig.main.json`): Node target
- **Preload** (`vite.preload.config.ts` / `tsconfig.preload.json`): Node + DOM
- **Renderer** (`vite.renderer.config.ts` / `tsconfig.json`): DOM target, React + Tailwind

`forge.config.ts` bundles `server-components` and `seeds` as extra resources.

**Local builds**: `npm run build` copies `server-components/` and other extra resource directories verbatim into the installer. Make sure your workspace is clean before building — any untracked files (`.venv`, `__pycache__`, `server.log`, etc.) will be included and can bloat the installer by gigabytes. Production releases should be cut via CI from a clean checkout.

`server-components/uv.lock` **is** tracked and ships in the installer — it's the canonical lockfile (universal across the Linux/x86_64 + Windows/AMD64 environments declared in `[tool.uv].environments`) and the standalone-mode mirror copies it into `world_engine/` alongside `pyproject.toml`. Without it, `uv sync` on a user's machine has to resolve from PyPI and can drift between users. Whenever you change `server-components/pyproject.toml`, regenerate the lockfile with `cd server-components && uv lock` and commit both files together; CI runs `uv lock --check` to catch drift.

**Linux AppImage builds**: The default AppImage produced by `@reforged/maker-appimage` is a thin wrapper — it relies on the host system having GTK3, X11, NSS, a C toolchain (for Triton's runtime CUDA JIT), and a correctly-configured OpenSSL. In practice, this fails on many distros: OpenSuSE Tumbleweed crashes on OpenSSL config ([#92](https://github.com/Overworldai/Biome/issues/92)), NixOS has none of these at standard FHS paths, and most desktop Linux installs don't ship `gcc`. Our post-processing pipeline turns the bare AppImage into a self-contained bundle that works across distributions.

On Linux, `npm run build` produces an AppImage that is then post-processed by `scripts/appimage-post-make.mjs` (called automatically via Forge's `postMake` hook). The pipeline:

1. **Fetches build tools** (`scripts/appimage-prepare-assets.mjs`, run via Forge `generateAssets` hook): downloads pinned versions of [linuxdeploy](https://github.com/linuxdeploy/linuxdeploy), linuxdeploy-plugin-gtk, [appimagetool](https://github.com/AppImage/appimagetool), and the [Zig](https://ziglang.org/) toolchain into `build/appimage/.cache/` and `build/appimage/toolchain/`. Idempotent; skips assets already present. SHA256 hashes are pinned in the script — CI refuses to proceed without them.
2. **Bundles GTK/X11 deps**: linuxdeploy + plugin-gtk walk the Electron binary's ELF dependencies and copy ~130 shared libraries into the AppDir, with rpath patching.
3. **Bundles transitive closure**: a second pass uses `ldd` to find libs that linuxdeploy's excludelist skipped (libX11, libxcb, libz, etc.) and copies them too. This ensures the AppImage works on distros with non-FHS layouts (NixOS, Alpine).
4. **Bundles NSS plugins**: `libsoftokn3.so` and friends are dlopen'd by Chromium at runtime — invisible to `ldd` — so they're copied explicitly.
5. **Installs Zig toolchain**: Zig is copied into `AppDir/toolchain/` with `cc`/`gcc`/`clang` shim symlinks. Triton JIT-compiles CUDA launcher stubs at runtime with `cc`; most user systems don't have a C toolchain installed, so the AppImage ships one. The shim rewrites `-l:libfoo.so.N` → `-lfoo` to work around zig's lld not supporting the GNU `-l:` extension.
6. **Installs AppRun wrapper** (`build/appimage/AppRun`): replaces the default symlink with a shell script that sets `LD_LIBRARY_PATH` for bundled libs, `OPENSSL_CONF=/dev/null` (see [Overworldai/Biome#92](https://github.com/Overworldai/Biome/issues/92)), detects the host's `libcuda.so` path, exposes the Zig toolchain on `$PATH`, sources linuxdeploy-plugin-gtk hooks, and execs the Electron binary.
7. **Fixes up .desktop entry**: injects `Categories=Game;` and `Icon=biome` (appimagetool requires both).
8. **Re-squashes** the modified AppDir with appimagetool.

Build-time apt dependencies are listed in `build/appimage/apt-deps.txt`, installed via `build/appimage/setup-build-env.sh` — a single script that sets up the entire Linux build environment (Node.js 20 via NodeSource + apt deps). Both CI and the Docker build image (`build/appimage/Dockerfile`) run this same script, so there's exactly one definition of what the Linux build needs.

**Building the AppImage locally** (requires Docker):

```bash
./scripts/appimage-docker-build.sh           # Build inside an ubuntu-22.04 container
./scripts/appimage-docker-build.sh --rebuild # Force image rebuild (e.g. after changing apt-deps.txt)
```

Output: `out/make/AppImage/x64/Biome-<version>-x64.AppImage`.

**Testing the AppImage** (requires Docker + NVIDIA GPU):

```bash
./scripts/appimage-docker-desktop.sh                  # Ubuntu 24.04 (default)
./scripts/appimage-docker-desktop.sh --distro fedora  # Fedora 41
./scripts/appimage-docker-desktop.sh --distro arch    # Arch Linux
./scripts/appimage-docker-desktop.sh --no-gpu         # Skip GPU passthrough
./scripts/appimage-docker-desktop.sh --rebuild        # Force image rebuild
```

Opens a Wayland desktop (sway + wayvnc + noVNC) at http://localhost:6080/. The AppImage runs in a real Wayland session so Electron uses Ozone-Wayland, matching the default display server on modern Ubuntu/Fedora. Inside the terminal, type `biome` to launch. Logs are written to `out/appimage-test-out/biome.log` on the host. GPU is passed through via CDI on NixOS (`hardware.nvidia-container-toolkit.enable = true`) or via the legacy nvidia runtime on other distros. Bazzite is Fedora-based, so `--distro fedora` covers it.

**Updating pinned tool versions**: null out the SHA256 constant in `scripts/appimage-prepare-assets.mjs`, re-run the script (it logs the new hash), paste it back. CI enforces all hashes are pinned.

**NixOS note**: the AppImage requires `appimage-run` for direct launch on NixOS due to Chromium's DBus init crashing outside a FHS environment. The Docker-based test script avoids this by running inside a real Ubuntu desktop.

## Code Style

Prettier with: no semicolons, single quotes, arrow parens always, 120 char width. Configured in `.prettierrc`.

## CSS & Styling

- **Container query units**: All sizing uses `cqh` (preferred) and `cqw`. The app shell has `container-type: size`, so at the same aspect ratio the same content is visible regardless of window size.
- **Design tokens**: Defined in the `@theme` block in `src/css/app.css` — colors, fonts, spacing, radii, and text sizes (all in `cqh`). Runtime JS↔CSS bridge via `:root` custom properties.
- **Tailwind-first**: Prefer Tailwind classes (including arbitrary values like `text-[2.67cqh]`) over new CSS rules. New CSS should only be added for things Tailwind can't express (pseudo-elements, complex animations, `clip-path`). See `@layer components` in `app.css` for existing examples.
- **Shared styles**: `src/styles.ts` exports reusable Tailwind class constants (e.g. `SETTINGS_CONTROL_BASE`, `HEADING_BASE`). `src/transitions.ts` exports Framer Motion variants. Extract shared Tailwind strings into constants and create components for duplicated UI patterns.
- **No rounded corners**: Avoid `rounded-*` classes on UI elements. The design language uses sharp edges throughout. The only exception is functional rounding (e.g. `rounded-full` for circular spinners).
- **Animations**: `src/css/animations.css` for `@keyframes`, `src/css/video-mask.css` for the CRT shutdown effect. Applied via conditional CSS classes.

## Localisation

Translations live in `src/i18n/` as TypeScript constant files (`en.ts`, `ja.ts`, `zh.ts`). The i18next module augmentation in `src/i18n/i18next.d.ts` enables **compile-time enforcement** of translation keys — passing an invalid key to `t()` or to any component that accepts a `TranslationKey` is a type error.

### Translation key type

`TranslationKey` (exported from `src/i18n/index.ts`) is the union of all valid dot-separated translation paths (e.g. `'app.buttons.close'`). Use it in component props wherever the value should be a translation key.

### Translated vs Raw components

UI components **prefer translation keys by default**. Components that accept user-visible text have two variants:

| Translated (default)                       | Raw (escape hatch)                          | When to use Raw                       |
| ------------------------------------------ | ------------------------------------------- | ------------------------------------- |
| `Button` (`label: TranslationKey`)         | `RawButton` (`children: ReactNode`)         | Icons, mixed content, dynamic strings |
| `MenuButton` (`label: TranslationKey`)     | `RawMenuButton` (`children: ReactNode`)     | Same                                  |
| `SettingsButton` (`label: TranslationKey`) | `RawSettingsButton` (`children: ReactNode`) | Same                                  |

Other components use prop-level `raw` prefixes for escape hatches:

| Component               | Translated prop                                                         | Raw escape hatch                      |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `SettingsSection`       | `description: TranslationKey`                                           | `rawDescription: ReactNode`           |
| `SettingsSelect` option | `label: TranslationKey`                                                 | `rawLabel: string`                    |
| `SettingsSelect`        | `customLabel`, `deleteLabel`: `TranslationKey`                          | `rawCustomPrefix: string`             |
| `ConfirmModal`          | `title`, `description`, `confirmLabel`, `cancelLabel`: `TranslationKey` | `descriptionParams` for interpolation |
| `Modal`                 | `title: TranslationKey`                                                 | —                                     |
| `SettingsCheckbox`      | `label: TranslationKey`                                                 | —                                     |
| `SettingsSlider`        | `label: TranslationKey`                                                 | —                                     |
| `SettingsTextInput`     | `placeholder: TranslationKey`                                           | —                                     |
| `SettingsToggle`        | `options[].label: TranslationKey`                                       | —                                     |
| `ServerLogDisplay`      | `title`, `exportActionLabel`: `TranslationKey`                          | —                                     |

**Prefer the translated variant.** Only reach for `Raw*` components or `raw*` props when the content genuinely cannot be a single translation key (e.g. SVG icons as button content, dynamically constructed strings, model names from an API).

### Casing conventions (English)

- **Section titles, button labels, toggle/switch labels, and other discrete UI controls**: Title Case (e.g. `'Save Generated Scenes'`, `'Enable Scene Authoring'`, `'Record Gameplay'`).
- **Settings section descriptions**: phrase as a **lower-case question addressed to the user**, not a statement or label (e.g. `'want to compose and modify scenes with text prompts?'`, `'how loud should things be?'`). The tone is conversational — the title names the thing, the description asks what the user wants to do with it.
- **Other helper/hint text and full sentences**: sentence case with normal punctuation.
- Other locales follow their own language's conventions — only the English-style locales (`en`, `goose`) need Title Case.

### Adding new translation keys

1. Add the key to `src/i18n/en.ts` (the source of truth for key structure)
2. Add corresponding translations to every other locale file (`ja.ts`, `zh.ts`, etc.)
3. Use the key in components — TypeScript will verify it exists
4. If you forget a locale, `tsc` will report a "Property '...' is missing" error (enforced by `KeyShape` in `resources.ts`)

### Adding a new language

`LOCALE_DISPLAY_NAMES` in `src/i18n/locales.ts` is the canonical locale registry — everything else (`SupportedLocale`, `SUPPORTED_LOCALES`, `LOCALE_OPTIONS`, `AppLocale`) is derived from it.

1. Create `src/i18n/{code}.ts` with the same key structure as `en.ts`, then import it in `src/i18n/resources.ts` and add it to the `resources` object.
2. Add an entry to `LOCALE_DISPLAY_NAMES` in `src/i18n/locales.ts` mapping the code to its native-script name. Insert new locales **before** `goose` — `goose` is a novelty/Easter-egg locale and should always be last in the picker.

`resources` is typed `Record<SupportedLocale, ExpectedShape>`, so `tsc` will flag step 2 if step 1 is missed (and vice versa).

Language display names (e.g. "English", "日本語", "中文") are **not** translation keys — they always appear in their native script regardless of the current locale. Only the "System Default" option is translated.

**Dev shortcut**: in dev builds (`npm run dev`), press `Ctrl+L` to cycle through `SUPPORTED_LOCALES` — useful for eyeballing translations without opening Settings. The choice is persisted to the settings file.

### Error handling and `TranslatableError`

All user-visible errors should be localised. `TranslatableError` (exported from `src/i18n/index.ts`) is an `Error` subclass that carries a `translationKey` and `translationParams`:

```typescript
import { TranslatableError } from '../i18n'

throw new TranslatableError('app.server.notResponding', { url: 'http://localhost:7987' })
```

`TranslatableError.message` is eagerly resolved at construction time via `i18n.t()`, so existing `err.message` catch sites get localised text automatically. Consumers with access to `t()` can re-resolve `translationKey` + `translationParams` for the freshest locale.

**Rules:**

- **Never throw raw English strings** for user-visible errors. Use `TranslatableError` with a translation key.
- **Never lose information.** When wrapping an unknown error, preserve the original message:
  ```typescript
  const message = err instanceof Error ? err.message : String(err)
  new TranslatableError('app.server.fallbackError', { message })
  ```
- **Use `TranslatableError` as the state type**, not `string`. Error state should be `TranslatableError | null`, never `string | TranslatableError | null`.
- **Resolve at the display boundary.** Components that display errors call `t(err.translationKey, { defaultValue: err.translationKey, ...err.translationParams })`. Intermediate layers pass `TranslatableError` through without resolving.
- **Server-originated errors** use `message_id` / `error_id` in the WebSocket protocol (see [Server error messages](#server-error-messages)). The client maps these to `RpcError` (for RPC responses) or resolves them directly in `useWebSocket.ts` (for push messages).

## Key Conventions

- Shared utilities in `electron/lib/` (paths, serverState, uv, platform, seeds)
- Custom canvas renderers in `src/lib/` (portalSparksRenderer, vortexRenderer)
