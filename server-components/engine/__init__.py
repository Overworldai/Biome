"""
World-engine subsystem.

Re-exports the top-level type the rest of the server passes around — the
`Engines` bundle. It's a frozen dataclass so callers can pass the trio
without anybody mutating it through the bundle. Submodule classes
(`WorldEngineManager`, `SceneAuthoringManager`, `SafetyChecker`) are
imported under `TYPE_CHECKING` so this module stays light at import-time;
the heavy torch / transformers waterfall only fires when the submodules
themselves are imported (from `main.py`'s instrumented try-block).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .manager import WorldEngineManager
    from .safety import SafetyChecker
    from .scene_authoring import SceneAuthoringManager


@dataclass(frozen=True)
class Engines:
    """The three GPU-resident services constructed once at startup and
    threaded through every consumer that needs them. Frozen so the bundle
    itself is read-only; the underlying managers are mutable."""

    world_engine: WorldEngineManager
    scene_authoring: SceneAuthoringManager
    safety_checker: SafetyChecker
