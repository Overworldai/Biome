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
from typing import TYPE_CHECKING, Annotated, Literal, cast

import structlog
import yaml
from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from huggingface_hub import constants as hf_constants
from huggingface_hub import (
    get_collection,
    hf_hub_download,  # pyright: ignore[reportUnknownVariableType]  -- partial stubs for the `dry_run` overload bleed `Unknown` through
    scan_cache_dir,
    try_to_load_from_cache,
)
from huggingface_hub import model_info as hf_model_info
from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError
from pydantic import BaseModel
from structlog.contextvars import bound_contextvars

from engine import Engines
from engine.manager import ServerCapabilities, supported_capabilities
from server.caches import TtlCache
from server.protocol import (
    PROTOCOL_VERSION,
    EngineBackend,
    MessageId,
    StageId,
    SystemInfo,
    SystemInfoMessage,
    rpc_ok,
)
from server.session.connection import Connection
from server.session.handlers import build_init_response_data, prepare_session, run_preinit_handshake
from server.session.workers import run_session
from server.startup import ServerStartup
from util.server_logging import stream_logs_to_client
from util.system_info import SystemMonitor

if TYPE_CHECKING:
    import uvicorn

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
    UI and to clamp dropdowns (backend, quant) against what the server
    can actually run; the frontend checks reachability via the request
    itself, so the response shape is for the engine-status panel +
    `ServerCapabilities` only."""

    status: Literal["ok"] = "ok"
    startup_complete: bool
    world_engine: WorldEngineHealth
    safety: SafetyHealth
    capabilities: ServerCapabilities
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
    directly.

    `model_type` is the `model_type:` field from the repo's
    ``config.yaml`` — used by the renderer to validate the saved
    model id against the in-flight backend selection (quark only
    supports `waypoint-1.5`). `None` means the lookup failed (offline,
    HF outage, malformed config); the renderer treats it as
    backend-agnostic so a degraded path doesn't lock out the picker."""

    id: str
    size_bytes: int | None
    is_local: bool
    model_type: str | None = None


class ModelInfoResponse(BaseModel):
    """Body of `GET /api/model-info/{model_id}`. Mirrors the `ModelInfo`
    TS type in `src/types/ipc.ts`. Used by the renderer to validate a
    user-typed custom model id against HuggingFace before pinning it
    into the picker — the curated `/api/models` route only knows about
    repos in the Waypoint collection plus the local cache, so anything
    else has to round-trip through here for a yes/no on existence,
    a size estimate, and whether the repo is already cached locally
    (so the picker can show the cache-delete affordance on custom
    rows the same as it does on curated ones).

    `exists` carries the yes/no; `error` is the user-facing reason
    when something's off (gated repo, not found, transient HF failure).
    Transient failures are returned with `exists=True` so the renderer
    doesn't lock the user out for a flaky network — they're free to
    retry."""

    id: str
    size_bytes: int | None
    exists: bool
    is_local: bool
    error: str | None


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

# Per-backend support matrix used by the `/api/models?backend=…` filter.
# `None` is the in-band sentinel for "universal" — the backend accepts
# any Waypoint variant we'd surface in the picker, including collection
# entries whose `config.yaml` is missing `model_type:` (treated as
# trusted-by-curation). A `set[str]` restricts to the listed types and
# strict-drops unknowns that originate from the curated collection.
#
# `world_engine` is universal: the legacy loader handles every Waypoint
# variant we ship. `quark` is restrictive: it only implements the
# wp-1.5 path today and raises NotImplementedError on wp-1 configs
# (no TAEHV VAE, different scheduler shape).
COMPATIBLE_MODEL_TYPES_BY_BACKEND: dict[EngineBackend, set[str] | None] = {
    EngineBackend.WORLD_ENGINE: None,
    EngineBackend.QUARK: {"waypoint-1.5"},
}

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


def get_model_type_cache(request: Request) -> TtlCache[str, str]:
    cache: TtlCache[str, str] = request.app.state.model_type_cache
    return cache


def get_model_info_cache(request: Request) -> TtlCache[str, "ModelInfoResponse"]:
    cache: TtlCache[str, ModelInfoResponse] = request.app.state.model_info_cache
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
        capabilities=supported_capabilities(),
        launched_from_standalone=launched_from_standalone,
    )


