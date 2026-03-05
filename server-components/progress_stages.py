"""
Centralised progress-stage registry for the Biome server.

Every stage that the server or engine manager can report lives here as a
frozen dataclass constant.  Both ``server.py`` and ``engine_manager.py``
import from this module instead of hard-coding IDs.

Labels and percentages are defined in ``src/stages.json`` — only the IDs
are used on the Python side.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Stage:
    id: str


# ── Startup — server init before any client connects ──────────────────

STARTUP_BEGIN = Stage("startup.begin")
STARTUP_ENGINE_MANAGER = Stage("startup.world_engine_manager")
STARTUP_SAFETY_CHECKER = Stage("startup.safety_checker")
STARTUP_SAFETY_WARMUP = Stage("startup.safety_warmup")
STARTUP_SAFETY_READY = Stage("startup.safety_ready")
STARTUP_SEED_STORAGE = Stage("startup.seed_storage")
STARTUP_SEED_VALIDATION = Stage("startup.seed_validation")
STARTUP_READY = Stage("startup.ready")

# ── Session — per-client connection lifecycle ──────────────────────────

SESSION_WAITING_FOR_SEED = Stage("session.waiting_for_seed")

SESSION_LOADING_IMPORT = Stage("session.loading_model.import")
SESSION_LOADING_MODEL = Stage("session.loading_model.load")
SESSION_LOADING_WEIGHTS = Stage("session.loading_model.instantiate")
SESSION_LOADING_DONE = Stage("session.loading_model.done")

SESSION_WARMUP_RESET = Stage("session.warmup.reset")
SESSION_WARMUP_SEED = Stage("session.warmup.seed")
SESSION_WARMUP_PROMPT = Stage("session.warmup.prompt")
SESSION_WARMUP_COMPILE = Stage("session.warmup.compile")

SESSION_INIT_RESET = Stage("session.init.reset")
SESSION_INIT_SEED = Stage("session.init.seed")
SESSION_INIT_FRAME = Stage("session.init.frame")

SESSION_READY = Stage("session.ready")
