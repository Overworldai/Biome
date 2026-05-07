# Logging

Both sides of Biome (the Python server and the Electron main process) emit the same structured `LogRecord` shape: `{event, level, logger, timestamp, fields?, exception?}`. The `logger` field is how the Python ↔ Electron distinction is made — `engine.manager` / `server.routes` come from Python, `engine.setup` / `electron.main` come from Electron — so message text never carries `[ENGINE]` / `[SERVER]` / `[UV]`-style prefixes on either side. The renderer (`ServerLogDisplay` in `src/components/`) renders the same `LogLine` for every record, with the logger pill providing the visual attribution.

## Python (structlog)

Server-side logs go through `structlog` (configured once in `util/server_logging.py`). Get a logger with `log = structlog.stdlib.get_logger(__name__)` at the top of each module — the module name is the scope, and an event renders as:

```
12:34:56 [info    ] [engine.manager] Loading model client_host=127.0.0.1 model=waypoint-1.5 current_step=1 total_steps=3
```

- **Pass dynamic data as kwargs, not f-strings.** `logger.info("Loading seed", filename=name)` over `logger.info(f"Loading seed {name}")`. The renderer prints them as `key=value`; the WS broadcast and diagnostics export keep them as a structured `dict`.
- **Per-connection scope.** The WS endpoint wraps each session in `structlog.contextvars.bound_contextvars(client_host=...)` so every event under that connection auto-tags `client_host`. Asyncio tasks inherit the contextvars; the generator thread is wired explicitly via `contextvars.copy_context()` (see `server/session/workers.run_generator`).
- **Sub-operation scope.** Inside a routine that owns a multi-step operation, bind once with `log = logger.bind(operation="reset")` and re-use `log` for the rest of that scope. Use `current_step=N, total_steps=TOTAL` (with `TOTAL` as a module-level constant — see `LOAD_ENGINE_TOTAL_STEPS` / `WARMUP_TOTAL_STEPS` in `engine/manager.py`) rather than `[1/3]` in the message text.
- **No bracketed prefixes** (`[ENGINE]`, `[RECV]`, `[GENERATE_SCENE]`, …). The logger name and bound contextvars already carry scope; if the current scope isn't enough, bind another contextvar or `operation` rather than re-introducing prefixes.
- **Broadcast and file mirroring are split.** `LogBroadcast` is fed by a structlog processor and fans each event out as a typed `LogMessage` (`event` + `level` + `logger` + `timestamp` + `exception` + `fields`) to every connected WS client. `TeeStream` only mirrors stdout/stderr into `server.log`. The WS broadcast always carries the structured form regardless of the local renderer.

## Electron (`getLogger`)

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

## stdout / `server.log` / Electron-stdout format — text vs JSON

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

## Renderer-side rendering

`ServerLogDisplay`'s `LogLine` renders each `LogRecord` (Python WS log push or Electron `engine-log` IPC) with the same visual hierarchy as the text-mode formatters: timestamp / level / logger pill / event / fields / exception. Plain-text export goes through `formatLogRecordPlainText` (same file) so on-screen and clipboard strings stay aligned.

## Logging exceptions

Prefer `logger.exception("...")` over `logger.error("...", exc_info=True)` — ruff's `TRY400` enforces this so the traceback always logs. The exception is a status notice where the traceback is noise: timeouts, recovery success/failure messages, an `error()` immediately followed by `raise CustomError() from e`. Suppress per-line with `# noqa: TRY400  -- <reason>` and keep `.error(...)`.