class ShutdownResponse(BaseModel):
    status: Literal["shutting_down", "already_shutting_down"]


class ShutdownUnavailableError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("uvicorn_server is not attached to app.state; cannot signal graceful shutdown")


@router.post("/shutdown")
async def shutdown(request: Request) -> ShutdownResponse:
    """Signal the uvicorn server to exit on its next tick. The route returns
    before the loop actually unwinds so the launcher gets an HTTP 200; the
    lifespan teardown then runs as uvicorn drains. Localhost-only because
    that's how the server is bound — any local process can also `kill -9`
    us, so this isn't a new attack surface.

    No-op (idempotent `already_shutting_down`) if the flag is already set,
    so a launcher that retries doesn't see a confusing error."""
    server_obj = getattr(request.app.state, "uvicorn_server", None)
    if server_obj is None:
        # Lifespan-loaded apps under `uvicorn.run(app)` don't expose the
        # Server object; main.py wires one up explicitly precisely so this
        # endpoint works. If we ever lose that wiring, fail loudly rather
        # than silently no-op'ing the launcher's only graceful path.
        raise ShutdownUnavailableError
    server = cast("uvicorn.Server", server_obj)
    if server.should_exit:
        return ShutdownResponse(status="already_shutting_down")
    logger.info("Shutdown requested via /shutdown endpoint")
    server.should_exit = True
    return ShutdownResponse(status="shutting_down")


def _read_model_type(path: str) -> str | None:
    """Parse `model_type` out of a local `config.yaml`. Returns `None`
    on any read / parse failure or when the field is missing / wrong
    type. Used by both the cache-side admission check and the HF
    fallback in `_resolve_model_type`."""
    try:
        with open(path, encoding="utf-8") as f:
            config: object = yaml.safe_load(f)
    except (OSError, yaml.YAMLError):
        return None
    if not isinstance(config, dict):
        return None
    model_type = cast("object", config.get("model_type"))  # pyright: ignore[reportUnknownMemberType]  -- yaml.safe_load is Any-typed
    return model_type if isinstance(model_type, str) else None


def _cached_model_type(repo_id: str) -> str | None:
    """`model_type` from the repo's locally-cached `config.yaml`, or
    `None` if no cached copy exists / the file is unreadable. Used by
    `_scan_cache` to admit waypoint-shaped cached repos into the picker
    without re-fetching from HF."""
    try:
        path = try_to_load_from_cache(repo_id, "config.yaml")
    except Exception:  # noqa: BLE001  -- try_to_load_from_cache can raise on OS-level cache issues; treat as "no cached config"
        return None
    if not isinstance(path, str):
        return None
    return _read_model_type(path)


def _scan_cache() -> tuple[dict[str, int], dict[str, str]]:
    """Scan the local HF hub cache. Returns `(cached_sizes,
    waypoint_model_types)`. `cached_sizes` maps every cached model
    repo's id to its world-engine model size in bytes (safetensors
    weight files, mirroring `_resolve_model_size`'s filter so on-disk
    and HF-derived sizes agree). `waypoint_model_types` is the subset
    of cached repos whose `config.yaml` declares a Waypoint
    `model_type`, mapped to that string — the picker uses the value
    for per-backend compatibility filtering. Both empty on scan
    failure; never raises."""
    try:
        info = scan_cache_dir()
    except Exception as e:  # noqa: BLE001  -- scan_cache_dir raises a wide grab-bag (CacheNotFound, OSError); soft-fall to empty
        logger.warning(f"scan_cache_dir failed: {e}")
        return {}, {}
    cached_sizes: dict[str, int] = {}
    waypoint_model_types: dict[str, str] = {}
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
        # A repo with no weight files isn't actually usable — most often
        # this is a config-only directory left behind by `_resolve_model_type`'s
        # `hf_hub_download(filename="config.yaml")` call. Treating it as
        # cached would surface a 0-byte "local" row in the picker. Drop
        # it; the picker falls back to the HF size lookup and shows it
        # as a downloadable entry.
        if total == 0:
            continue
        cached_sizes[repo.repo_id] = total
        mt = _cached_model_type(repo.repo_id)
        if mt is not None and mt in WAYPOINT_MODEL_TYPES:
            waypoint_model_types[repo.repo_id] = mt
    return cached_sizes, waypoint_model_types


