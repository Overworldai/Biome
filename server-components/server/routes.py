"""
HTTP and WebSocket endpoints for the Biome server.

Exposes a `router: APIRouter` with the `/health` probe, the
`/api/model-info/{model_id}` HF metadata proxy, and the `/ws`
WebSocket entry point. The router is mounted onto the FastAPI `app`
in `main.py`; this module is import-safe and process-agnostic.

The WebSocket endpoint stays a thin protocol shell: it owns transport
lifecycle (accept, dispatch by phase, close, top-level error reporting)
and delegates every internal concern to the module that owns it.
Phases run top-to-bottom; each is one well-named call:

  - log streaming           → `util.server_logging.stream_logs_to_client`
  - startup wait            → `ServerStartup.replay_to`
  - progress drain          → `Connection.run_progress_drain`
  - pre-init handshake      → `server.session.handlers.run_preinit_handshake`
  - warmup + init + frame   → `server.session.handlers.prepare_session`
  - recorders               → `Connection.start_recording_segments`
  - game loop               → `server.session.workers.run_session`
  - cleanup                 → `Connection.teardown`

`app.state` carries the resources the lifespan populates: `engines`
(an `Engines` bundle), `safety_cache`, `startup` (`ServerStartup`).
The typed accessors below pull each piece individually so endpoints
take only what they need rather than reaching through a god object.
"""

# pyright: reportPrivateImportUsage=none

import asyncio
import contextlib
import os
import shutil
from pathlib import Path
from typing import Annotated, Literal, cast

import structlog
import yaml
from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from huggingface_hub import constants as hf_constants
from huggingface_hub import get_collection, scan_cache_dir, try_to_load_from_cache
from huggingface_hub import model_info as hf_model_info
from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError
from pydantic import BaseModel
from structlog.contextvars import bound_contextvars

from engine import Engines
from server.caches import TtlCache
from server.protocol import PROTOCOL_VERSION, MessageId, StageId, SystemInfo, SystemInfoMessage, rpc_ok
from server.session.connection import Connection
from server.session.handlers import build_init_response_data, prepare_session, run_preinit_handshake
from server.session.workers import run_session
from server.startup import ServerStartup
from util.server_logging import stream_logs_to_client
from util.system_info import SystemMonitor

logger = structlog.stdlib.get_logger(__name__)
router = APIRouter()


# ============================================================================
# HTTP response types
# ============================================================================


class WorldEngineHealth(BaseModel):
    loaded: bool
    warmed_up: bool
    has_seed: bool


class SafetyHealth(BaseModel):
    loaded: bool


class HealthResponse(BaseModel):
    """Body of `GET /health`. The renderer uses this to gate "engine ready"
    UI; the frontend checks reachability via the request itself, so the
    response shape is for the engine-status panel only."""

    status: Literal["ok"] = "ok"
    startup_complete: bool
    world_engine: WorldEngineHealth
    safety: SafetyHealth
    # True when this server was launched by a Biome instance running in
    # standalone mode (via `--launched-from-standalone`). The renderer
    # uses this in remote-server mode to refuse a URL that points to
    # any standalone-managed server: leaving server mode pointed at one
    # invites the next mode-switch to tear it down underneath the user.
    launched_from_standalone: bool = False


class PickerModel(BaseModel):
    """One entry in the canonical world-model picker list. Mirrors the
    `PickerModel` TS type in `src/types/ipc.ts`. The server is the
    single authority for what models the user can choose: the curated
    Waypoint collection plus whatever's locally cached, with size and
    cache-presence baked in. The renderer never talks to HuggingFace
    directly."""

    id: str
    size_bytes: int | None
    is_local: bool


# Internal cache value; not exposed on a route. Carries the raw size
# resolution per model id so the picker endpoint can amortise HF lookups
# across calls without re-fetching for every render.
class ModelSize(BaseModel):
    size_bytes: int | None
    """`None` either means "unknown" (couldn't resolve) or "transient
    failure" — see `_resolve_model_size` for which is cached."""


# ============================================================================
# Constants
# ============================================================================

# Slug of the curated HuggingFace collection that backs the world-model
# picker. Mirrored on the renderer side; bump on both ends together.
WAYPOINT_COLLECTION_SLUG = "Overworld/waypoint"

# Fallback when the collection request fails (e.g. offline mode, HF outage).
# Keeps the picker populated with at least the default option.
DEFAULT_WORLD_ENGINE_MODEL = "Overworld/Waypoint-1.5-1B"

