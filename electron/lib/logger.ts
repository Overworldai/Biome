import type { LogRecord } from '../../src/types/ipc.js'
import { emitToAllWindows } from './ipcUtils.js'

/** Electron-side structured logger.  Mirrors the Python server's
 *  `util/server_logging.py` setup so a developer reading either side's
 *  output sees the same shape:
 *
 *    text mode (TTY):  `12:34:56 [info     ] Loading uv         [engine.setup] version=0.10.9`
 *    JSON mode:        `{"event":"Loading uv","level":"info","logger":"engine.setup","timestamp":"12:34:56","version":"0.10.9"}`
 *
 *  Format is picked once at module load by `resolveLogFormat()`:
 *    - `BIOME_LOG_FORMAT=text|json` is the explicit override.
 *    - Otherwise: text when stdout is a TTY (a developer running
 *      `npm run dev`), JSON when it isn't (CI, packaged binary spawned
 *      with stdio piped, etc.).
 *
 *  Logger names are how the renderer (and the diagnostic export)
 *  distinguishes Python from Electron without a prefix glued onto the
 *  message — `engine.manager` / `server.routes` come from Python,
 *  `engine.setup` / `electron.main` from this side.  Authors never write
 *  `[ENGINE]`-style prefixes; the renderer / formatter renders the
 *  logger pill from the typed `logger` field.
 *
 *  When `broadcast: true` is passed (or set as the logger's default),
 *  the same call also `emitToAllWindows('engine-log', record)` so the
 *  renderer's log buffer and the diagnostic export pick it up alongside
 *  Python events. */

type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export type LogOpts = {
  /** Bound key=value pairs to attach to this event. */
  fields?: Record<string, string | number | boolean>
  /** Pre-formatted exception traceback when the source has one. */
  exception?: string
  /** Mirror this record onto the `engine-log` IPC channel so the
   *  renderer sees it.  Defaults to whatever was passed to `getLogger`. */
  broadcast?: boolean
}

export type Logger = {
  debug(event: string, opts?: LogOpts): void
  info(event: string, opts?: LogOpts): void
  warning(event: string, opts?: LogOpts): void
  error(event: string, opts?: LogOpts): void
}

type LogFormat = 'text' | 'json'

function resolveLogFormat(): LogFormat {
  const override = (process.env.BIOME_LOG_FORMAT ?? '').trim().toLowerCase()
  if (override === 'text') return 'text'
  if (override === 'json') return 'json'
  return process.stdout.isTTY ? 'text' : 'json'
}

const LOG_FORMAT: LogFormat = resolveLogFormat()

function nowTimestamp(): string {
  // HH:MM:SS, matching structlog's TimeStamper(fmt="%H:%M:%S").
  return new Date().toTimeString().slice(0, 8)
}

/** Pad/truncate a level to a fixed width so text-mode lines align,
 *  matching `ConsoleRenderer`'s `[info     ]` / `[warning  ]` boxes. */
function padLevel(level: LogLevel): string {
  return level.padEnd(8)
}

function renderTextLine(record: LogRecord): string {
  // Layout: `HH:MM:SS [level   ] [logger] event k1=v1 k2=v2` — fixed
  // `[level] [logger]` prefix block keeps each line scannable while the
  // event sits at a variable column.  Exceptions go on a following line.
  const parts: string[] = []
  if (record.timestamp) parts.push(record.timestamp)
  if (record.level) parts.push(`[${padLevel(record.level as LogLevel)}]`)
  if (record.logger) parts.push(`[${record.logger}]`)
  parts.push(record.event)
  if (record.fields) {
    for (const [k, v] of Object.entries(record.fields)) parts.push(`${k}=${String(v)}`)
  }
  let line = parts.join(' ')
  if (record.exception) line += `\n${record.exception}`
  return line
}

/** Rolling buffer of `LogRecord`s produced on the Electron side.
 *  Pulled on demand by the `get-electron-log-tail` IPC for diagnostic
 *  exports.  Independent of the `engine-log` IPC broadcast (which is
 *  the user-curated subset that shows in the renderer's on-screen log
 *  panel), so internal-debug events like `engine.diagnostics:
 *  check-engine-status: validating uv binary` end up here too.
 *
 *  Populated by:
 *  - `emit` (every `getLogger(...).<level>(...)` call), and
 *  - the uv-sync subprocess pass-through in `engine/ipc/engine.ts`,
 *    whose output exists nowhere else.
 *
 *  *Not* populated by the Python-server subprocess pass-through —
 *  Python's structlog already broadcasts each event over the WS
 *  (→ `wsAllLogs` → diagnostic `server_logs`) and `read_log_tail_records`
 *  replays the file tail on connect, so recording subprocess lines
 *  here would just duplicate the WS-sourced records. */
const RECENT_LOGS_MAX = 2000
const _recentLogs: LogRecord[] = []

/** Append a record to the rolling buffer, dropping the oldest entry
 *  once the cap is hit so the buffer stays bounded across long
 *  sessions.  Called from `emit` automatically; the uv-sync line
 *  stream calls it explicitly. */
export function recordElectronLog(record: LogRecord): void {
  _recentLogs.push(record)
  if (_recentLogs.length > RECENT_LOGS_MAX) _recentLogs.shift()
}

/** Snapshot of the current rolling buffer.  Returns a copy so the
 *  caller can iterate safely while new events keep coming in. */
export function getRecentElectronLogs(): LogRecord[] {
  return [..._recentLogs]
}

function emit(record: LogRecord, broadcast: boolean): void {
  recordElectronLog(record)
  const line = LOG_FORMAT === 'json' ? JSON.stringify(record) : renderTextLine(record)
  // stderr for warning+error so process supervisors see severity correctly;
  // stdout for info/debug.
  if (record.level === 'error' || record.level === 'warning') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
  if (broadcast) emitToAllWindows('engine-log', record)
}

function buildRecord(name: string, level: LogLevel, event: string, opts: LogOpts | undefined): LogRecord {
  const record: LogRecord = {
    event,
    level,
    logger: name,
    timestamp: nowTimestamp()
  }
  if (opts?.fields && Object.keys(opts.fields).length > 0) record.fields = opts.fields
  if (opts?.exception) record.exception = opts.exception
  return record
}

/** Get a logger bound to `name`.  By convention, names are dotted paths
 *  scoped per concern: `engine.setup` / `engine.uv-sync` / `engine.server`
 *  for engine-side concerns, `electron.<area>` for app-shell concerns
 *  (`electron.main`, `electron.config`, `electron.seeds`, …).  Pass
 *  `defaultBroadcast: true` for loggers that always want to surface in
 *  the renderer's log buffer (engine setup phases, server lifecycle). */
export function getLogger(name: string, opts?: { defaultBroadcast?: boolean }): Logger {
  const defaultBroadcast = opts?.defaultBroadcast ?? false
  const log = (level: LogLevel, event: string, callOpts: LogOpts | undefined) => {
    const record = buildRecord(name, level, event, callOpts)
    emit(record, callOpts?.broadcast ?? defaultBroadcast)
  }
  return {
    debug: (event, callOpts) => log('debug', event, callOpts),
    info: (event, callOpts) => log('info', event, callOpts),
    warning: (event, callOpts) => log('warning', event, callOpts),
    error: (event, callOpts) => log('error', event, callOpts)
  }
}
