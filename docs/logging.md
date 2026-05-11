# Logging

Both sides of Biome (the Python server and the Electron main process) emit the same structured `LogRecord` shape: `{event, level, logger, timestamp, fields?, exception?}`. The `logger` field carries scope (e.g. `engine.manager` from Python, `engine.setup` from Electron), so message text never carries `[ENGINE]` / `[SERVER]`-style prefixes. The renderer (`ServerLogDisplay`) renders the same `LogLine` for every record, with the logger pill providing visual attribution.

## Python (structlog)

Configured once in `util/server_logging.py`. At the top of each module:

```python
import structlog

log = structlog.stdlib.get_logger(__name__)
```

The module name is the scope, and an event renders as:

```
12:34:56 [info    ] [engine.manager] Loading model client_host=127.0.0.1 model=waypoint-1.5 current_step=1 total_steps=3
```

- **Pass dynamic data as kwargs, not f-strings.** `logger.info("Loading seed", filename=name)` over `logger.info(f"Loading seed {name}")`. The renderer prints `key=value`; the WS broadcast and diagnostics export keep them structured.
- **Per-connection scope.** The WS endpoint wraps each session in `structlog.contextvars.bound_contextvars(client_host=...)` so every event under that connection auto-tags `client_host`. Asyncio tasks inherit contextvars; the generator thread is wired explicitly via `contextvars.copy_context()` (see `server/session/workers.run_generator`).
- **Sub-operation scope.** Inside a routine that owns a multi-step operation, bind once with `log = logger.bind(operation="reset")` and re-use `log` for the rest of the scope. Use `current_step=N, total_steps=TOTAL` (TOTAL as a module-level constant, e.g. `LOAD_ENGINE_TOTAL_STEPS` in `engine/manager.py`) rather than `[1/3]` in the message text.
- **No bracketed prefixes** (`[ENGINE]`, `[RECV]`, …). The logger name and bound contextvars already carry scope.
- **Broadcast vs file mirroring are split.** `LogBroadcast` (a structlog processor) fans each event out as a typed `LogMessage` to every connected WS client. `TeeStream` only mirrors stdout/stderr into `server.log`. The WS broadcast always carries the structured form regardless of the local renderer.

## Electron (`getLogger`)

Hand-rolled mirror of structlog at `electron/lib/logger.ts`:

```ts
import { getLogger } from '../lib/logger.js'

const log = getLogger('engine.setup', { defaultBroadcast: true })
log.info('Setting up server components')
log.info('Removed engine directory', { fields: { path: engineDir } })
log.error('Setup failed', { exception: err.stack })
```

- **One logger per module / concern.** Dotted paths matching Python's convention — `electron.main` for app lifecycle, `engine.setup` for installer code, etc. Grep `getLogger(` for the established set.
- **`defaultBroadcast: true`** for loggers whose every event should also reach the renderer's log buffer (engine setup phases, server lifecycle). Per-call `broadcast: true | false` overrides the default. Diagnostic spam (e.g. `engine.diagnostics`) defaults off.
- **Pass dynamic data as `fields`, not template strings.** Same rationale as Python kwargs.
- **Subprocess pass-through is a separate path.** Lines from the Python server's stdout / `uv sync`'s stdout don't go through `getLogger` — they ride through `parseLogLine` (`electron/lib/logRecord.ts`), which JSON-parses each line if possible and falls back to `{ event: line }`, with a `fallbackLogger` (`engine.server` / `engine.uv-sync`) so unparseable lines still get attributed. The raw line is also forwarded to Electron's stdout/stderr unchanged.

## Format — text vs JSON

Both sides use the same TTY heuristic and override env var (`BIOME_LOG_FORMAT=text|json`):

| `BIOME_LOG_FORMAT` | TTY?    | Format chosen                                       |
| ------------------ | ------- | --------------------------------------------------- |
| `text`             | (any)   | One human-readable line per event                   |
| `json`             | (any)   | JSON-Lines (one JSON object per line)               |
| _unset_            | TTY     | text (developer running `npm run dev`)              |
| _unset_            | non-TTY | JSON (CI, packaged binary spawned with piped stdio) |

Resolved by `_resolve_log_format()` (Python, `util/server_logging.py`) and `resolveLogFormat()` (TS, `electron/lib/logger.ts`). In JSON mode, `read_log_tail_records` parses each replayed `server.log` line back into a `LogMessage` so the WS log replay carries the same fidelity as live events; in text mode each line replays as `LogMessage(event=line)` (degraded — only matters across server restarts).

`ServerLogDisplay`'s `LogLine` (`src/components/`) renders each `LogRecord` with the same hierarchy as the text-mode formatters; `formatLogRecordPlainText` keeps clipboard export aligned.

## Logging exceptions

Prefer `logger.exception("...")` over `logger.error("...", exc_info=True)` — ruff's `TRY400` enforces this so the traceback always logs. Use `error()` instead only when the traceback is noise: timeouts, recovery success/failure messages, an `error()` immediately followed by `raise CustomError() from e`. Suppress per-line with `# noqa: TRY400  -- <reason>`.