# Values of `model_type` in a model's `config.yaml` that mark it as a
# world-model variant the engine knows how to load. Used to admit a
# cached repo into the picker when it isn't in the curated collection
# (e.g. a local dev variant). Some Waypoint-collection entries don't
# carry this field at all — those are admitted via collection
# membership, hence the OR semantics below.
WAYPOINT_MODEL_TYPES: set[str] = {"waypoint-1", "waypoint-1.5"}

# Filename patterns excluded from "world-engine model size" calculations.
# Repos bundle a diffusers-format VAE under `vae/` whose weights are a
# separately-downloadable component, not part of the world-engine model
# proper; counting them would double the displayed size for users who
# don't care about the VAE breakdown.
_EXCLUDED_SIZE_BASENAMES: set[str] = {"diffusion_pytorch_model.safetensors"}


def _counts_toward_model_size(file_name: str) -> bool:
    """Predicate matching the HF metadata filter in `_resolve_model_size`.
    Reused by the on-disk size computation so cached and uncached
    entries report comparable numbers."""
    if not file_name.endswith(".safetensors"):
        return False
    return os.path.basename(file_name) not in _EXCLUDED_SIZE_BASENAMES


# ============================================================================
# Typed Depends accessors
# ============================================================================


def get_engines(request: Request) -> Engines:
    engines: Engines = request.app.state.engines
    return engines


def get_engines_ws(websocket: WebSocket) -> Engines:
    engines: Engines = websocket.app.state.engines
    return engines


def get_startup(request: Request) -> ServerStartup:
    startup: ServerStartup = request.app.state.startup
    return startup


def get_startup_ws(websocket: WebSocket) -> ServerStartup:
    startup: ServerStartup = websocket.app.state.startup
    return startup


def get_system_monitor_ws(websocket: WebSocket) -> SystemMonitor:
    monitor: SystemMonitor = websocket.app.state.system_monitor
    return monitor


def get_model_size_cache(request: Request) -> TtlCache[str, "ModelSize"]:
    cache: TtlCache[str, ModelSize] = request.app.state.model_size_cache
    return cache


def get_waypoint_models_cache(request: Request) -> TtlCache[str, list[str]]:
    cache: TtlCache[str, list[str]] = request.app.state.waypoint_models_cache
    return cache


# ============================================================================
# HTTP Endpoints
# ============================================================================


@router.get("/health")
async def health(request: Request, startup: Annotated[ServerStartup, Depends(get_startup)]) -> HealthResponse:
    """Health check for Biome backend. Reads through to `app.state` directly
    for engine handles since they may not be populated yet during startup."""
    engines: Engines | None = getattr(request.app.state, "engines", None)
    we = engines.world_engine if engines else None
    startup_config = getattr(request.app.state, "startup_config", None)
    launched_from_standalone = startup_config.launched_from_standalone if startup_config is not None else False
    return HealthResponse(
        startup_complete=startup.complete,
        world_engine=WorldEngineHealth(
            loaded=we is not None and we.is_loaded,
            warmed_up=we is not None and we.engine_warmed_up,
            has_seed=we is not None and we.seed_frame is not None,
        ),
        safety=SafetyHealth(loaded=engines is not None),
        launched_from_standalone=launched_from_standalone,
    )


def _is_cached_waypoint_model(repo_id: str) -> bool:
    """True if the repo's cached `config.yaml` declares a Waypoint
    `model_type`. Used to admit non-collection cached repos into the
    picker — Waypoint variants the user trained / downloaded outside
    the curated collection. Returns False on any read / parse failure
    (the repo just falls back to "must be in the collection")."""
    try:
        path = try_to_load_from_cache(repo_id, "config.yaml")
    except Exception:  # noqa: BLE001  -- try_to_load_from_cache can raise on OS-level cache issues; treat as "not waypoint"
        return False
    if not isinstance(path, str):
        return False
    try:
        with open(path, encoding="utf-8") as f:
            config: object = yaml.safe_load(f)
    except (OSError, yaml.YAMLError):
        return False
    if not isinstance(config, dict):
        return False
    model_type = cast("object", config.get("model_type"))  # pyright: ignore[reportUnknownMemberType]  -- yaml.safe_load is Any-typed
    return isinstance(model_type, str) and model_type in WAYPOINT_MODEL_TYPES


