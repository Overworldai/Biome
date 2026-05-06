"""
Server logging infrastructure.

Sets up TeeStream (stdout/stderr mirroring to file + WebSocket broadcast),
configures the Python logging system, and installs crash hooks. Imported
at the very top of main.py before any heavy imports so that all output
gets timestamps and is captured.
"""

# pyright: reportMissingParameterType=none, reportMissingTypeArgument=none, reportUnknownArgumentType=none, reportUnknownMemberType=none, reportUnknownParameterType=none, reportUnknownVariableType=none

import asyncio
import contextlib
import faulthandler
import json
import logging
import os
import signal
import sys
import threading
import warnings
from pathlib import Path
from typing import TYPE_CHECKING, Any, ClassVar, Literal

import structlog
from structlog.types import EventDict, Processor

from server.protocol import LogMessage

# `format_exc_info` is critical for the WS broadcast — it materialises
# `exc_info=True` into an `event_dict["exception"]` string that
# `_capture_for_broadcast` ships to clients and `_text_renderer`
# embeds in the rendered line. structlog warns about pairing it with
# `ConsoleRenderer` (which has its own pretty-print path) but our custom
# renderer handles `exception` itself, so the warning is misleading
# noise. Filter it once at startup.
warnings.filterwarnings(
    "ignore",
    message="Remove `format_exc_info` from your processor chain",
    category=UserWarning,
)

if TYPE_CHECKING:
    from server.session.connection import Connection

# ---------------------------------------------------------------------------
# Log file + TeeStream
# ---------------------------------------------------------------------------

SERVER_LOG_FILE = Path(os.environ.get("BIOME_SERVER_LOG_PATH", str(Path(__file__).with_name("server.log"))))
_log_file_lock = threading.Lock()


class TeeStream:
    """Mirror stdout/stderr to the canonical server.log file. The
    WebSocket broadcast path used to live here as well — it now lives
    on `LogBroadcast` below and is fed directly from a structlog
    processor (so each event ships its structured fields, not just the
    rendered string)."""

    def __init__(self, stream, log_fp):
        self._stream = stream
        self._log_fp = log_fp

    def write(self, data):
        written = self._stream.write(data)
        if data:
            with _log_file_lock:
                self._log_fp.write(data)
                self._log_fp.flush()
        return written

    def flush(self):
        self._stream.flush()
        with _log_file_lock:
            self._log_fp.flush()

    def isatty(self):
        return self._stream.isatty()

    def fileno(self):
        return self._stream.fileno()

    @property
    def encoding(self):
        return getattr(self._stream, "encoding", "utf-8")


class LogBroadcast:
    """Fan-out for structured log events to every connected WS client.
    Fed by `_capture_for_broadcast` in the structlog pipeline; drained by
    `stream_logs_to_client` per connection. Decoupled from TeeStream so
    each client gets the full structured `LogMessage` rather than a
    pre-rendered text line."""

    _client_queues: ClassVar[list[tuple[asyncio.Queue[LogMessage], asyncio.AbstractEventLoop]]] = []
    _client_queues_lock: ClassVar[threading.Lock] = threading.Lock()

    @classmethod
    def register_client(cls, queue: asyncio.Queue[LogMessage], loop: asyncio.AbstractEventLoop) -> None:
        with cls._client_queues_lock:
            cls._client_queues.append((queue, loop))

    @classmethod
    def unregister_client(cls, queue: asyncio.Queue[LogMessage]) -> None:
        with cls._client_queues_lock:
            cls._client_queues = [(q, ev_loop) for q, ev_loop in cls._client_queues if q is not queue]

    @classmethod
    def push(cls, msg: LogMessage) -> None:
        with cls._client_queues_lock:
            for queue, loop in cls._client_queues:
                with contextlib.suppress(asyncio.QueueFull, RuntimeError):
                    loop.call_soon_threadsafe(queue.put_nowait, msg)


# ---------------------------------------------------------------------------
# Install TeeStream + configure logging
# ---------------------------------------------------------------------------


def _resolve_log_format() -> Literal["text", "json"]:
    """Pick text vs JSON output for stdout / `server.log` / WS-replay.

    Priority:
      - `BIOME_LOG_FORMAT` env var (`text` / `json`) is the explicit override.
      - Otherwise: text when stdout is a TTY (direct terminal dev), JSON
        when it isn't (typical when spawned by Electron, or when piped
        through a tool that wants structured records).

    The WS broadcast and the diagnostic export always carry the structured
    `LogMessage` shape — only the on-stdout / on-disk encoding changes."""
    override = os.environ.get("BIOME_LOG_FORMAT", "").strip().lower()
    if override == "text":
        return "text"
    if override == "json":
        return "json"
    return "text" if sys.stdout.isatty() else "json"


