"""
Centralised progress-stage registry for the Biome server.

Every stage that the server or engine manager can report lives here as a
frozen dataclass constant.  Both ``server.py`` and ``engine_manager.py``
import from this module instead of hard-coding IDs, labels, and percentages.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Stage:
    id: str
    label: str
    percent: int


# ── Startup (1-10%) — server init before any client connects ──────────────

STARTUP_BEGIN = Stage(
    "startup.begin", "Starting server components...", 1
)
STARTUP_ENGINE_MANAGER = Stage(
    "startup.world_engine_manager", "Initializing world engine manager...", 3
)
STARTUP_SAFETY_CHECKER = Stage(
    "startup.safety_checker", "Initializing safety checker...", 4
)
STARTUP_SAFETY_WARMUP = Stage(
    "startup.safety_warmup", "Warming safety checker...", 6
)
STARTUP_SAFETY_READY = Stage(
    "startup.safety_ready", "Safety checker ready.", 7
)
STARTUP_SEED_STORAGE = Stage(
    "startup.seed_storage", "Preparing seed storage...", 8
)
STARTUP_SEED_VALIDATION = Stage(
    "startup.seed_validation", "Validating seed cache...", 9
)
STARTUP_READY = Stage(
    "startup.ready", "Server backend ready. Waiting for model selection...", 10
)

# ── Session (12-100%) — per-client connection lifecycle ───────────────────

SESSION_WAITING_FOR_SEED = Stage(
    "session.waiting_for_seed", "Waiting for initial seed...", 12
)

SESSION_LOADING_IMPORT = Stage(
    "session.loading_model.import", "Importing WorldEngine...", 15
)
SESSION_LOADING_MODEL = Stage(
    "session.loading_model.load", "Loading model...", 18
)
SESSION_LOADING_WEIGHTS = Stage(
    "session.loading_model.instantiate", "Loading model weights...", 30
)
SESSION_LOADING_DONE = Stage(
    "session.loading_model.done", "Model loaded.", 35
)

SESSION_WARMUP_RESET = Stage(
    "session.warmup.reset", "Warmup: resetting engine...", 40
)
SESSION_WARMUP_SEED = Stage(
    "session.warmup.seed", "Warmup: loading seed frame...", 48
)
SESSION_WARMUP_PROMPT = Stage(
    "session.warmup.prompt", "Warmup: setting prompt...", 55
)
SESSION_WARMUP_COMPILE = Stage(
    "session.warmup.compile", "Warmup: compiling CUDA graphs...", 60
)

SESSION_INIT_RESET = Stage(
    "session.init.reset", "Resetting world state...", 78
)
SESSION_INIT_SEED = Stage(
    "session.init.seed", "Loading seed frame...", 85
)
SESSION_INIT_FRAME = Stage(
    "session.init.frame", "Rendering initial frame...", 92
)

SESSION_READY = Stage(
    "session.ready", "Ready.", 100
)