def _resolve_model_type(model_id: str) -> str | None:
    """`model_type` for `model_id`, fetched on demand for non-cached
    collection entries. Tries the local HF cache first; falls back to
    downloading `config.yaml` (small file, ~1KB) via `hf_hub_download`.
    Returns `None` on any failure — the picker treats `None` as
    backend-agnostic so a degraded path doesn't hide rows entirely."""
    local = _cached_model_type(model_id)
    if local is not None:
        return local
    try:
        path = hf_hub_download(repo_id=model_id, filename="config.yaml")
    except (GatedRepoError, RepositoryNotFoundError):
        return None
    except Exception as e:  # noqa: BLE001  -- HF client raises a wide grab-bag (HTTP/auth/cache); soft-fall
        logger.warning(f"config.yaml fetch failed for {model_id}: {e}")
        return None
    return _read_model_type(path)


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
    return await cache.get_or_fetch(model_id, lambda: asyncio.to_thread(_resolve_model_size, model_id))


# Sentinel used to distinguish "TTL cache holds a real `None` (lookup
# failed)" from "cache miss". `TtlCache.get` already returns `None` for
# missing entries, so we can't store `None` directly — the cache stores
# the sentinel string instead, and `_get_model_type` translates it back
# at the API boundary.
_MODEL_TYPE_UNKNOWN = "__unknown__"


async def _get_model_type(model_id: str, cache: TtlCache[str, str]) -> str | None:
    """TTL-cached wrapper around `_resolve_model_type`. Stores the
    sentinel `_MODEL_TYPE_UNKNOWN` for resolution failures so the
    cache hit distinguishes "tried and couldn't resolve" from miss."""

    async def fetcher() -> str:
        resolved = await asyncio.to_thread(_resolve_model_type, model_id)
        return resolved if resolved is not None else _MODEL_TYPE_UNKNOWN

    result = await cache.get_or_fetch(model_id, fetcher)
    return None if result == _MODEL_TYPE_UNKNOWN else result


async def _fetch_waypoint_ids(cache: TtlCache[str, list[str]]) -> list[str]:
    """The curated Waypoint collection from HuggingFace. Falls back to the
    default model alone on any error so the picker is never empty; only
    successful fetches are cached, so a transient HF outage doesn't pin
    the picker at the default for the full TTL."""

    async def fetcher() -> list[str]:
        def _fetch() -> list[str]:
            # `token=False` forces an anonymous request. The collection is
            # public curated metadata, so listing it must not depend on
            # whatever HF token the host happens to have cached — a
            # fine-grained/restricted token (e.g. one scoped only for
            # uploads) authenticates but lacks "read collections" and gets
            # a 403, whereas anonymous access succeeds. Decoupling from the
            # ambient token keeps the picker populated for every user.
            collection = get_collection(WAYPOINT_COLLECTION_SLUG, token=False)
            return [item.item_id for item in collection.items if item.item_type == "model"]

        fetched = await asyncio.to_thread(_fetch)
        return fetched or [DEFAULT_WORLD_ENGINE_MODEL]

    try:
        return await cache.get_or_fetch(WAYPOINT_COLLECTION_SLUG, fetcher)
    except Exception as e:  # noqa: BLE001  -- HF client raises a wide grab-bag (HTTP/auth/cache); soft-fall and don't cache
        logger.warning(f"waypoint collection fetch failed: {e}")
        return [DEFAULT_WORLD_ENGINE_MODEL]


