import type { LogRecord } from '../../src/types/ipc.js'

/** Reserved keys on a structlog JSON event_dict that map to dedicated
 *  `LogRecord` slots.  Everything else is bagged under `fields`. */
const RESERVED_KEYS: ReadonlySet<string> = new Set(['event', 'level', 'logger', 'timestamp', 'exception', 'exc_info'])

/** Project a single subprocess stdout/stderr line onto a `LogRecord`.
 *  The server emits one structlog event per line (JSON in non-TTY mode),
 *  but the same stream also carries:
 *    - uv sync chatter (`Downloading llama-cpp-python (377.0MiB)`)
 *    - pre-structlog interpreter output (early import errors)
 *    - synthetic markers emitted by the main process itself
 *  None of those are JSON, so any parse failure (or any JSON value that
 *  doesn't look like a structlog event) falls back to a record carrying
 *  the raw line on `event` and a derived `level`. The optional
 *  `fallbackLogger` attributes those fallback records to a logical
 *  source — `engine.setup`, `engine.uv-sync`, `engine.server` — so the
 *  renderer can render a logger pill on every record uniformly, the
 *  same way structlog-emitted lines already carry their own logger
 *  name. JSON-derived records keep whatever logger was on the wire. */
export function parseLogLine(line: string, isStderr: boolean, fallbackLogger?: string): LogRecord {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'event' in parsed) {
        return projectStructlogEvent(parsed as Record<string, unknown>, isStderr)
      }
    } catch {
      // fall through to the text-only fallback
    }
  }
  const record: LogRecord = { event: line, level: isStderr ? 'error' : 'info' }
  if (fallbackLogger) record.logger = fallbackLogger
  return record
}

function projectStructlogEvent(obj: Record<string, unknown>, isStderr: boolean): LogRecord {
  const fields: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (RESERVED_KEYS.has(k)) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      fields[k] = v
    } else if (v != null) {
      fields[k] = String(v)
    }
  }

  const record: LogRecord = {
    event: typeof obj.event === 'string' ? obj.event : String(obj.event ?? ''),
    level: typeof obj.level === 'string' ? obj.level : isStderr ? 'error' : 'info'
  }
  if (typeof obj.logger === 'string') record.logger = obj.logger
  if (typeof obj.timestamp === 'string') record.timestamp = obj.timestamp
  if (typeof obj.exception === 'string') record.exception = obj.exception
  if (Object.keys(fields).length > 0) record.fields = fields
  return record
}