LOG_FORMAT: Literal["text", "json"] = _resolve_log_format()

SERVER_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
_hosted_log_fp = open(SERVER_LOG_FILE, "w", encoding="utf-8", buffering=1)  # noqa: SIM115  -- handle owned by the TeeStream pair below; closed at process exit
sys.stdout = TeeStream(sys.stdout, _hosted_log_fp)
sys.stderr = TeeStream(sys.stderr, _hosted_log_fp)

# `structlog` produces structured event dicts, runs them through a processor
# pipeline, and hands the final rendering off to stdlib's
# `logging.Logger.info(...)`. The pipeline gives us:
#   - Per-event structured fields (`logger.info("Loading seed", filename=name)`).
#   - Per-connection scope via `structlog.contextvars.bind_contextvars(client_host=...)`
#     at WS accept; asyncio tasks inherit, the gen thread is wired explicitly
#     (see `server.session.workers.run_generator`).
#   - A migration path to Rust's `tracing` if/when this server is ported.
#
# The final renderer is picked by `LOG_FORMAT`:
#   - text mode → `ConsoleRenderer` (one human-readable line per event,
#     for direct-terminal dev).
#   - JSON mode → `JSONRenderer` (one JSON object per line, parsed back
#     into a typed `LogRecord` by the Electron-side line stream and the
#     WS-replay path).
# The WS broadcast always ships structured `LogMessage` records regardless
# of the local renderer, so connected clients get the same fidelity in
# either mode.

_PRE_CHAIN: list[Processor] = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.processors.TimeStamper(fmt="%H:%M:%S"),
]

# Reserved keys are the structlog-managed fields that have dedicated slots
# on `LogMessage`; everything else in the event_dict ends up in `fields`.
_RESERVED_EVENT_KEYS = frozenset({"event", "level", "logger", "timestamp", "exc_info", "exception"})


def _build_log_message(event_dict: EventDict) -> LogMessage:
    """Project the structlog event_dict onto a typed `LogMessage`. Reserved
    keys map to dedicated fields; the remainder land under `fields`."""
    extras: dict[str, str | int | float | bool] = {
        k: v if isinstance(v, str | int | float | bool) else str(v)
        for k, v in event_dict.items()
        if k not in _RESERVED_EVENT_KEYS
    }
    return LogMessage(
        event=str(event_dict.get("event", "")),
        level=str(event_dict.get("level", "info")),
        logger=event_dict.get("logger"),
        timestamp=event_dict.get("timestamp"),
        exception=event_dict.get("exception"),
        fields=extras or None,
    )


def _capture_for_broadcast(_logger, _method_name: str, event_dict: EventDict) -> EventDict:
    """Snapshot the structured event for the WS broadcast queue, then pass
    the dict through to the final renderer.

    Runs after the pre-chain (so `event_dict` already has level / logger /
    timestamp / merged contextvars) and after `format_exc_info` (so the
    formatted traceback is on `event_dict["exception"]`)."""
    LogBroadcast.push(_build_log_message(event_dict))
    return event_dict


def _text_renderer(_logger, _method_name: str, event_dict: EventDict) -> str:
    """Render an event_dict as a single line in the form
    ``HH:MM:SS [level   ] [logger] event k1=v1 k2=v2``. Same shape as
    `ConsoleRenderer` but with the logger pill *before* the event, so
    the fixed `[level] [logger]` prefix block stays scannable while the
    event sits at a variable column. Exceptions go on a following line."""
    timestamp = event_dict.pop("timestamp", None)
    level = str(event_dict.pop("level", "info"))
    logger_name = event_dict.pop("logger", None)
    event = str(event_dict.pop("event", ""))
    exception = event_dict.pop("exception", None)
    event_dict.pop("exc_info", None)

    parts: list[str] = []
    if timestamp:
        parts.append(str(timestamp))
    parts.append(f"[{level:<8}]")
    if logger_name:
        parts.append(f"[{logger_name}]")
    parts.append(event)
    parts.extend(f"{k}={v}" for k, v in event_dict.items())
    line = " ".join(parts)
    if exception:
        line = f"{line}\n{exception}"
    return line


_json_renderer = structlog.processors.JSONRenderer()
_final_renderer: Processor = _text_renderer if LOG_FORMAT == "text" else _json_renderer


class _BoundLogger(structlog.stdlib.BoundLogger):
    """Override `.exception()` to dispatch through stdlib's `error` method
    rather than `exception`. structlog's pipeline already formats the
    traceback into `event_dict["exception"]` via `format_exc_info`; if we
    let the call surface as `stdlib.Logger.exception`, stdlib's own
    implementation defaults `exc_info=True` and re-renders the traceback
    on top of our string, producing duplicate output."""

    def exception(self, event: str | None = None, *args: Any, **kw: Any) -> Any:
        kw.setdefault("exc_info", True)
        return self._proxy_to_logger("error", event, *args, **kw)


