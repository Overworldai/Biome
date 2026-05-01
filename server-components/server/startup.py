"""
Startup-progress signaling for the WebSocket layer.

`ServerStartup` is a small mutable container that lives on `app.state.startup`
for the lifetime of the process. The lifespan-side `_heavy_init` reports
stages into it as initialization proceeds; WebSocket clients connecting
before completion call `replay_to(conn)` to receive the accumulated stages
plus a live tail of new ones.

Owns its own waiter list — clients self-register on `replay_to` and clean
up via `try/finally`. `_heavy_init` calls `mark_done()` (or `mark_failed`)
to release every waiter together.
"""

import asyncio
import contextlib
from typing import TYPE_CHECKING

from server.protocol import StageId, StatusMessage

if TYPE_CHECKING:
    from server.session.connection import Connection


class ServerStartup:
    """Process-lifetime signaling for the heavy init phase. Mutated by
    the lifespan task; observed by per-connection replay loops."""

    def __init__(self) -> None:
        self.complete: bool = False
        self.error: str | None = None
        self.stages: list[StatusMessage] = []
        self._waiters: list[asyncio.Queue[StatusMessage | None]] = []

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
        """If startup is still in progress, send the accumulated stages and
        stream new ones until completion. No-op if startup already finished
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
