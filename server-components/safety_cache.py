"""
Disk-backed cache of seed-image safety check results.

Stored as a pickle file alongside the engine workspace; step 7 converts
to JSON-with-Pydantic. Both `server.py` (for warmup load) and
`ws_session.py` (for per-seed-check writes) consume these helpers, so
they live in their own module to avoid a circular import.

This module is strict-typed by construction — none of the legacy ignore
rules in pyproject.toml fire on this code. Keep it that way.
"""

import logging
import pickle
from pathlib import Path

from app_state import SafetyCacheEntry

logger = logging.getLogger(__name__)

SAFETY_CACHE_FILE = Path(__file__).parent.parent / "world_engine" / ".safety_cache.bin"


def load_safety_cache() -> dict[str, SafetyCacheEntry]:
    """Load hash-keyed safety cache from binary file. Returns an empty
    dict if the file is missing or fails to load."""
    if not SAFETY_CACHE_FILE.exists():
        return {}
    try:
        with open(SAFETY_CACHE_FILE, "rb") as f:
            cache = pickle.load(f)
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
        with open(SAFETY_CACHE_FILE, "wb") as f:
            pickle.dump(cache, f)
    except Exception as e:
        logger.error(f"Failed to save safety cache: {e}")
