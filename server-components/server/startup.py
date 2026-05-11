"""
Lazy engine init + startup-progress signaling for the WebSocket layer.

`ServerStartup` lives on `app.state.startup` for process lifetime and owns
two responsibilities:

  - **Lazy engine load.** The heavy GPU stack (world_engine, transformers,
    diffusers) is constructed on the first WS connect via
    `ensure_engines_loaded`, not at process startup. Server boot stays
    fast — info-only endpoints (`/health`, `/api/model-info`, …) respond
    immediately while the GPU pieces are still uninstantiated.

  - **Stage broadcast.** While the lazy load runs, the connecting client
    needs to see progress. `mark_stage` records each `STARTUP_*` stage
    and fans it out to every WS client subscribed via `replay_to`.
    Subsequent connects find `complete=True` and short-circuit.

`init_lock` serialises concurrent first-connects (defence in depth — the
single-session gate already prevents two simultaneous sessions). On
failure, `error` is sticky for the rest of the process so retrying clients
get a deterministic `SERVER_STARTUP_FAILED` instead of attempting to
reload a broken stack.
"""

import asyncio
import contextlib
from typing import TYPE_CHECKING

import structlog

from server.protocol import StageId, StatusMessage

if TYPE_CHECKING:
    from fastapi import FastAPI

    from server.session.connection import Connection

logger = structlog.stdlib.get_logger(__name__)


class ServerStartup:
    """Process-lifetime engine-init coordinator + stage broadcast."""

    def __init__(self) -> None:
        self.complete: bool = False
        self.error: str | None = None
        self.stages: list[StatusMessage] = []
        self._waiters: list[asyncio.Queue[StatusMessage | None]] = []
        self.init_lock: asyncio.Lock = asyncio.Lock()

    def mark_stage(self, stage: StageId) -> None:
        """Record a stage and broadcast it to every connected waiter."""
        msg = StatusMessage(stage=stage)
        self.stages.append(msg)
        for q in self._waiters:
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(msg)

    def mark_done(self) -> None:
        """Flip `complete` and wake every waiter so its replay loop exits."""
        self.complete = True
        for q in self._waiters:
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(None)

    def mark_failed(self, error: str) -> None:
        """Record a startup error and signal completion (so clients can surface
        the failure rather than wait forever)."""
        self.error = error
        self.mark_done()

    async def replay_to(self, conn: "Connection") -> None:
        """If engine init is still in progress, send the accumulated stages and
        stream new ones until completion. No-op if init already finished
        before the client arrived."""
        if self.complete:
            return
        queue: asyncio.Queue[StatusMessage | None] = asyncio.Queue(maxsize=200)
        self._waiters.append(queue)
        try:
            for stage_msg in self.stages:
                await conn.send_message(stage_msg)
            while not self.complete:
                try:
                    next_msg = await asyncio.wait_for(queue.get(), timeout=1.0)
                    if next_msg is None:
                        break
                    await conn.send_message(next_msg)
                except TimeoutError:
                    continue
        finally:
            self._waiters.remove(queue)

    async def ensure_engines_loaded(self, app: "FastAPI") -> None:
        """Lazy first-call engine load. Idempotent — concurrent calls serialise
        on `init_lock`, subsequent calls short-circuit on `self.complete`.

        The heavy GPU-stack imports (world_engine, transformers, diffusers via
        the engine submodules) are local to this function so module load time
        stays fast. Progress fans out via `mark_stage` to any clients currently
        subscribed via `replay_to`."""
        if self.complete:
            return

        async with self.init_lock:
            if self.complete:
                return

            try:
                self.mark_stage(StageId.STARTUP_BEGIN)
                logger.info("Initializing engines (lazy first-connect)...")

                self.mark_stage(StageId.STARTUP_ENGINE_MANAGER)
                # Local imports: bringing in world_engine + the engine
                # submodules pulls torchvision and other heavy deps that
                # we deliberately keep out of process startup.
                from engine import Engines
                from engine.manager import WorldEngineManager
                from engine.scene_authoring import SceneAuthoringManager

                world_engine = WorldEngineManager()
                scene_authoring = SceneAuthoringManager(world_engine)

                self.mark_stage(StageId.STARTUP_SAFETY_CHECKER)
                from engine.safety import SafetyChecker

                safety_checker = await asyncio.to_thread(SafetyChecker)
                self.mark_stage(StageId.STARTUP_SAFETY_READY)

                app.state.engines = Engines(
                    world_engine=world_engine,
                    scene_authoring=scene_authoring,
                    safety_checker=safety_checker,
                )

                logger.info(
                    "Engines ready; WorldEngine model loads on session init",
                    safety_cache_entries=safety_checker.cache_size,
                )
                self.mark_stage(StageId.STARTUP_READY)
                self.mark_done()

            except Exception as exc:
                logger.exception("Engine load failed")
                self.mark_failed(str(exc))