def _scan_cache() -> tuple[dict[str, int], set[str]]:
    """Scan the local HF hub cache. Returns `(cached_sizes,
    waypoint_shaped_repos)` where `cached_sizes` maps every cached
    model repo's id to its world-engine model size in bytes (the
    safetensors weight files, mirroring `_resolve_model_size`'s filter
    so on-disk and HF-derived sizes agree), and the second set filters
    that to the subset whose `config.yaml` declares a Waypoint
    `model_type`. Both empty on scan failure; never raises."""
    try:
        info = scan_cache_dir()
    except Exception as e:  # noqa: BLE001  -- scan_cache_dir raises a wide grab-bag (CacheNotFound, OSError); soft-fall to empty
        logger.warning(f"scan_cache_dir failed: {e}")
        return {}, set()
    cached_sizes: dict[str, int] = {}
    waypoint_ids: set[str] = set()
    for repo in info.repos:
        if repo.repo_type != "model":
            continue
        # Sum model-size files across all snapshots of this repo,
        # deduplicated by blob path so multiple revisions sharing the
        # same blob don't double-count.
        seen_blobs: set[Path] = set()
        total = 0
        for revision in repo.revisions:
            for f in revision.files:
                if f.blob_path in seen_blobs:
                    continue
                if not _counts_toward_model_size(f.file_name):
                    continue
                seen_blobs.add(f.blob_path)
                total += f.size_on_disk
        cached_sizes[repo.repo_id] = total
        if _is_cached_waypoint_model(repo.repo_id):
            waypoint_ids.add(repo.repo_id)
    return cached_sizes, waypoint_ids


def _resolve_model_size(model_id: str) -> ModelSize:
    """Sum the world-engine-model-size files from HuggingFace's metadata.
    Mirrors the on-disk computation in `_scan_cache` (same filter,
    same dedup-by-blob) so cached and uncached entries report
    comparable numbers. Soft-fails to `size_bytes=None` on every error
    path — the picker just shows no size badge for that row."""
    try:
        info = hf_model_info(model_id, files_metadata=True)
    except (GatedRepoError, RepositoryNotFoundError):
        return ModelSize(size_bytes=None)
    except Exception as e:  # noqa: BLE001  # pyright: ignore[reportUnusedExcept]  -- HF client raises a wide grab-bag (HTTPError/RequestException/HfHubHTTPError) that pyright's stubs don't model; fold them all into a soft response
        logger.warning(f"model-info error for {model_id}: {e}")
        return ModelSize(size_bytes=None)

    if not (hasattr(info, "siblings") and info.siblings):
        return ModelSize(size_bytes=None)

    seen_blobs: set[str] = set()
    total = 0
    for s in info.siblings:
        if s.size is None or not _counts_toward_model_size(s.rfilename):
            continue
        blob_key = getattr(s, "blob_id", None) or s.rfilename
        if blob_key in seen_blobs:
            continue
        seen_blobs.add(blob_key)
        total += s.size

    return ModelSize(size_bytes=total or None)


async def _get_size(model_id: str, cache: TtlCache[str, ModelSize]) -> ModelSize:
    cached = cache.get(model_id)
    if cached is not None:
        return cached
    size = await asyncio.to_thread(_resolve_model_size, model_id)
    cache.set(model_id, size)
    return size


async def _fetch_waypoint_ids(cache: TtlCache[str, list[str]]) -> list[str]:
    """The curated Waypoint collection from HuggingFace. Falls back to the
    default model alone on any error so the picker is never empty; only
    successful fetches are cached, so a transient HF outage doesn't pin
    the picker at the default for the full TTL."""
    cached = cache.get(WAYPOINT_COLLECTION_SLUG)
    if cached is not None:
        return cached

    def _fetch() -> list[str] | None:
        try:
            collection = get_collection(WAYPOINT_COLLECTION_SLUG)
        except Exception as e:  # noqa: BLE001  -- HF client raises a wide grab-bag (HTTP/auth/cache); soft-fall to the default
            logger.warning(f"waypoint collection fetch failed: {e}")
            return None
        return [item.item_id for item in collection.items if item.item_type == "model"]

    fetched = await asyncio.to_thread(_fetch)
    if fetched is None:
        return [DEFAULT_WORLD_ENGINE_MODEL]
    result = fetched or [DEFAULT_WORLD_ENGINE_MODEL]
    cache.set(WAYPOINT_COLLECTION_SLUG, result)
    return result


