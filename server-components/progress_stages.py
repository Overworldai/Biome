"""
Centralised progress-stage registry for the Biome server.

Every stage that the server or engine manager can report lives in
the `StageId` enum below — server.py / engine_manager.py / ws_session.py
all import from here instead of hard-coding strings. The string values
match the keys in `src/stages.json` on the renderer (which carries the
labels and progress percentages); both files must stay in sync.

`StageId` is a `StrEnum`, so a value can be passed wherever a `str` is
expected (the wire protocol uses `str` for `StatusMessage.stage`) and
typed callers get autocomplete / rename safety.

This module is strict-typed by construction — none of the legacy ignore
rules in pyproject.toml fire on this code. Keep it that way.
"""

from enum import StrEnum


class StageId(StrEnum):
    # ── Startup — server init before any client connects ──────────────
    STARTUP_BEGIN = "startup.begin"
    STARTUP_ENGINE_MANAGER = "startup.world_engine_manager"
    STARTUP_SAFETY_CHECKER = "startup.safety_checker"
    STARTUP_SAFETY_READY = "startup.safety_ready"
    STARTUP_READY = "startup.ready"

    # ── Session — per-client connection lifecycle ─────────────────────
    SESSION_WAITING_FOR_SEED = "session.waiting_for_seed"

    SESSION_LOADING_IMPORT = "session.loading_model.import"
    SESSION_LOADING_MODEL = "session.loading_model.load"
    SESSION_LOADING_WEIGHTS = "session.loading_model.instantiate"
    SESSION_LOADING_DONE = "session.loading_model.done"

    SESSION_WARMUP_RESET = "session.warmup.reset"
    SESSION_WARMUP_SEED = "session.warmup.seed"
    SESSION_WARMUP_COMPILE = "session.warmup.compile"

    SESSION_INPAINTING_LOAD = "session.inpainting.load"
    SESSION_INPAINTING_READY = "session.inpainting.ready"

    SESSION_INIT_RESET = "session.init.reset"
    SESSION_INIT_SEED = "session.init.seed"
    SESSION_INIT_FRAME = "session.init.frame"

    SESSION_RESET = "session.reset"  # CUDA-error recovery

    SESSION_READY = "session.ready"