@router.get("/api/models")
async def list_models(
    size_cache: Annotated[TtlCache[str, ModelSize], Depends(get_model_size_cache)],
    waypoint_cache: Annotated[TtlCache[str, list[str]], Depends(get_waypoint_models_cache)],
    model_type_cache: Annotated[TtlCache[str, str], Depends(get_model_type_cache)],
    backend: EngineBackend | None = None,
) -> list[PickerModel]:
    """Canonical world-model picker list.

    Returns the union of:
      - the curated Waypoint collection (always shown, regardless of cache state), and
      - cached repos whose `config.yaml` declares a Waypoint `model_type`
        (admits dev variants the user trained outside the collection)

    Each entry carries its size, cache-presence flag, and resolved
    `model_type` so the renderer can surface a "this model needs a
    different backend" message even for ids that survived the
    server-side filter via the `None` (unknown) sentinel. The renderer
    consumes this list directly — no client-side HuggingFace lookups,
    no separate availability / sizing round-trips, no manual "type a
    custom id" path. Non-world-model cache entries (safety classifier,
    scene-authoring image generators, etc.) coexist in the same HF
    cache root and are deliberately excluded.

    When `backend` is supplied, rows whose `model_type` is known and
    incompatible with that backend are dropped (`quark` → only
    `waypoint-1.5`; `world_engine` → the full Waypoint set). Rows
    whose `model_type` couldn't be resolved (offline / HF outage /
    malformed config) pass through — better to show a row that fails
    at load than to hide it silently.

    Sort order: cached models first, then the rest alphabetically by id;
    stable so the picker doesn't reshuffle between renders. The HF size
    and model_type lookups per id are TTL-cached; the cache scan is
    fresh on every call so a just-deleted model disappears immediately."""
    cached_sizes, waypoint_cached_model_types = await asyncio.to_thread(_scan_cache)
    waypoint_collection_ids = set(await _fetch_waypoint_ids(waypoint_cache))

    picker_ids = sorted(
        waypoint_collection_ids | set(waypoint_cached_model_types),
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

    # Model-type lookup: cached repos already resolved during the
    # scan; collection-only entries get an on-demand HF fetch
    # (TTL-cached). Runs in parallel with the size fetches above on
    # cache miss; both are HF metadata round-trips that benefit from
    # interleaving.
    not_cached_locally = [id_ for id_ in picker_ids if id_ not in waypoint_cached_model_types]
    fetched_types = await asyncio.gather(*(_get_model_type(id_, model_type_cache) for id_ in not_cached_locally))
    hf_model_types = dict(zip(not_cached_locally, fetched_types, strict=True))

    def _model_type(id_: str) -> str | None:
        return waypoint_cached_model_types.get(id_) or hf_model_types.get(id_)

    compatible_types = COMPATIBLE_MODEL_TYPES_BY_BACKEND.get(backend) if backend is not None else None

    def _is_compatible(id_: str) -> bool:
        """Decide whether to surface `id_` for the in-flight backend.

        Behaviour:
          - no backend requested, or the requested backend is universal
            (compat set is `None`) → always show
          - resolved `model_type` is in the backend's compat set → show
          - resolved `model_type` is outside the compat set → drop
          - `model_type` couldn't be resolved AND the repo is in the
            curated `Overworld/waypoint` collection → drop, on the
            theory that a missing `model_type:` field on a collection
            entry is a curation gap and surfacing it would just fail
            at load time on a restrictive backend
          - `model_type` couldn't be resolved AND the repo is user-
            provided (cached locally but outside the collection) →
            pass through; we don't presume to classify third-party /
            dev variants
        """
        if compatible_types is None:
            return True
        mt = _model_type(id_)
        if mt is None:
            return id_ not in waypoint_collection_ids
        return mt in compatible_types

    return [
        PickerModel(
            id=id_,
            size_bytes=cached_sizes[id_] if id_ in cached_sizes else hf_sizes.get(id_),
            is_local=id_ in cached_sizes,
            model_type=_model_type(id_),
        )
        for id_ in picker_ids
        if _is_compatible(id_)
    ]


@router.get("/api/model-info/{model_id:path}")
async def get_model_info(
    model_id: str,
    cache: Annotated[TtlCache[str, ModelInfoResponse], Depends(get_model_info_cache)],
) -> ModelInfoResponse:
    """Validate a user-typed custom model id against HuggingFace.

    Used by the settings panel's "custom model" affordance: the user
    types a repo id, we check that it exists, gate or no-gate, and
    report back a size estimate so the picker can show it alongside
    the curated entries. `/api/models` is the canonical list for the
    Waypoint collection + local cache; anything outside that has to
    round-trip through here for the existence yes/no.

    Stable error states (gated, not-found) are cached so a repeated
    settings-panel open doesn't burn HF requests on the same bad id.
    Transient failures aren't cached — those should retry naturally.
    Sizes mirror `_resolve_model_size`'s filter (safetensors-only,
    diffusers VAE excluded) so a custom row's size aligns with the
    curated rows on the same picker."""

    # Targeted cache probe — `try_to_load_from_cache` returning a string
    # path (vs `None` / the `_CACHED_NO_EXIST` sentinel) is the
    # huggingface_hub-blessed way to ask "is this repo's config.yaml
    # actually present on disk" without a full `scan_cache_dir` walk.
    # We treat the presence of the config as the repo being cached,
    # mirroring the membership rule `_scan_cache` uses.
    def _is_locally_cached() -> bool:
        try:
            path = try_to_load_from_cache(model_id, "config.yaml")
        except Exception:  # noqa: BLE001  -- OS-level cache issues; treat as "not cached"
            return False
        return isinstance(path, str)

    def _fetch_sync() -> ModelInfoResponse:
        try:
            info = hf_model_info(model_id, files_metadata=True)
        except GatedRepoError:
            return ModelInfoResponse(
                id=model_id, size_bytes=None, exists=True, is_local=False, error="Private or gated model"
            )
        except RepositoryNotFoundError:
            return ModelInfoResponse(
                id=model_id, size_bytes=None, exists=False, is_local=False, error="Model not found"
            )
        size_bytes: int | None = None
        if hasattr(info, "siblings") and info.siblings:
            seen_blobs: set[str] = set()
            for s in info.siblings:
                if s.size is None or not _counts_toward_model_size(s.rfilename):
                    continue
                blob_key = getattr(s, "blob_id", None) or s.rfilename
                if blob_key in seen_blobs:
                    continue
                seen_blobs.add(blob_key)
                size_bytes = (size_bytes or 0) + s.size
        return ModelInfoResponse(
            id=model_id,
            size_bytes=size_bytes,
            exists=True,
            is_local=_is_locally_cached(),
            error=None,
        )

    try:
        return await cache.get_or_fetch(model_id, lambda: asyncio.to_thread(_fetch_sync))
    except Exception as e:  # noqa: BLE001  # pyright: ignore[reportUnusedExcept]  -- HF client raises a wide grab-bag (HTTPError/RequestException/HfHubHTTPError) that pyright's stubs don't model; fold them all into a soft response
        logger.warning(f"model-info error for {model_id}: {e}")
        # Transient — return without caching so the next call retries.
        return ModelInfoResponse(
            id=model_id, size_bytes=None, exists=True, is_local=False, error="Could not check model"
        )


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

        # Phase 4 (`prepare_session`) does most of its heavy work via
        # `asyncio.to_thread`, which doesn't yield enough for the main
        # task to notice a client-side WS close until the in-flight
        # to_thread returns. The two helper tasks below (`log_task`,
        # `progress_task`) both send periodically; when the WS dies
        # their next `send_text` raises and they exit. We catch that
        # via a done callback that cancels the main handler so its
        # `finally` block can release `active_session` promptly — new
        # connections then succeed instead of bouncing off the single-
        # session gate while the orphan warmup finishes on its thread.
        main_task = asyncio.current_task()

        def on_helper_done(task: asyncio.Task[None]) -> None:
            if task.cancelled():
                return  # cancelled by us during teardown — not a disconnect signal
            if main_task is None or main_task.done():
                return
            logger.info("WS helper task ended unexpectedly — cancelling main handler")
            main_task.cancel()

        log_task = asyncio.create_task(stream_logs_to_client(conn))
        log_task.add_done_callback(on_helper_done)
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
            progress_task.add_done_callback(on_helper_done)

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
        except asyncio.CancelledError:
            # Tripped by `on_helper_done` when the WS dies during a
            # `to_thread`-heavy phase. Treat as a clean disconnect: fall
            # through to `finally` so `active_session` clears immediately.
            logger.info("WebSocket handler cancelled — client likely disconnected")
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
