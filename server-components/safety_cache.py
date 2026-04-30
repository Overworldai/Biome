"""
Disk-backed cache of seed-image safety check results.

Persisted as JSON via Pydantic; entry shape lives in `app_state.py`.
The on-disk file is human-readable and version-tolerant — adding new
optional fields to `SafetyCacheEntry` doesn't invalidate old caches.
A failed load (missing file, parse error, schema drift) returns an
empty cache so the first session re-runs safety checks; results are
cached again from there.

This module is strict-typed by construction — none of the legacy ignore
rules in pyproject.toml fire on this code. Keep it that way.
"""

import logging
from pathlib import Path

from pydantic import TypeAdapter

from app_state import SafetyCacheEntry

logger = logging.getLogger(__name__)

SAFETY_CACHE_FILE = Path(__file__).parent.parent / "world_engine" / ".safety_cache.json"

_cache_adapter: TypeAdapter[dict[str, SafetyCacheEntry]] = TypeAdapter(dict[str, SafetyCacheEntry])


def load_safety_cache() -> dict[str, SafetyCacheEntry]:
    """Load hash-keyed safety cache from JSON. Returns an empty dict if
    the file is missing or fails to parse — failures are logged but
    non-fatal; cache rebuilds on next session."""
    if not SAFETY_CACHE_FILE.exists():
        return {}
    try:
        cache = _cache_adapter.validate_json(SAFETY_CACHE_FILE.read_bytes())
        logger.info(f"Loaded safety cache with {len(cache)} entries")
        return cache
    except Exception as e:
        logger.error(f"Failed to load safety cache: {e}")
        return {}


def save_safety_cache(cache: dict[str, SafetyCacheEntry]) -> None:
    """Persist the safety cache to disk; failures are logged but
    non-fatal (the cache rebuilds on next session)."""
    try:
        SAFETY_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        SAFETY_CACHE_FILE.write_bytes(_cache_adapter.dump_json(cache, indent=2))
    except Exception as e:
        logger.error(f"Failed to save safety cache: {e}")