@router.get("/api/models")
async def list_models(
    size_cache: Annotated[TtlCache[str, ModelSize], Depends(get_model_size_cache)],
    waypoint_cache: Annotated[TtlCache[str, list[str]], Depends(get_waypoint_models_cache)],
) -> list[PickerModel]:
    """Canonical world-model picker list.

    Returns the union of:
      - the curated Waypoint collection (always shown, regardless of cache state), and
      - cached repos whose `config.yaml` declares a Waypoint `model_type`
        (admits dev variants the user trained outside the collection)

    Each entry carries its size and a cache-presence flag. The renderer
    consumes this list directly — no client-side HuggingFace lookups,
    no separate availability / sizing round-trips, no manual "type a
    custom id" path. Non-world-model cache entries (safety classifier,
    scene-authoring image generators, etc.) coexist in the same HF
    cache root and are deliberately excluded.

    Sort order: cached models first, then the rest alphabetically by id;
    stable so the picker doesn't reshuffle between renders. The HF size
    lookup per id is TTL-cached; the cache scan is fresh on every call
    so a just-deleted model disappears immediately."""
    cached_sizes, waypoint_cached_ids = await asyncio.to_thread(_scan_cache)
    waypoint_collection_ids = set(await _fetch_waypoint_ids(waypoint_cache))

    picker_ids = sorted(
        waypoint_collection_ids | waypoint_cached_ids,
        key=lambda i: (i not in cached_sizes, i.lower()),
    )

    # Cached entries: take size straight from the on-disk scan, no HF
    # round-trip. Not-yet-downloaded entries (Waypoint collection that
    # the user hasn't pulled yet): fall back to HF metadata for an
    # estimated download size, TTL-cached so repeat picker opens don't
    # re-resolve.
    not_cached = [id_ for id_ in picker_ids if id_ not in cached_sizes]
    fetched_sizes = await asyncio.gather(*(_get_size(id_, size_cache) for id_ in not_cached))
    hf_sizes = dict(zip(not_cached, (s.size_bytes for s in fetched_sizes), strict=True))

    return [
        PickerModel(
            id=id_,
            size_bytes=cached_sizes[id_] if id_ in cached_sizes else hf_sizes.get(id_),
            is_local=id_ in cached_sizes,
        )
        for id_ in picker_ids
    ]


@router.delete("/api/cached-model/{model_id:path}", status_code=204)
async def delete_cached_model(model_id: str) -> None:
    """Remove a model from the local HF hub cache. No-op if not present.

    The HF hub cache layout uses symlinks inside `snapshots/` that point
    to `../blobs/`; removing the whole `models--<repo>` directory drops
    blobs + snapshots + refs together, which is safe because each model
    occupies an isolated directory."""

    def _delete() -> None:
        hub_dir = Path(hf_constants.HF_HUB_CACHE)
        model_dir = hub_dir / f"models--{model_id.replace('/', '--')}"
        if model_dir.exists():
            shutil.rmtree(model_dir)

    await asyncio.to_thread(_delete)


@router.get("/api/system-info")
async def get_system_info(request: Request) -> SystemInfo:
    """Static hardware identity captured once at process startup.

    Same shape as the `SystemInfoMessage` push the WS endpoint emits
    after handshake — exposed over HTTP so the renderer can read it
    pre-WS (for the device-info panel and quantisation gating) without
    needing a live session."""
    monitor: SystemMonitor = request.app.state.system_monitor
    return monitor.info


