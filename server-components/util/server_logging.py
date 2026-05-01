"""
Server logging infrastructure.

Sets up TeeStream (stdout/stderr mirroring to file + WebSocket broadcast),
configures the Python logging system, and installs crash hooks. Imported
at the very top of main.py before any heavy imports so that all output
gets timestamps and is captured.
"""

import asyncio
import contextlib
import faulthandler
import logging
import os
import signal
import sys
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING, ClassVar

from server.protocol import LogMessage

if TYPE_CHECKING:
    from server.session.connection import Connection

# ---------------------------------------------------------------------------
# Log file + TeeStream
# ---------------------------------------------------------------------------

SERVER_LOG_FILE = Path(os.environ.get("BIOME_SERVER_LOG_PATH", str(Path(__file__).with_name("server.log"))))
_log_file_lock = threading.Lock()


class TeeStream:
    """Mirror stdout/stderr to a file while broadcasting complete lines to WebSocket clients."""

    _client_queues: ClassVar[list[tuple[asyncio.Queue, asyncio.AbstractEventLoop]]] = []
    _client_queues_lock: ClassVar[threading.Lock] = threading.Lock()

    @classmethod
    def register_client(cls, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop) -> None:
        with cls._client_queues_lock:
            cls._client_queues.append((queue, loop))

    @classmethod
    def unregister_client(cls, queue: asyncio.Queue) -> None:
        with cls._client_queues_lock:
            cls._client_queues = [(q, ev_loop) for q, ev_loop in cls._client_queues if q is not queue]

    def __init__(self, stream, log_fp):
        self._stream = stream
        self._log_fp = log_fp
        self._line_buf = ""
        self._buf_lock = threading.Lock()

    def write(self, data):
        written = self._stream.write(data)
        if data:
            with _log_file_lock:
                self._log_fp.write(data)
                self._log_fp.flush()
            self._broadcast(data)
        return written

    @staticmethod
    def _ensure_timestamp(line: str) -> str:
        """Prepend an HH:MM:SS timestamp if the line doesn't already start with one."""
        if len(line) >= 8 and line[2] == ":" and line[5] == ":":
            return line
        return f"{time.strftime('%H:%M:%S')} {line}"

    def _broadcast(self, data: str) -> None:
        with self._buf_lock:
            self._line_buf += data
            while "\n" in self._line_buf:
                line, self._line_buf = self._line_buf.split("\n", 1)
                line = line.rstrip("\r")
                if not line:
                    continue
                line = TeeStream._ensure_timestamp(line)
                with TeeStream._client_queues_lock:
                    for queue, loop in TeeStream._client_queues:
                        with contextlib.suppress(asyncio.QueueFull, RuntimeError):
                            loop.call_soon_threadsafe(queue.put_nowait, line)

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


# ---------------------------------------------------------------------------
# Install TeeStream + configure logging
# ---------------------------------------------------------------------------

SERVER_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
_hosted_log_fp = open(SERVER_LOG_FILE, "w", encoding="utf-8", buffering=1)  # noqa: SIM115  -- handle owned by the TeeStream pair below; closed at process exit
sys.stdout = TeeStream(sys.stdout, _hosted_log_fp)
sys.stderr = TeeStream(sys.stderr, _hosted_log_fp)

_LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"
_LOG_DATEFMT = "%H:%M:%S"

logging.basicConfig(
    level=logging.INFO,
    format=_LOG_FORMAT,
    datefmt=_LOG_DATEFMT,
    stream=sys.stdout,
)
logger = logging.getLogger("biome_server")

# Route uvicorn's loggers through our standard format.
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


def read_log_tail_lines(max_lines: int) -> list[str]:
    """Read last non-empty lines from the canonical server log file."""
    if max_lines <= 0:
        return []
    try:
        with open(SERVER_LOG_FILE, encoding="utf-8", errors="replace") as fp:
            lines = [line.rstrip("\r\n") for line in fp if line.strip()]
        return lines[-max_lines:]
    except OSError:
        return []


async def stream_logs_to_client(conn: "Connection") -> None:
    """Replay the recent log tail, then attach to TeeStream for live updates,
    pushing each line as a typed `LogMessage` over the WebSocket.

    Run as an asyncio task; cancel to stop. The TeeStream registration is
    lifted by `Connection.teardown` (so cancellation timing doesn't matter)."""
    try:
        for line in read_log_tail_lines(LOG_TAIL_INITIAL_LINES):
            await conn.send_message(LogMessage(line=line))
        TeeStream.register_client(conn.log_queue, conn.main_loop)

        while True:
            line = await conn.log_queue.get()
            await conn.send_message(LogMessage(line=line))
    except asyncio.CancelledError:
        pass
    except Exception as e:  # noqa: BLE001  -- websocket send/queue can fail with a wide variety of errors; we just want to stop cleanly without recursing through logger
        # Avoid recursion — don't use logger here.
        print(f"[{conn.client_host}] Log stream stopped: {e}", flush=True)