structlog.configure(
    processors=[
        *_PRE_CHAIN,
        # `format_exc_info` materialises tracebacks before render so
        # `log.exception(...)` lands the formatted traceback in the message.
        structlog.processors.format_exc_info,
        # Side-effect: ship the structured event to WS clients before
        # the final renderer reduces it to a string.
        _capture_for_broadcast,
        _final_renderer,
    ],
    wrapper_class=_BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

# Stdlib basicConfig provides the transport (TeeStream-wrapped stdout) and the
# level filter; structlog has already rendered the full line so we use the
# bare `%(message)s` format here.
logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)

logger = structlog.stdlib.get_logger(__name__)

# Route uvicorn's loggers through our standard transport.
for _uv_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
    _uv_logger = logging.getLogger(_uv_name)
    _uv_logger.handlers.clear()
    _uv_logger.propagate = True


# ---------------------------------------------------------------------------
# Crash hooks
# ---------------------------------------------------------------------------


def _install_crash_logging_hooks() -> None:
    """Force uncaught exceptions and fatal interpreter crashes into server.log."""
    try:
        faulthandler.enable(file=_hosted_log_fp, all_threads=True)
    except Exception:
        logger.exception("Failed to enable faulthandler")

    try:
        if hasattr(signal, "SIGTERM") and hasattr(faulthandler, "register"):
            faulthandler.register(signal.SIGTERM, file=_hosted_log_fp, all_threads=True, chain=True)
    except Exception:
        logger.exception("Failed to register SIGTERM faulthandler hook")

    def _log_uncaught_exception(exc_type, exc_value, exc_tb):
        logger.error("Uncaught exception:", exc_info=(exc_type, exc_value, exc_tb))

    def _log_thread_exception(args):
        logger.error(
            f"Uncaught thread exception in {args.thread.name}:",
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
        )

    def _log_unraisable(unraisable):
        msg = "Unraisable exception"
        if unraisable.err_msg:
            msg += f": {unraisable.err_msg}"
        logger.error(
            msg,
            exc_info=(unraisable.exc_type, unraisable.exc_value, unraisable.exc_traceback),
        )

    sys.excepthook = _log_uncaught_exception
    threading.excepthook = _log_thread_exception
    sys.unraisablehook = _log_unraisable


_install_crash_logging_hooks()


# ---------------------------------------------------------------------------
# Log streaming to WebSocket clients
# ---------------------------------------------------------------------------

LOG_TAIL_INITIAL_LINES = 220


def read_log_tail_records(max_lines: int) -> list[LogMessage]:
    """Read the last lines of `server.log` and project each onto a
    `LogMessage`. In JSON mode each line is a structlog event_dict;
    in text mode (or when a JSON line fails to parse, e.g. a uvicorn
    line that wasn't routed through structlog) we fall back to a
    record carrying just the rendered text on `event`."""
    if max_lines <= 0:
        return []
    try:
        with open(SERVER_LOG_FILE, encoding="utf-8", errors="replace") as fp:
            lines = [line.rstrip("\r\n") for line in fp if line.strip()]
    except OSError:
        return []

    return [_parse_log_line(line) for line in lines[-max_lines:]]


def _parse_log_line(line: str) -> LogMessage:
    """Project a single log-file line onto a `LogMessage`. JSON mode
    yields a full structured record; text mode (or any JSON parse
    failure) degrades to `LogMessage(event=line)`."""
    if LOG_FORMAT == "json":
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            return LogMessage(event=line)
        if isinstance(obj, dict):
            return _build_log_message(obj)
        return LogMessage(event=line)
    return LogMessage(event=line)


async def stream_logs_to_client(conn: "Connection") -> None:
    """Replay the recent log tail, then attach to LogBroadcast for live
    updates, pushing each event as a typed `LogMessage` over the WebSocket.

    Run as an asyncio task; cancel to stop. The LogBroadcast registration is
    lifted by `Connection.teardown` (so cancellation timing doesn't matter)."""
    try:
        for record in read_log_tail_records(LOG_TAIL_INITIAL_LINES):
            await conn.send_message(record)
        LogBroadcast.register_client(conn.log_queue, conn.main_loop)

        while True:
            msg = await conn.log_queue.get()
            await conn.send_message(msg)
    except asyncio.CancelledError:
        pass
    except Exception as e:  # noqa: BLE001  -- websocket send/queue can fail with a wide variety of errors; we just want to stop cleanly without recursing through logger
        # Avoid recursion — don't use logger here.
        print(f"Log stream stopped: {e}", flush=True)