# ============================================================================
# WorldEngine WebSocket
# ============================================================================


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    startup: Annotated[ServerStartup, Depends(get_startup_ws)],
    system_monitor: Annotated[SystemMonitor, Depends(get_system_monitor_ws)],
):
    """Per-connection lifecycle. Reads top-to-bottom as one phase per call.

    The wire format is the Pydantic discriminated union in `protocol.py`
    (`ClientMessage` / `ServerPushMessage`); the `MessageId` enum carries
    every translatable error key. Each phase's internals live in the
    module named after the phase — see this file's docstring for the map.
    """
    client_host = websocket.client.host if websocket.client else "unknown"
    # Bind `client_host` as a contextvar so every log line emitted from any
    # code reachable in this connection's asyncio task carries it
    # automatically. The generator thread (spawned via ThreadPoolExecutor in
    # `run_session`) is wired up separately — it copies the context at
    # submit time so logs from device-thread code stay attributed.
    with bound_contextvars(client_host=client_host):
        logger.info("Client connected")
        conn = Connection(websocket=websocket, client_host=client_host, system_monitor=system_monitor)
        await websocket.accept()

        # Reject mismatched clients before any other phase runs so the UI
        # can surface a localised "update Biome" error. The check happens
        # after `accept()` so the rejection rides on a typed `error` push;
        # a handshake-time refusal would only give the renderer a generic
        # "WebSocket connection failed" with no version detail.
        client_version_raw = websocket.query_params.get("protocol_version")
        try:
            client_version = int(client_version_raw) if client_version_raw is not None else None
        except ValueError:
            client_version = None
        if client_version != PROTOCOL_VERSION:
            logger.warning(
                "Protocol version mismatch — closing connection",
                client_version=client_version_raw,
                server_version=PROTOCOL_VERSION,
            )
            await conn.send_error(
                message_id=MessageId.PROTOCOL_VERSION_MISMATCH,
                params={"client": client_version_raw or "unknown", "server": str(PROTOCOL_VERSION)},
            )
            await websocket.close()
            return

        # Single-session gate: the shared `WorldEngine` is single-tenant
        # (rolling frame history, seed slot, progress callback are all
        # process-wide singletons), so a second concurrent client would
        # interleave inputs into the same frame stream and produce
        # incoherent output for both. Reject with a typed error and
        # close. The check + claim are both synchronous, so no two
        # concurrent handshakes can both pass under asyncio's
        # cooperative scheduling.
        if websocket.app.state.active_session is not None:
            logger.warning("Rejecting client: another session is active")
            await conn.send_error(message_id=MessageId.SERVER_BUSY)
            await websocket.close()
            return
        websocket.app.state.active_session = conn

        log_task = asyncio.create_task(stream_logs_to_client(conn))
        progress_task: asyncio.Task[None] | None = None
        # Bound after the startup gate so `teardown`'s callback-clear can no-op
        # safely when we tear down before the engines are ready.
        engines: Engines | None = None

        try:
            # Phase 1: ensure engines are loaded (idempotent — first connect
            # after process start does the heavy GPU-stack import + manager
            # construction, subsequent connects find them already on
            # `app.state.engines`). The init runs as a sibling task so
            # `replay_to` can stream STARTUP_* stages out as they fire.
            init_task = asyncio.create_task(startup.ensure_engines_loaded(websocket.app))
            try:
                await startup.replay_to(conn)
            finally:
                # `replay_to` only returns once `mark_done`/`mark_failed` fires,
                # which happens at the end of the init body — so the task is
                # already finished. The await is just for tidiness on the
                # cancellation path.
                if not init_task.done():
                    await init_task
            if startup.error:
                await conn.send_error(message_id=MessageId.SERVER_STARTUP_FAILED, message=str(startup.error))
                return

            # Past the startup gate: engines are populated.
            engines = get_engines_ws(websocket)
            world_engine = engines.world_engine

            # Phase 2: hardware identity goes out immediately so the client has
            # it even if init crashes (e.g. device-graph compilation failure).
            # Reset the seed so this session must perform an explicit handshake.
            await conn.send_message(SystemInfoMessage(**system_monitor.info.model_dump()))
            world_engine.seed_frame = None
            progress_task = asyncio.create_task(conn.run_progress_drain())

            # Phase 3: pre-init message dispatch — wait for an InitRequest that
            # loads a seed frame (or 60 s timeout).
            if not await run_preinit_handshake(conn, world_engine, engines.safety_checker):
                return

            # Phase 4: scene-authoring + engine warmup, init session, send
            # initial frame. Surfaces typed errors and acks the deferred init
            # RPC on failure so the client always gets a definitive response.
            if not await prepare_session(conn, world_engine, engines.scene_authoring):
                return

            await conn.send_stage(StageId.SESSION_READY)
            logger.info("Ready for game loop")

            # Phase 5: open recorder segments, ack the deferred init RPC.
            conn.start_recording_segments(world_engine)
            if conn.init_req_id:
                await conn.send_message(
                    rpc_ok(conn.init_req_id, build_init_response_data(world_engine, system_monitor.info))
                )
                conn.init_req_id = None

            # Phase 6: the game loop. Spawns the gen thread + receiver/sender
            # asyncio tasks; returns once any of them exits (which signals
            # disconnect or terminal error).
            await run_session(conn, engines)

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except Exception as e:
            # Uvicorn may surface client close as ClientDisconnected instead
            # of WebSocketDisconnect — treat both as normal disconnects to
            # avoid noisy tracebacks during intentional reconnects.
            if e.__class__.__name__ == "ClientDisconnected":
                logger.info("Client disconnected")
            else:
                logger.exception("WebSocket endpoint error")
                with contextlib.suppress(Exception):
                    await conn.send_error(message=str(e))
        finally:
            # Identity check: only release the slot if we're still the
            # session that claimed it. (We will always be — the gate
            # above is the only way to enter this try block — but the
            # check makes the intent explicit.)
            if websocket.app.state.active_session is conn:
                websocket.app.state.active_session = None
            world_engine_for_teardown = engines.world_engine if engines is not None else None
            conn.teardown(world_engine_for_teardown, log_task, progress_task)
