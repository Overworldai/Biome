"""
TTL caches for upstream-fetched data.

Used by the routes module to avoid hammering HuggingFace on every model
picker render — the renderer batches one request per visible model when
settings opens, and the same IDs repeat back-to-back across reopens.

In-memory and per-process. Bounded only by the working set of keys the
renderer asks about, which is fine for an interactive UI. If a future
endpoint admits user-controlled high-cardinality keys, swap for an LRU
implementation rather than letting the dict grow unbounded.
"""

import time


class TtlCache[K, V]:
    """Per-key TTL cache. `get` returns `None` on miss or expiry, `set`
    records a fresh value with the current monotonic timestamp.

    Not thread-safe. All access from the same asyncio task is fine since
    Python's GIL makes dict mutations atomic, but cross-thread use needs
    external synchronisation. Routes are async-only, so this is moot in
    practice."""

    def __init__(self, ttl_seconds: float) -> None:
        self._ttl = ttl_seconds
        self._store: dict[K, tuple[float, V]] = {}

    def get(self, key: K) -> V | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        timestamp, value = entry
        if time.monotonic() - timestamp >= self._ttl:
            return None
        return value

    def set(self, key: K, value: V) -> None:
        self._store[key] = (time.monotonic(), value)
