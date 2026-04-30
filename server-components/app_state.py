"""
Process-wide mutable state container.

Replaces the module-level globals in server.py with a single AppState
instance threaded explicitly through every consumer that needs it.
FastAPI's lifespan constructs the instance and attaches it to
`app.state.app_state`; HTTP handlers retrieve it via the typed
`get_app_state(request)` helper, WebSocket handlers via
`get_app_state_ws(websocket)`.

Fields are mutated in place — the container itself is the long-lived
owner. This is a deliberately mutable dataclass; immutability lives
at the field level (Pydantic models for everything that crosses a
boundary, frozen dataclasses for value types).

This module is strict-typed by construction — none of the legacy ignore
rules in pyproject.toml fire on this code. Keep it that way.
"""

import asyncio
from dataclasses import dataclass, field

from fastapi import FastAPI, Request, WebSocket

from protocol import StatusMessage


@dataclass
class AppState:
    """One instance per server lifetime; created in `lifespan()`."""

    # ─── Startup state ──────────────────────────────────────────────
    # `startup_complete` flips once `_heavy_init` finishes; clients
    # connecting before then receive `startup_stages` as replay and
    # subscribe to `ws_startup_waiters` for new stages until done.
    startup_complete: bool = False
    startup_error: str | None = None
    startup_stages: list[StatusMessage] = field(default_factory=list)
    ws_startup_waiters: list[asyncio.Queue[StatusMessage | None]] = field(default_factory=list)


def get_app_state(request: Request) -> AppState:
    """Typed accessor for HTTP handlers (`Depends(get_app_state)`)."""
    state: AppState = request.app.state.app_state
    return state


def get_app_state_ws(websocket: WebSocket) -> AppState:
    """Typed accessor for WebSocket handlers — FastAPI passes the
    websocket into the endpoint, and `.app.state` carries our state."""
    state: AppState = websocket.app.state.app_state
    return state


def attach_app_state(app: FastAPI, state: AppState) -> None:
    """Stash the AppState on the FastAPI instance. Called once from
    the lifespan; the typed accessors above retrieve it back."""
    app.state.app_state = state
