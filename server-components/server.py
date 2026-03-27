"""
Biome <> Python Communication Bridge

Low-latency WebSocket server that orchestrates WorldEngine and Safety modules.
This server acts as a unified interface for both world generation and safety checking.

Usage:
    python server.py --host 0.0.0.0 --port 7987

Client connects via WebSocket to ws://localhost:7987/ws
"""

# Immediate startup logging before any imports that could fail
import sys

print(f"[BIOME] Python {sys.version}", flush=True)
print(f"[BIOME] Starting server...", flush=True)

import asyncio
import base64
import faulthandler
import hashlib
import json
import logging
import os
import pickle
import shutil
import signal
import struct
import threading
import time
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from queue import Empty, Queue
from typing import Optional

from huggingface_hub import model_info as hf_model_info
from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

# Resolve HuggingFace token: env var > CLI-cached token file.
# Biome overrides HF_HOME to keep model cache inside world_engine/, which means
# the huggingface_hub library won't find the user's default token at
# ~/.cache/huggingface/token. We check multiple locations to match the Electron
# side's resolution order.


def resolve_hf_token() -> Optional[str]:
    """Resolve HuggingFace token from env vars and well-known file locations.

    Mirrors the Electron-side getHfToken() resolution order so both paths
    find the same token regardless of HF_HOME overrides.
    """
    # 1. HF_TOKEN env var
    token = os.environ.get("HF_TOKEN")
    if token:
        return token
    # 2. Deprecated HUGGING_FACE_HUB_TOKEN env var
    token = os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token:
        return token
    # 3. File at HF_TOKEN_PATH env var
    token_path_env = os.environ.get("HF_TOKEN_PATH")
    if token_path_env:
        p = Path(token_path_env)
        if p.is_file():
            t = p.read_text().strip()
            if t:
                return t
    # 4. File at real user HF_HOME/token (use XDG_CACHE_HOME or ~/.cache,
    #    NOT the overridden HF_HOME which points into world_engine/)
    xdg = os.environ.get("XDG_CACHE_HOME")
    if xdg:
        p = Path(xdg) / "huggingface" / "token"
        if p.is_file():
            t = p.read_text().strip()
            if t:
                return t
    # 5. Default fallback: ~/.cache/huggingface/token
    p = Path.home() / ".cache" / "huggingface" / "token"
    if p.is_file():
        t = p.read_text().strip()
        if t:
            return t
    return None


_resolved_token = resolve_hf_token()
if _resolved_token:
    os.environ["HF_TOKEN"] = _resolved_token
    print(f"[BIOME] HF token resolved and set", flush=True)
else:
    print("[BIOME] Warning: No HuggingFace token found (set HF_TOKEN or run `huggingface-cli login`)", flush=True)

# Reduce CUDA allocator fragmentation during repeated model loads/switches.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("biome_server")

SERVER_LOG_FILE = Path(
    os.environ.get("BIOME_SERVER_LOG_PATH", str(Path(__file__).with_name("server.log")))
)
_log_file_lock = threading.Lock()


class TeeStream:
    """Mirror stdout/stderr to a file while preserving console output."""

    def __init__(self, stream, log_fp):
        self._stream = stream
        self._log_fp = log_fp

    def write(self, data):
        written = self._stream.write(data)
        if data:
            with _log_file_lock:
                self._log_fp.write(data)
                self._log_fp.flush()
        return written

    def flush(self):
        self._stream.flush()
        with _log_file_lock:
            self._log_fp.flush()

    def isatty(self):
        return self._stream.isatty()

    def fileno(self):
        return self._stream.fileno()

    @property
    def encoding(self):
        return getattr(self._stream, "encoding", "utf-8")


# Log file receives both logger output and direct stdout/stderr writes.
SERVER_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
_hosted_log_fp = open(SERVER_LOG_FILE, "w", encoding="utf-8", buffering=1)
sys.stdout = TeeStream(sys.stdout, _hosted_log_fp)
sys.stderr = TeeStream(sys.stderr, _hosted_log_fp)

_file_log_handler = logging.FileHandler(SERVER_LOG_FILE, mode="w", encoding="utf-8")
_file_log_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S"))
logging.getLogger().addHandler(_file_log_handler)


def _install_crash_logging_hooks() -> None:
    """Force uncaught exceptions and fatal interpreter crashes into server.log."""
    try:
        faulthandler.enable(file=_hosted_log_fp, all_threads=True)
    except Exception as e:
        print(f"[BIOME] Failed to enable faulthandler: {e}", file=sys.stderr, flush=True)

    try:
        if hasattr(signal, "SIGTERM") and hasattr(faulthandler, "register"):
            faulthandler.register(signal.SIGTERM, file=_hosted_log_fp, all_threads=True, chain=True)
    except Exception as e:
        print(f"[BIOME] Failed to register SIGTERM faulthandler hook: {e}", file=sys.stderr, flush=True)

    def _log_uncaught_exception(exc_type, exc_value, exc_tb):
        print("[BIOME] Uncaught exception:", file=sys.stderr, flush=True)
        traceback.print_exception(exc_type, exc_value, exc_tb, file=sys.stderr)
        sys.stderr.flush()
        _hosted_log_fp.flush()

    def _log_thread_exception(args):
        print(f"[BIOME] Uncaught thread exception in {args.thread.name}:", file=sys.stderr, flush=True)
        traceback.print_exception(args.exc_type, args.exc_value, args.exc_traceback, file=sys.stderr)
        sys.stderr.flush()
        _hosted_log_fp.flush()

    def _log_unraisable(unraisable):
        print("[BIOME] Unraisable exception:", file=sys.stderr, flush=True)
        traceback.print_exception(
            unraisable.exc_type,
            unraisable.exc_value,
            unraisable.exc_traceback,
            file=sys.stderr,
        )
        if unraisable.err_msg:
            print(f"[BIOME] Unraisable context: {unraisable.err_msg}", file=sys.stderr, flush=True)
        sys.stderr.flush()
        _hosted_log_fp.flush()

    sys.excepthook = _log_uncaught_exception
    threading.excepthook = _log_thread_exception
    sys.unraisablehook = _log_unraisable


_install_crash_logging_hooks()


print("[BIOME] Basic imports done", flush=True)

# If launched with --parent-pid, ask the OS to kill us when the parent dies (Linux only),
# and start a background thread to poll the parent PID as a cross-platform fallback.
_parent_pid: Optional[int] = None


def _check_parent_alive() -> None:
    """Check if the monitored parent process is still alive. Exit if not."""
    if _parent_pid is None:
        return
    try:
        os.kill(_parent_pid, 0)
    except OSError:
        print(f"[BIOME] Parent process (PID {_parent_pid}) is already gone, shutting down", flush=True)
        os._exit(1)


async def _watch_parent_pid() -> None:
    """Periodically check if the parent process is still alive. Exit if it's gone."""
    if _parent_pid is None:
        return
    while True:
        await asyncio.sleep(2)
        try:
            os.kill(_parent_pid, 0)  # Signal 0 = check if process exists
        except OSError:
            print(f"[BIOME] Parent process (PID {_parent_pid}) is gone, shutting down", flush=True)
            os._exit(1)

try:
    print("[BIOME] Importing torch...", flush=True)
    import torch

    print(f"[BIOME] torch {torch.__version__} imported", flush=True)

    print("[BIOME] Importing torchvision...", flush=True)
    import torchvision

    print(f"[BIOME] torchvision {torchvision.__version__} imported", flush=True)

    print("[BIOME] Importing PIL...", flush=True)
    from PIL import Image

    print("[BIOME] PIL imported", flush=True)

    print("[BIOME] Importing FastAPI...", flush=True)
    import uvicorn
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import JSONResponse

    print("[BIOME] FastAPI imported", flush=True)

    print("[BIOME] Importing Engine Manager module...", flush=True)
    from engine_manager import WorldEngineManager, Session, BUTTON_CODES

    print("[BIOME] Engine Manager module imported", flush=True)

    print("[BIOME] Importing progress stages...", flush=True)
    from progress_stages import (
        STARTUP_BEGIN,
        STARTUP_ENGINE_MANAGER,
        STARTUP_SAFETY_CHECKER,
        STARTUP_SAFETY_WARMUP,
        STARTUP_SAFETY_READY,
        STARTUP_SEED_STORAGE,
        STARTUP_SEED_VALIDATION,
        STARTUP_READY,
        SESSION_WAITING_FOR_SEED,
        SESSION_READY,
        Stage,
    )

    print("[BIOME] Progress stages imported", flush=True)

    print("[BIOME] Importing Safety module...", flush=True)
    from safety import SafetyChecker

    print("[BIOME] Safety module imported", flush=True)

except Exception as e:
    print(f"[BIOME] FATAL: Import failed: {e}", flush=True)
    import traceback

    traceback.print_exc()
    sys.exit(1)

# ============================================================================
# Global Module Instances
# ============================================================================

world_engine = None
inpainting_manager = None
safety_checker = None
safe_seeds_cache = {}  # Maps filename -> {hash, is_safe, path}
rescan_lock = None  # Prevent concurrent rescans (initialized in lifespan)

# ============================================================================
# Startup state — shared between lifespan background task and WS clients
# ============================================================================

startup_complete: bool = False
startup_error: Optional[str] = None
startup_stages: list[dict] = []  # accumulated stage messages
# WS clients waiting for startup progress register a Queue here
ws_startup_waiters: list[asyncio.Queue] = []

LOG_TAIL_INITIAL_LINES = 220
LOG_TAIL_POLL_INTERVAL_SECONDS = 0.25


def _read_log_tail_lines(max_lines: int) -> list[str]:
    """Read last non-empty lines from the canonical server log file."""
    if max_lines <= 0:
        return []
    try:
        with open(SERVER_LOG_FILE, "r", encoding="utf-8", errors="replace") as fp:
            lines = [line.rstrip("\r\n") for line in fp if line.strip()]
        return lines[-max_lines:]
    except Exception:
        return []

# ============================================================================
# Seed Management Configuration
# ============================================================================

# Server-side seed storage paths
SEEDS_BASE_DIR = Path(__file__).parent.parent / "world_engine" / "seeds"
DEFAULT_SEEDS_DIR = SEEDS_BASE_DIR / "default"
UPLOADS_DIR = SEEDS_BASE_DIR / "uploads"
DEFAULT_INITIAL_SEED = "default.jpg"
CACHE_FILE = Path(__file__).parent.parent / "world_engine" / ".seeds_cache.bin"

# Local seeds directory (for dev/standalone usage - relative to project root)
LOCAL_SEEDS_DIR = Path(__file__).parent.parent / "seeds"

SUPPORTED_IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")

MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def glob_seeds(directory: Path) -> list[Path]:
    """Glob for all supported image formats in a directory."""
    results = []
    for ext in SUPPORTED_IMAGE_EXTENSIONS:
        results.extend(directory.glob(f"*{ext}"))
    return results


# ============================================================================
# Seed Management Functions
# ============================================================================


def ensure_seed_directories():
    """Create seed directory structure if it doesn't exist."""
    DEFAULT_SEEDS_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Seed directories initialized: {SEEDS_BASE_DIR}")


async def setup_default_seeds():
    """Setup default seeds from local directory (for dev/standalone usage only)."""
    # Check if seeds already exist (bundled by Biome on first run, or from previous setup)
    existing_seeds = glob_seeds(DEFAULT_SEEDS_DIR)
    if existing_seeds:
        logger.info(f"Found {len(existing_seeds)} seed(s) in {DEFAULT_SEEDS_DIR}")
        return

    # For dev/standalone usage: copy from local seeds directory
    local_seeds = glob_seeds(LOCAL_SEEDS_DIR) if LOCAL_SEEDS_DIR.exists() else []
    if local_seeds:
        logger.info(f"Found local seeds directory at {LOCAL_SEEDS_DIR} (development mode)")
        try:
            seed_files = local_seeds
            logger.info(f"Copying {len(seed_files)} local seed files to {DEFAULT_SEEDS_DIR}")

            for seed_file in seed_files:
                dest = DEFAULT_SEEDS_DIR / seed_file.name
                shutil.copy2(seed_file, dest)
                logger.info(f"  Copied {seed_file.name}")

            logger.info("Local seeds copied successfully")
            return
        except Exception as e:
            logger.error(f"Failed to copy local seeds: {e}")

    # No seeds found - error
    logger.error("No seed images found!")
    logger.error(f"Expected seeds in:")
    logger.error(f"  - {DEFAULT_SEEDS_DIR} (bundled by Biome installer)")
    logger.error(f"  - {LOCAL_SEEDS_DIR} (for development mode)")
    logger.error("Please ensure seeds are properly bundled or placed in the appropriate directory")


def load_seeds_cache() -> dict:
    """Load seeds cache from binary file."""
    if not CACHE_FILE.exists():
        logger.info("No cache file found, will create new one")
        return {"files": {}, "last_scan": None}

    try:
        with open(CACHE_FILE, "rb") as f:
            cache = pickle.load(f)
        logger.info(f"Loaded cache with {len(cache.get('files', {}))} seeds")
        return cache
    except Exception as e:
        logger.error(f"Failed to load cache: {e}")
        return {"files": {}, "last_scan": None}


def save_seeds_cache(cache: dict):
    """Save seeds cache to binary file."""
    try:
        with open(CACHE_FILE, "wb") as f:
            pickle.dump(cache, f)
        logger.info(f"Saved cache with {len(cache.get('files', {}))} seeds")
    except Exception as e:
        logger.error(f"Failed to save cache: {e}")


async def rescan_seeds() -> dict:
    """Scan seed directories and run safety checks on all images."""
    logger.info("Starting full seed directory scan...")
    cache = {"files": {}, "last_scan": time.time()}

    # Scan both default and uploads directories
    all_seeds = glob_seeds(DEFAULT_SEEDS_DIR) + glob_seeds(UPLOADS_DIR)
    logger.info(f"Found {len(all_seeds)} seed images")

    if not all_seeds:
        save_seeds_cache(cache)
        logger.info("Scan complete: 0 seeds processed")
        return cache

    # Compute hashes for all files
    logger.info("Computing file hashes...")
    hash_tasks = [asyncio.to_thread(compute_file_hash, str(p)) for p in all_seeds]
    file_hashes = await asyncio.gather(*hash_tasks, return_exceptions=True)

    # Run batch safety check (model loads once, processes in batches, then unloads)
    logger.info("Running batch safety check...")
    image_paths = [str(p) for p in all_seeds]
    safety_results = await asyncio.to_thread(safety_checker.check_batch, image_paths)

    # Build cache from results
    checked_at = time.time()
    for i, seed_path in enumerate(all_seeds):
        filename = seed_path.name
        file_hash = file_hashes[i] if not isinstance(file_hashes[i], Exception) else ""
        safety_result = safety_results[i]

        if isinstance(file_hashes[i], Exception):
            logger.error(f"Failed to hash {filename}: {file_hashes[i]}")
            cache["files"][filename] = {
                "hash": "",
                "is_safe": False,
                "path": str(seed_path),
                "error": str(file_hashes[i]),
                "checked_at": checked_at,
            }
        else:
            cache["files"][filename] = {
                "hash": file_hash,
                "is_safe": safety_result.get("is_safe", False),
                "path": str(seed_path),
                "scores": safety_result.get("scores", {}),
                "checked_at": checked_at,
            }

        status = "SAFE" if safety_result.get("is_safe") else "UNSAFE"
        logger.info(f"  {filename}: {status}")

    save_seeds_cache(cache)
    logger.info(f"Scan complete: {len(cache['files'])} seeds processed")
    return cache


async def validate_and_update_cache() -> dict:
    """
    Validate cached seed data and update as needed.

    Returns:
        Updated cache dict with structure {"files": {...}, "last_scan": timestamp}

    Behavior:
        - Checks if all cached files still exist and hashes match
        - If any hash mismatch detected → triggers full directory rescan
        - If files are missing → removes them from cache
        - If new unchecked files found → scans only those and adds to cache
    """
    logger.info("Validating seed cache...")
    cache = load_seeds_cache()
    cached_files = cache.get("files", {})

    # If cache is empty, do full scan
    if not cached_files:
        logger.info("Cache is empty, performing full scan")
        return await rescan_seeds()

    # Scan directories for all current files
    all_current_files = glob_seeds(DEFAULT_SEEDS_DIR) + glob_seeds(UPLOADS_DIR)
    current_file_map = {p.name: str(p) for p in all_current_files}  # filename -> path
    current_filenames = set(current_file_map.keys())

    # Track validation results
    missing_files = []
    hash_mismatches = []

    logger.info(f"Validating {len(cached_files)} cached entries against {len(current_filenames)} files on disk")

    # Validate each cached entry
    for filename, cached_data in list(cached_files.items()):
        cached_path = cached_data.get("path", "")

        # Check if file still exists
        if not os.path.exists(cached_path):
            logger.info(f"  {filename}: File no longer exists, removing from cache")
            missing_files.append(filename)
            continue

        # Check if hash matches
        cached_hash = cached_data.get("hash", "")
        if not cached_hash:
            # Entry had error during hashing, consider it a mismatch
            logger.info(f"  {filename}: No hash in cache, needs rescan")
            hash_mismatches.append(filename)
            continue

        actual_hash = await asyncio.to_thread(compute_file_hash, cached_path)

        if actual_hash != cached_hash:
            logger.warning(f"  {filename}: Hash mismatch (cached: {cached_hash[:8]}..., actual: {actual_hash[:8]}...)")
            hash_mismatches.append(filename)

    # Remove missing files from cache
    for filename in missing_files:
        del cached_files[filename]

    # If any hash mismatches found, trigger full rescan
    if hash_mismatches:
        logger.warning(f"Hash mismatches detected for {len(hash_mismatches)} file(s), triggering full rescan")
        return await rescan_seeds()

    # Find new unchecked files
    new_filenames = current_filenames - set(cached_files.keys())

    if new_filenames:
        logger.info(f"Found {len(new_filenames)} new unchecked file(s), scanning...")

        # Collect paths for new files
        files_to_scan = [Path(current_file_map[fn]) for fn in new_filenames]

        # Compute hashes
        logger.info("  Computing file hashes...")
        hash_tasks = [asyncio.to_thread(compute_file_hash, str(p)) for p in files_to_scan]
        file_hashes = await asyncio.gather(*hash_tasks, return_exceptions=True)

        # Run batch safety check
        logger.info("  Running batch safety check...")
        image_paths = [str(p) for p in files_to_scan]
        safety_results = await asyncio.to_thread(safety_checker.check_batch, image_paths)

        # Add to cache
        checked_at = time.time()
        for i, seed_path in enumerate(files_to_scan):
            filename = seed_path.name
            file_hash = file_hashes[i] if not isinstance(file_hashes[i], Exception) else ""
            safety_result = safety_results[i]

            if isinstance(file_hashes[i], Exception):
                logger.error(f"  Failed to hash {filename}: {file_hashes[i]}")
                cached_files[filename] = {
                    "hash": "",
                    "is_safe": False,
                    "path": str(seed_path),
                    "error": str(file_hashes[i]),
                    "checked_at": checked_at,
                }
            else:
                cached_files[filename] = {
                    "hash": file_hash,
                    "is_safe": safety_result.get("is_safe", False),
                    "path": str(seed_path),
                    "scores": safety_result.get("scores", {}),
                    "checked_at": checked_at,
                }

            status = "SAFE" if safety_result.get("is_safe") else "UNSAFE"
            logger.info(f"    {filename}: {status}")

    # Update cache if any changes were made
    if missing_files or new_filenames:
        cache["files"] = cached_files
        cache["last_scan"] = time.time()
        save_seeds_cache(cache)
        logger.info(f"Cache updated: {len(missing_files)} removed, {len(new_filenames)} added, {len(cached_files)} total")
    else:
        logger.info("Cache validation complete: All entries valid, no changes needed")

    return cache


# ============================================================================
# Startup broadcast helpers
# ============================================================================


def _broadcast_startup_stage(stage: Stage) -> None:
    """Store a startup stage and push it to any connected WS clients."""
    payload = {
        "type": "status",
        "stage": stage.id,
    }
    startup_stages.append(payload)
    # Also log to stdout so file-based logs capture it
    logger.info(f"Startup stage: {stage.id}")
    for q in list(ws_startup_waiters):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


# ============================================================================
# Application Lifecycle
# ============================================================================


async def _heavy_init() -> None:
    """Run heavy startup work (safety warmup, seed validation) in background."""
    global world_engine, inpainting_manager, safety_checker, safe_seeds_cache, startup_complete, startup_error

    try:
        _broadcast_startup_stage(STARTUP_BEGIN)

        # Initialize modules
        logger.info("Initializing WorldEngine...")
        _broadcast_startup_stage(STARTUP_ENGINE_MANAGER)
        world_engine = WorldEngineManager()

        from inpainting_manager import InpaintingManager
        inpainting_manager = InpaintingManager(world_engine.cuda_executor)

        logger.info("Initializing Safety Checker...")
        _broadcast_startup_stage(STARTUP_SAFETY_CHECKER)
        safety_checker = SafetyChecker()

        # Warmup safety checker
        logger.info("Warming up Safety Checker (first-time model load)...")
        _broadcast_startup_stage(STARTUP_SAFETY_WARMUP)
        warmup_start = time.perf_counter()

        import tempfile
        dummy_img = Image.new('RGB', (64, 64), color='gray')
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
            dummy_img.save(tmp.name)
            dummy_path = tmp.name

        await asyncio.to_thread(safety_checker.check_image, dummy_path)
        os.unlink(dummy_path)

        logger.info(f"Safety Checker warmed up in {time.perf_counter() - warmup_start:.2f}s")
        _broadcast_startup_stage(STARTUP_SAFETY_READY)

        # Initialize seed management
        logger.info("Initializing server-side seed storage...")
        _broadcast_startup_stage(STARTUP_SEED_STORAGE)
        ensure_seed_directories()
        await setup_default_seeds()

        async with rescan_lock:
            _broadcast_startup_stage(STARTUP_SEED_VALIDATION)
            cache = await validate_and_update_cache()

        safe_seeds_cache = cache.get("files", {})

        logger.info("=" * 60)
        logger.info("[SERVER] Ready - Safety loaded, WorldEngine will load on first client")
        logger.info(f"[SERVER] {len(safe_seeds_cache)} seeds available")
        logger.info("=" * 60)
        _broadcast_startup_stage(STARTUP_READY)

        startup_complete = True

        # Signal all waiters that startup is done
        for q in list(ws_startup_waiters):
            try:
                q.put_nowait({"type": "_startup_done"})
            except asyncio.QueueFull:
                pass

    except Exception as exc:
        startup_error = str(exc)
        logger.error(f"[SERVER] Startup failed: {exc}", exc_info=True)
        startup_complete = True  # mark done so waiters unblock
        for q in list(ws_startup_waiters):
            try:
                q.put_nowait({"type": "_startup_done"})
            except asyncio.QueueFull:
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle handler."""
    global rescan_lock

    logger.info("=" * 60)
    logger.info("BIOME SERVER STARTUP")
    logger.info("=" * 60)

    rescan_lock = asyncio.Lock()

    # Start heavy init in background so /health responds immediately
    init_task = asyncio.create_task(_heavy_init())

    # Start parent-process watchdog
    watchdog_task = None
    if _parent_pid is not None:
        watchdog_task = asyncio.create_task(_watch_parent_pid())

    yield

    if watchdog_task is not None:
        watchdog_task.cancel()
    if not init_task.done():
        init_task.cancel()

    logger.info("[SERVER] Shutting down")


app = FastAPI(title="Biome Server", lifespan=lifespan)

# Add CORS middleware to allow frontend requests
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Utilities
# ============================================================================


def compute_file_hash(file_path: str) -> str:
    """Compute SHA256 hash of a file."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


# ============================================================================
# HTTP Endpoints
# ============================================================================


@app.get("/health")
async def health():
    """Health check for Biome backend."""
    return JSONResponse(
        {
            "status": "ok",
            "startup_complete": startup_complete,
            "world_engine": {
                "loaded": world_engine is not None and world_engine.engine is not None,
                "warmed_up": world_engine is not None and world_engine.engine_warmed_up,
                "has_seed": world_engine is not None and world_engine.seed_frame is not None,
            },
            "safety": {"loaded": safety_checker is not None and safety_checker.model is not None},
        }
    )


@app.get("/api/model-info/{model_id:path}")
async def get_model_info(model_id: str):
    """Fetch model metadata from HuggingFace Hub."""
    try:
        info = hf_model_info(model_id, files_metadata=True)
        size_bytes = None
        if hasattr(info, "siblings") and info.siblings:
            st_files = [s for s in info.siblings if s.rfilename.endswith(".safetensors") and s.size is not None]
            # Deduplicate by blob hash to avoid counting symlinked files twice
            seen_blobs = set()
            for s in st_files:
                blob_key = getattr(s, "blob_id", None) or s.rfilename
                if blob_key not in seen_blobs:
                    seen_blobs.add(blob_key)
                    size_bytes = (size_bytes or 0) + s.size
        return JSONResponse({"id": model_id, "size_bytes": size_bytes, "exists": True, "error": None})
    except RepositoryNotFoundError:
        return JSONResponse({"id": model_id, "size_bytes": None, "exists": False, "error": "Model not found"})
    except GatedRepoError:
        return JSONResponse({"id": model_id, "size_bytes": None, "exists": True, "error": "Private or gated model"})
    except Exception as e:
        logger.warning(f"model-info error for {model_id}: {e}")
        return JSONResponse({"id": model_id, "size_bytes": None, "exists": True, "error": "Could not check model"})


# ============================================================================
# Thumbnail helper
# ============================================================================


def _generate_thumbnail_jpeg_bytes(file_path: str, size: int = 300) -> bytes:
    """Generate a square JPEG thumbnail and return bytes."""
    import io

    img = Image.open(file_path)
    img.thumbnail((size, size))

    # Convert to RGB if needed (JPEG doesn't support alpha/palette modes)
    if img.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


# ============================================================================
# WS Request/Response Dispatch
# ============================================================================


class BinaryResponse:
    """Sentinel for RPC handlers that return raw binary data instead of JSON."""
    __slots__ = ("image_bytes",)

    def __init__(self, image_bytes: bytes):
        self.image_bytes = image_bytes


async def dispatch_request(msg: dict, websocket: WebSocket) -> dict | BinaryResponse:
    """Route a request-type WS message to the appropriate handler.

    Returns a response dict (without type/req_id — caller wraps those),
    or a BinaryResponse for image data.
    """
    req_type = msg.get("type", "")

    if req_type == "seeds_list":
        return await _handle_seeds_list()
    elif req_type == "seeds_list_with_thumbnails":
        return await _handle_seeds_list_with_thumbnails(msg)
    elif req_type == "seeds_image":
        return await _handle_seeds_image(msg)
    elif req_type == "seeds_thumbnail":
        return await _handle_seeds_thumbnail(msg)
    elif req_type == "seeds_upload":
        return await _handle_seeds_upload(msg)
    elif req_type == "seeds_delete":
        return await _handle_seeds_delete(msg)
    elif req_type == "seeds_rescan":
        return await _handle_seeds_rescan(msg)
    elif req_type == "model_info":
        return await _handle_model_info(msg)
    elif req_type == "scene_edit_warmup":
        return await _handle_scene_edit_warmup(msg)
    else:
        return {"success": False, "error": f"Unknown request type: {req_type}"}


# ---- individual request handlers ----


async def _handle_seeds_list() -> dict:
    async with rescan_lock:
        pass

    def _uploaded_at(data: dict) -> float:
        file_path = str(data.get("path", ""))
        is_default = not file_path.startswith(str(UPLOADS_DIR))
        if is_default:
            return 0.0
        try:
            if file_path and os.path.exists(file_path):
                return float(os.path.getmtime(file_path))
        except Exception:
            pass
        return float(data.get("checked_at", 0) or 0)

    all_seeds = {
        filename: {
            "filename": filename,
            "hash": data["hash"],
            "is_safe": data.get("is_safe", False),
            "is_default": not str(data.get("path", "")).startswith(str(UPLOADS_DIR)),
            "checked_at": data.get("checked_at", 0),
            "uploaded_at": _uploaded_at(data),
        }
        for filename, data in safe_seeds_cache.items()
    }
    return {"success": True, "data": {"seeds": all_seeds, "count": len(all_seeds)}}


async def _handle_seeds_list_with_thumbnails(msg: dict) -> dict:
    async with rescan_lock:
        pass

    cache_count = len(safe_seeds_cache)
    safe_count = sum(1 for data in safe_seeds_cache.values() if data.get("is_safe", False))
    logger.info(
        "[SEEDS] seeds_list_with_thumbnails: cache=%d safe=%d",
        cache_count,
        safe_count,
    )

    async def build_seed_entry(
        filename: str, data: dict
    ) -> tuple[str, dict]:
        file_path = str(data.get("path", ""))
        is_default = not file_path.startswith(str(UPLOADS_DIR))
        uploaded_at = 0.0
        if not is_default:
            try:
                if file_path and os.path.exists(file_path):
                    uploaded_at = float(os.path.getmtime(file_path))
            except Exception:
                uploaded_at = 0.0
            if uploaded_at <= 0:
                uploaded_at = float(data.get("checked_at", 0) or 0)
        thumbnail_base64: str | None = None

        if file_path and os.path.exists(file_path):
            try:
                thumb_bytes = await asyncio.to_thread(_generate_thumbnail_jpeg_bytes, file_path)
                thumbnail_base64 = base64.b64encode(thumb_bytes).decode("ascii")
            except Exception as exc:
                logger.error(f"Failed to generate thumbnail for {filename}: {exc}")

        return (
            filename,
            {
                "filename": filename,
                "hash": data.get("hash", ""),
                "is_safe": data.get("is_safe", False),
                "is_default": is_default,
                "checked_at": data.get("checked_at", 0),
                "uploaded_at": uploaded_at,
                "thumbnail_base64": thumbnail_base64,
            },
        )

    ordered_items = sorted(safe_seeds_cache.items(), key=lambda item: item[0].lower())
    entries = await asyncio.gather(
        *(
            build_seed_entry(filename, data)
            for filename, data in ordered_items
        )
    )
    seeds_with_thumbnails = dict(entries)
    return {"success": True, "data": {"seeds": seeds_with_thumbnails, "count": len(seeds_with_thumbnails)}}


async def _fallback_seed_cache_entry(filename: str, log_prefix: str = "[SEEDS]") -> tuple[bool, str]:
    """Try to safety-scan and cache a seed that is missing from safety cache."""
    global safe_seeds_cache

    if filename in safe_seeds_cache:
        return True, ""

    logger.warning(f"{log_prefix} Seed '{filename}' not in safety cache, running fallback safety check")

    # Build the same filename -> path mapping used by cache validation.
    all_seed_paths = glob_seeds(DEFAULT_SEEDS_DIR) + glob_seeds(UPLOADS_DIR)
    file_map = {p.name: str(p) for p in all_seed_paths}
    file_path = file_map.get(filename)

    if not file_path:
        return False, f"Seed '{filename}' not in safety cache and not found on disk"

    try:
        file_hash = await asyncio.to_thread(compute_file_hash, file_path)
        safety_result = await asyncio.to_thread(safety_checker.check_image, file_path)
        is_safe = safety_result.get("is_safe", False)

        safe_seeds_cache[filename] = {
            "hash": file_hash,
            "is_safe": is_safe,
            "path": file_path,
            "scores": safety_result.get("scores", {}),
            "checked_at": time.time(),
        }

        cache = load_seeds_cache()
        cache["files"] = safe_seeds_cache
        cache["last_scan"] = time.time()
        save_seeds_cache(cache)

        status = "SAFE" if is_safe else "UNSAFE"
        logger.info(f"{log_prefix} Fallback safety check complete for '{filename}': {status}")
        return True, ""
    except Exception as exc:
        logger.error(f"{log_prefix} Fallback safety check failed for '{filename}': {exc}")
        return False, f"Fallback safety check failed for '{filename}': {exc}"


async def _handle_seeds_image(msg: dict) -> dict | BinaryResponse:
    filename = msg.get("filename", "")
    if filename not in safe_seeds_cache:
        ok, error = await _fallback_seed_cache_entry(filename, log_prefix="[SEEDS_IMAGE]")
        if not ok:
            return {"success": False, "error": error}

    seed_data = safe_seeds_cache[filename]
    if not seed_data.get("is_safe", False):
        return {"success": False, "error": "Seed marked unsafe"}

    file_path = seed_data.get("path", "")
    if not os.path.exists(file_path):
        return {"success": False, "error": "Seed file not found"}

    image_bytes = await asyncio.to_thread(Path(file_path).read_bytes)
    return BinaryResponse(image_bytes)


async def _handle_seeds_thumbnail(msg: dict) -> dict | BinaryResponse:
    filename = msg.get("filename", "")
    if filename not in safe_seeds_cache:
        ok, error = await _fallback_seed_cache_entry(filename, log_prefix="[SEEDS_THUMBNAIL]")
        if not ok:
            return {"success": False, "error": error}

    seed_data = safe_seeds_cache[filename]
    file_path = seed_data.get("path", "")
    if not os.path.exists(file_path):
        return {"success": False, "error": "Seed file not found"}

    try:
        thumbnail_bytes = await asyncio.to_thread(_generate_thumbnail_jpeg_bytes, file_path)
        return BinaryResponse(thumbnail_bytes)
    except Exception as e:
        logger.error(f"Failed to generate thumbnail for {filename}: {e}")
        return {"success": False, "error": "Thumbnail generation failed"}


async def _handle_seeds_upload(msg: dict) -> dict:
    global safe_seeds_cache

    filename = msg.get("filename", "")
    data_b64 = msg.get("data", "")

    if not any(filename.lower().endswith(ext) for ext in SUPPORTED_IMAGE_EXTENSIONS):
        return {"success": False, "error": f"Unsupported format. Accepted: {', '.join(SUPPORTED_IMAGE_EXTENSIONS)}"}

    try:
        image_data = base64.b64decode(data_b64)
    except Exception as e:
        return {"success": False, "error": f"Invalid base64 data: {e}"}

    file_path = UPLOADS_DIR / filename
    await asyncio.to_thread(file_path.write_bytes, image_data)
    logger.info(f"Uploaded seed saved to {file_path}")

    file_hash = await asyncio.to_thread(compute_file_hash, str(file_path))

    try:
        safety_result = await asyncio.to_thread(
            safety_checker.check_image, str(file_path)
        )
        is_safe = safety_result.get("is_safe", False)

        safe_seeds_cache[filename] = {
            "hash": file_hash,
            "is_safe": is_safe,
            "path": str(file_path),
            "scores": safety_result.get("scores", {}),
            "checked_at": time.time(),
        }

        cache = load_seeds_cache()
        cache["files"] = safe_seeds_cache
        save_seeds_cache(cache)

        status_msg = "SAFE" if is_safe else "UNSAFE"
        logger.info(f"Uploaded seed {filename}: {status_msg}")

        return {
            "success": True,
            "data": {
                "filename": filename,
                "hash": file_hash,
                "is_safe": is_safe,
                "scores": safety_result.get("scores", {}),
            },
        }

    except Exception as e:
        logger.error(f"Safety check failed for uploaded seed: {e}")
        if file_path.exists():
            file_path.unlink()
        return {"success": False, "error": f"Safety check failed: {e}"}


async def _handle_seeds_delete(msg: dict) -> dict:
    global safe_seeds_cache

    filename = msg.get("filename", "")
    if filename not in safe_seeds_cache:
        ok, error = await _fallback_seed_cache_entry(filename, log_prefix="[SEEDS_DELETE]")
        if not ok:
            return {"success": False, "error": error}

    seed_data = safe_seeds_cache[filename]
    file_path = Path(seed_data.get("path", ""))

    if not str(file_path).startswith(str(UPLOADS_DIR)):
        return {"success": False, "error": "Cannot delete default seeds"}

    try:
        if file_path.exists():
            await asyncio.to_thread(file_path.unlink)
        del safe_seeds_cache[filename]

        cache = load_seeds_cache()
        cache["files"] = safe_seeds_cache
        save_seeds_cache(cache)

        logger.info(f"Deleted seed: {filename}")
        return {"success": True, "data": {}}

    except Exception as e:
        logger.error(f"Failed to delete seed {filename}: {e}")
        return {"success": False, "error": str(e)}


async def _handle_seeds_rescan(msg: dict) -> dict:
    global safe_seeds_cache
    force_full = bool(msg.get("force_full_rescan", False))

    async with rescan_lock:
        if force_full:
            logger.info("Manual full rescan triggered")
            cache = await rescan_seeds()
        else:
            logger.info("Manual rescan triggered (smart validation)")
            cache = await validate_and_update_cache()

        safe_seeds_cache = cache.get("files", {})

        safe_count = sum(1 for data in safe_seeds_cache.values() if data.get("is_safe"))
        return {
            "success": True,
            "data": {
                "total_seeds": len(safe_seeds_cache),
                "safe_seeds": safe_count,
            },
        }


async def _handle_model_info(msg: dict) -> dict:
    """Fetch model info from HuggingFace Hub via WS RPC."""
    model_id = msg.get("model_id", "")
    if not model_id:
        return {"success": False, "error": "model_id is required"}

    try:
        info = hf_model_info(model_id, files_metadata=True)
        size_bytes = None
        if hasattr(info, "siblings") and info.siblings:
            st_files = [s for s in info.siblings if s.rfilename.endswith(".safetensors") and s.size is not None]
            # Deduplicate by blob hash to avoid counting symlinked files twice
            seen_blobs = set()
            for s in st_files:
                blob_key = getattr(s, "blob_id", None) or s.rfilename
                if blob_key not in seen_blobs:
                    seen_blobs.add(blob_key)
                    size_bytes = (size_bytes or 0) + s.size
        return {"success": True, "data": {"id": model_id, "size_bytes": size_bytes, "exists": True, "error": None}}
    except RepositoryNotFoundError:
        return {"success": True, "data": {"id": model_id, "size_bytes": None, "exists": False, "error": "Model not found"}}
    except GatedRepoError:
        return {"success": True, "data": {"id": model_id, "size_bytes": None, "exists": True, "error": "Private or gated model"}}
    except Exception as e:
        logger.warning(f"model_info WS error for {model_id}: {e}")
        return {"success": True, "data": {"id": model_id, "size_bytes": None, "exists": True, "error": "Could not check model"}}


def _run_scene_edit_on_generator(prompt: str, cpu_frames: list) -> dict:
    from inpainting_manager import EDIT_APPEND_COUNT as SCENE_EDIT_APPEND_COUNT
    from inpainting_manager import EDIT_RESET_WITH_FRAME as SCENE_EDIT_RESET
    """Run inpainting on the generator thread, append via CUDA executor.

    Takes the last subframe from the most recent gen_frame output,
    inpaints it, expands to a full n_frames tensor, submits append_frame
    to the CUDA executor (required for CUDA graph compatibility), and
    returns preview data for the RPC response.
    """
    import base64
    from PIL import Image

    last_frame_np = cpu_frames[-1]

    # Encode original for debug preview
    original_jpeg = world_engine._numpy_to_jpeg(last_frame_np)
    original_b64 = base64.b64encode(original_jpeg).decode("ascii")

    # Run inpainting (diffusers pipeline, not CUDA-graph dependent)
    inpainted, edit_prompt = inpainting_manager._inpaint_sync(
        last_frame_np, prompt, world_engine.seed_target_size
    )

    # Encode inpainted for debug preview
    inpainted_np = world_engine._tensor_to_numpy(inpainted)
    preview_jpeg = world_engine._numpy_to_jpeg(inpainted_np)
    preview_b64 = base64.b64encode(preview_jpeg).decode("ascii")

    # Safety check on the inpainted result
    from inpainting_manager import SafetyRejectionError
    inpainted_pil = Image.fromarray(inpainted_np)
    safety_result = safety_checker.check_pil_image(inpainted_pil)
    if not safety_result["is_safe"]:
        logger.warning(
            f"[SCENE_EDIT] Safety checker rejected inpainted image: {safety_result['scores']}"
        )
        raise SafetyRejectionError()

    # Expand to full n_frames for multiframe models
    if world_engine.is_multiframe:
        inpainted = (
            inpainted.unsqueeze(0)
            .expand(world_engine.n_frames, -1, -1, -1)
            .contiguous()
        )

    # Apply the edited frame to the engine on the CUDA executor thread.
    if SCENE_EDIT_RESET:
        # Reset engine with the edited frame as the new seed
        world_engine.seed_frame = inpainted

        def _reset_with_frame():
            world_engine.engine.reset()
            world_engine.engine.append_frame(inpainted)
            if world_engine.has_prompt_conditioning:
                world_engine.engine.set_prompt(world_engine.current_prompt)

        world_engine.cuda_executor.submit(_reset_with_frame).result()
    else:
        # Append repeatedly to strengthen the edit in the KV cache
        def _append_repeated(f=inpainted):
            for _ in range(SCENE_EDIT_APPEND_COUNT):
                world_engine.engine.append_frame(f)

        world_engine.cuda_executor.submit(_append_repeated).result()

    return {
        "original_jpeg_b64": original_b64,
        "preview_jpeg_b64": preview_b64,
        "edit_prompt": edit_prompt,
    }


async def _handle_scene_edit_warmup(msg: dict) -> dict:
    """Load the inpainting model to GPU so it's ready for scene editing."""
    if inpainting_manager is None:
        return {"success": False, "error": "Inpainting not available"}
    if inpainting_manager.is_loaded:
        return {"success": True, "data": {"already_loaded": True}}
    try:
        await inpainting_manager.warmup()
        return {"success": True, "data": {"already_loaded": False}}
    except Exception as e:
        logger.error(f"[SCENE_EDIT] Warmup failed: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# ============================================================================
# WorldEngine WebSocket
# ============================================================================




@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for frame streaming and RPC.

    Protocol:
        Server -> Client:
            {"type": "status", "code": str, "stage": {...}}
            Binary frame: [4-byte LE header_len][JSON header][JPEG bytes]
              Header: {"frame_id": int, "client_ts": float, "gen_ms": float}
            {"type": "error", "message": str}
            {"type": "response", "req_id": str, "success": bool, "data": ..., "error": ...}
            {"type": "log", "line": str, "level": str}

        Client -> Server:
            {"type": "control", "buttons": [str], "mouse_dx": float, "mouse_dy": float, "ts": float}
            {"type": "set_model", "model": str}
            {"type": "reset"}
            {"type": "set_initial_seed", "filename": str}
            {"type": "prompt", "prompt": str}
            {"type": "prompt_with_seed", "filename": str}
            {"type": "pause"}
            {"type": "resume"}
            # Request/response (includes req_id):
            {"type": "seeds_list", "req_id": "..."}
            ...etc

    Status codes: waiting_for_seed, init, loading, ready, reset, warmup, startup
    """
    client_host = websocket.client.host if websocket.client else "unknown"
    logger.info(f"Client connected: {client_host}")

    await websocket.accept()

    # Background task: stream canonical server.log content to the client.
    async def _stream_server_log_file():
        cursor = 0
        try:
            initial_lines = _read_log_tail_lines(LOG_TAIL_INITIAL_LINES)
            for line in initial_lines:
                await websocket.send_text(json.dumps({"type": "log", "line": line, "level": "info"}))

            if SERVER_LOG_FILE.exists():
                cursor = SERVER_LOG_FILE.stat().st_size

            while True:
                await asyncio.sleep(LOG_TAIL_POLL_INTERVAL_SECONDS)
                if not SERVER_LOG_FILE.exists():
                    continue

                file_size = SERVER_LOG_FILE.stat().st_size
                if file_size < cursor:
                    cursor = 0

                chunk = ""
                with open(SERVER_LOG_FILE, "r", encoding="utf-8", errors="replace") as fp:
                    fp.seek(cursor)
                    chunk = fp.read()
                    cursor = fp.tell()

                if not chunk:
                    continue

                for line in chunk.splitlines():
                    if not line.strip():
                        continue
                    await websocket.send_text(json.dumps({"type": "log", "line": line, "level": "info"}))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"[{client_host}] Log tail stream stopped: {e}")

    log_tail_task = asyncio.create_task(_stream_server_log_file())

    # If startup is not yet complete, replay accumulated stages and stream new ones
    startup_queue: asyncio.Queue | None = None
    if not startup_complete:
        startup_queue = asyncio.Queue(maxsize=200)
        ws_startup_waiters.append(startup_queue)
        # Replay accumulated stages
        for stage_msg in startup_stages:
            await websocket.send_text(json.dumps(stage_msg))
        # Stream new stages until startup is done
        while not startup_complete:
            try:
                stage_msg = await asyncio.wait_for(startup_queue.get(), timeout=1.0)
                if stage_msg.get("type") == "_startup_done":
                    break
                await websocket.send_text(json.dumps(stage_msg))
            except asyncio.TimeoutError:
                continue
        ws_startup_waiters.remove(startup_queue)

    if startup_error:
        await websocket.send_text(json.dumps({"type": "error", "message": f"Server startup failed: {startup_error}"}))
        log_tail_task.cancel()
        await websocket.close()
        return

    session = Session()
    # Each websocket session must perform an explicit model/seed handshake.
    world_engine.seed_frame = None

    async def send_json(data: dict):
        await websocket.send_text(json.dumps(data))

    async def send_warning(message: str) -> None:
        await send_json({"type": "warning", "message": message})

    async def send_stage(stage: Stage) -> None:
        await send_json(
            {
                "type": "status",
                "stage": stage.id,
            }
        )

    # Progress queue: engine_manager calls progress_callback (sync, from CUDA thread)
    # which enqueues payloads; the drain task sends them over the WebSocket.
    progress_queue: asyncio.Queue = asyncio.Queue(maxsize=500)

    def progress_callback(stage: Stage) -> None:
        """Sync callback safe to call from any thread — enqueues for async send."""
        payload = {
            "type": "status",
            "stage": stage.id,
        }
        try:
            progress_queue.put_nowait(payload)
        except asyncio.QueueFull:
            pass

    async def _drain_progress_queue():
        try:
            while True:
                msg = await progress_queue.get()
                try:
                    await websocket.send_text(json.dumps(msg))
                except Exception:
                    break
        except asyncio.CancelledError:
            pass

    progress_drain_task = asyncio.create_task(_drain_progress_queue())

    async def reset_engine():
        # Restore the original seed (before any scene edits) on reset
        if world_engine.original_seed_frame is not None:
            world_engine.seed_frame = world_engine.original_seed_frame
        world_engine.set_progress_callback(progress_callback, asyncio.get_running_loop())
        await world_engine.init_session()
        world_engine.set_progress_callback(None)
        session.frame_count = 0
        logger.info(f"[{client_host}] Engine Reset")

    async def load_initial_seed(filename: str | None) -> bool:
        """Validate and load seed into world_engine.seed_frame."""
        if not filename:
            await send_warning("Missing filename")
            return False

        if filename not in safe_seeds_cache:
            ok, error = await _fallback_seed_cache_entry(
                filename, log_prefix=f"[{client_host}]"
            )
            if not ok:
                logger.warning(f"[{client_host}] {error}")
                await send_warning(error)
                return False

        cached_entry = safe_seeds_cache[filename]
        if not cached_entry.get("is_safe", False):
            logger.warning(f"[{client_host}] Seed '{filename}' marked as unsafe")
            await send_warning(f"Seed '{filename}' marked as unsafe")
            return False

        cached_hash = cached_entry.get("hash", "")
        file_path = cached_entry.get("path", "")
        if not os.path.exists(file_path):
            logger.error(f"[{client_host}] Seed file not found: {file_path}")
            await send_warning(f"Seed file not found: {filename}")
            return False

        actual_hash = await asyncio.to_thread(compute_file_hash, file_path)
        if actual_hash != cached_hash:
            logger.warning(
                f"[{client_host}] File integrity check failed for '{filename}' - file may have been modified"
            )
            await send_warning("File integrity verification failed - please rescan seeds")
            return False

        logger.info(f"[{client_host}] Loading initial seed '{filename}'")
        loaded_frame = await world_engine.load_seed_from_file(file_path)
        if loaded_frame is None:
            await send_warning("Failed to load seed image")
            return False

        world_engine.seed_frame = loaded_frame
        world_engine.original_seed_frame = loaded_frame
        logger.info(f"[{client_host}] Initial seed loaded successfully")
        return True

    async def handle_model_request(
        model_uri: str | None, live_switch: bool, seed_filename: str | None = None
    ) -> None:
        """Load/switch model and transition back to waiting-for-seed state."""
        model_uri = (model_uri or "").strip()
        if not model_uri:
            await send_warning("Missing model id")
            return

        if live_switch:
            logger.info(f"[{client_host}] Live model switch requested: {model_uri}")
        else:
            logger.info(f"[{client_host}] Requested model: {model_uri}")
        logger.info(f"[{client_host}] set_model seed payload: {seed_filename!r}")

        world_engine.set_progress_callback(progress_callback, asyncio.get_running_loop())
        await world_engine.load_engine(model_uri)
        world_engine.set_progress_callback(None)

        world_engine.seed_frame = None
        session.frame_count = 0
        seed_loaded = False
        effective_seed = seed_filename or DEFAULT_INITIAL_SEED
        seed_loaded = await load_initial_seed(effective_seed)
        if not seed_loaded and seed_filename:
            # If an explicit seed fails, still leave room for a manual retry from client.
            logger.info(
                f"[{client_host}] Failed to load explicit seed '{seed_filename}', waiting for client seed"
            )
        if not seed_loaded:
            await send_stage(SESSION_WAITING_FOR_SEED)
        logger.info(f"[{client_host}] Model loaded: {world_engine.model_uri}")

    scene_edit_requested = False

    try:
        # Wait for initial seed from client
        await send_stage(SESSION_WAITING_FOR_SEED)
        logger.info(f"[{client_host}] Waiting for initial seed from client...")

        # Wait for model selection + initial seed message
        while world_engine.seed_frame is None:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                msg = json.loads(raw)
                msg_type = msg.get("type")

                # Handle request/response messages even during seed wait
                if "req_id" in msg:
                    result = await dispatch_request(msg, websocket)
                    req_id = msg["req_id"]
                    if isinstance(result, BinaryResponse):
                        header = json.dumps(
                            {"req_id": req_id, "success": True},
                            separators=(",", ":"),
                        ).encode("utf-8")
                        await websocket.send_bytes(struct.pack("<I", len(header)) + header + result.image_bytes)
                    else:
                        if "success" not in result:
                            result = {"success": True, "data": result}
                        await send_json({"type": "response", "req_id": req_id, **result})
                    continue

                if msg_type == "set_model":
                    if msg.get("scene_edit"):
                        scene_edit_requested = True
                    await handle_model_request(
                        msg.get("model"),
                        live_switch=False,
                        seed_filename=msg.get("seed"),
                    )

                elif msg_type == "set_initial_seed":
                    await load_initial_seed(msg.get("filename"))
                else:
                    logger.info(
                        f"[{client_host}] Ignoring message type '{msg_type}' while waiting for seed"
                    )

            except asyncio.TimeoutError:
                await send_json(
                    {"type": "error", "message": "Timeout waiting for initial seed"}
                )
                return

        # Wire progress callback so engine_manager reports granular stages
        world_engine.set_progress_callback(progress_callback, asyncio.get_running_loop())

        # If no model was selected by client, load default/current model now.
        if world_engine.engine is None:
            await world_engine.load_engine()

        if world_engine.seed_frame is None:
            logger.info(
                f"[{client_host}] Seed frame missing before initialization; client likely disconnected/reconnected during model switch"
            )
            world_engine.set_progress_callback(None)
            return

        # Load inpainting model BEFORE WorldEngine warmup so CUDA graphs
        # are compiled with the inpainting model's memory already allocated.
        if scene_edit_requested and inpainting_manager is not None and not inpainting_manager.is_loaded:
            from progress_stages import (
                SESSION_INPAINTING_LOAD, SESSION_INPAINTING_READY,
                SESSION_SAFETY_LOAD, SESSION_SAFETY_READY,
            )
            await send_stage(SESSION_INPAINTING_LOAD)
            try:
                await inpainting_manager.warmup()
                await send_stage(SESSION_INPAINTING_READY)
            except Exception as e:
                logger.error(f"[{client_host}] Inpainting warmup failed: {e}", exc_info=True)
                await send_json({"type": "error", "message": f"Scene edit model failed to load: {e}"})
                return

            # Load safety checker on GPU and keep it resident for fast
            # repeated checks on inpainted frames.
            if not safety_checker.is_resident:
                await send_stage(SESSION_SAFETY_LOAD)
                try:
                    await asyncio.to_thread(safety_checker.load_resident, "cuda")
                    await send_stage(SESSION_SAFETY_READY)
                except Exception as e:
                    logger.error(f"[{client_host}] Safety checker GPU load failed: {e}", exc_info=True)
                    await send_json({"type": "error", "message": f"Content filter failed to load: {e}"})
                    return

        # Warmup on first connection AFTER seed is loaded
        if not world_engine.engine_warmed_up:
            await world_engine.warmup()

        # Init session (reset, seed, prompt) with granular progress
        await world_engine.init_session()

        # Send initial frame so client has something to display
        initial_display_frame = (
            world_engine.seed_frame[0] if world_engine.is_multiframe else world_engine.seed_frame
        )
        jpeg = await asyncio.to_thread(
            world_engine.frame_to_jpeg, initial_display_frame
        )
        header = json.dumps(
            {"frame_id": 0, "client_ts": 0, "gen_ms": 0},
            separators=(",", ":"),
        ).encode("utf-8")
        await websocket.send_bytes(struct.pack("<I", len(header)) + header + jpeg)

        world_engine.set_progress_callback(None)
        await send_stage(SESSION_READY)
        logger.info(f"[{client_host}] Ready for game loop")
        running = True
        paused = False
        reset_flag = False
        prompt_pending: str | None = None
        # Scene edit: receiver posts a prompt + future, generator picks it up
        # after the current gen_frame, runs inpainting on the last subframe,
        # appends the result, and resolves the future with preview data.
        scene_edit_request: dict | None = None  # {"prompt": str, "future": concurrent.futures.Future}
        last_generated_cpu_frames = None  # Most recent CPU numpy frames for scene editing (list)
        ctrl_state = {
            "buttons": set(),
            "mouse_dx": 0.0,
            "mouse_dy": 0.0,
            "client_ts": 0,
            "dirty": False,
        }
        ctrl_lock = threading.Lock()
        frame_queue: Queue = Queue(maxsize=16)
        frame_ready = asyncio.Event()
        main_loop = asyncio.get_running_loop()

        # Cache device names — queried once per session (both can be slow)
        try:
            import cpuinfo
            _metrics_cpu_name = cpuinfo.get_cpu_info().get("brand_raw") or None
        except Exception:
            _metrics_cpu_name = None
        try:
            _metrics_gpu_name = (torch.cuda.get_device_name(0) if torch.cuda.is_available() else None) or None
        except Exception:
            _metrics_gpu_name = None

        def _build_initial_metrics() -> dict:
            """Static session info sent once at connection start."""
            return {
                "type": "metrics",
                "gpu_name": _metrics_gpu_name,
                "cpu_name": _metrics_cpu_name,
                "model": getattr(world_engine, 'model_uri', "") or "",
            }

        def queue_send(payload: dict | bytes) -> None:
            try:
                frame_queue.put_nowait(payload)
                main_loop.call_soon_threadsafe(frame_ready.set)
            except Exception:
                pass

        # Cached GPU metrics, updated each latent pass and embedded in frame headers
        _cached_gpu_metrics = {
            "vram_used_mb": -1.0,
            "vram_total_mb": -1.0,
            "vram_percent": -1.0,
            "gpu_util_percent": -1.0,
        }

        # One-time NVML init for GPU utilization queries (same backend as nvidia-smi)
        _nvml_handle = None
        try:
            import pynvml
            pynvml.nvmlInit()
            _nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(
                torch.cuda.current_device() if torch.cuda.is_available() else 0
            )
        except Exception:
            pass

        def _update_gpu_metrics() -> None:
            try:
                if torch.cuda.is_available():
                    vram_used = torch.cuda.memory_allocated() / (1024 * 1024)
                    vram_total = torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)
                    vram_pct = (vram_used / vram_total * 100) if vram_total > 0 else 0
                else:
                    vram_used = vram_total = vram_pct = -1
                gpu_util = -1
                try:
                    gpu_util = torch.cuda.utilization()
                except Exception:
                    pass
                if gpu_util < 0 and _nvml_handle is not None:
                    try:
                        import pynvml
                        gpu_util = pynvml.nvmlDeviceGetUtilizationRates(_nvml_handle).gpu
                    except Exception:
                        pass
                _cached_gpu_metrics.update({
                    "vram_used_mb": round(vram_used, 0),
                    "vram_total_mb": round(vram_total, 0),
                    "vram_percent": round(vram_pct, 1),
                    "gpu_util_percent": gpu_util,
                })
            except Exception:
                pass  # metrics are best-effort

        def build_binary_frame(jpeg: bytes, frame_id: int, client_ts: float, gen_ms: float, n_frames: int = 1, profile: dict | None = None) -> bytes:
            header_data = {"frame_id": frame_id, "client_ts": client_ts, "gen_ms": gen_ms, "n_frames": n_frames}
            header_data.update(_cached_gpu_metrics)
            if profile is not None:
                header_data.update(profile)
            header = json.dumps(header_data, separators=(",", ":")).encode("utf-8")
            return struct.pack("<I", len(header)) + header + jpeg

        queue_send(_build_initial_metrics())

        async def receiver() -> None:
            nonlocal running, paused, reset_flag, prompt_pending, scene_edit_request
            while running:
                try:
                    raw = await websocket.receive_text()
                    msg = json.loads(raw)
                    msg_type = msg.get("type", "control")

                    if "req_id" in msg:
                        # scene_edit is handled by the generator thread at
                        # the next clean frame boundary — post a request and
                        # await the future.
                        if msg.get("type") == "scene_edit":
                            prompt = msg.get("prompt", "").strip()
                            if not prompt:
                                result = {"success": False, "error": "Empty prompt"}
                            elif inpainting_manager is None or not inpainting_manager.is_loaded:
                                result = {"success": False, "error": "Inpainting model not loaded. Enable Scene Edit in Experimental settings."}
                            elif scene_edit_request is not None:
                                result = {"success": False, "error": "Scene edit already in progress"}
                            else:
                                import concurrent.futures
                                fut = concurrent.futures.Future()
                                scene_edit_request = {"prompt": prompt, "future": fut}
                                # Await the future (generator will resolve it)
                                try:
                                    preview_data = await asyncio.wrap_future(fut)
                                    result = {"success": True, "data": {**preview_data}}
                                except Exception as e:
                                    result = {"success": False, "error": str(e)}
                        else:
                            result = await dispatch_request(msg, websocket)
                        req_id = msg["req_id"]
                        if isinstance(result, BinaryResponse):
                            header = json.dumps(
                                {"req_id": req_id, "success": True},
                                separators=(",", ":"),
                            ).encode("utf-8")
                            queue_send(struct.pack("<I", len(header)) + header + result.image_bytes)
                        else:
                            if "success" not in result:
                                result = {"success": True, "data": result}
                            queue_send({"type": "response", "req_id": req_id, **result})
                        continue

                    match msg_type:
                        case "set_model":
                            await handle_model_request(msg.get("model"), live_switch=True)
                            if world_engine.seed_frame is not None:
                                reset_flag = True
                            continue

                        case "set_initial_seed":
                            if await load_initial_seed(msg.get("filename")):
                                reset_flag = True
                            continue

                        case "reset":
                            logger.info(f"[{client_host}] Reset requested")
                            reset_flag = True
                            continue

                        case "pause":
                            paused = True
                            logger.info("[RECV] Paused")
                            continue

                        case "resume":
                            paused = False
                            logger.info("[RECV] Resumed")
                            continue

                        case "prompt":
                            from engine_manager import DEFAULT_PROMPT

                            new_prompt = msg.get("prompt", "").strip()
                            prompt_pending = new_prompt if new_prompt else DEFAULT_PROMPT
                            continue

                        case "prompt_with_seed":
                            filename = msg.get("filename")
                            logger.info(f"[RECV] prompt_with_seed: filename={filename}")
                            if not filename:
                                queue_send({"type": "warning", "message": "Missing filename"})
                                continue
                            if await load_initial_seed(filename):
                                reset_flag = True
                            continue

                        case "control":
                            if paused:
                                continue

                            if "button_codes" in msg:
                                buttons = set(msg.get("button_codes", []))
                            else:
                                buttons = {
                                    BUTTON_CODES[b.upper()]
                                    for b in msg.get("buttons", [])
                                    if b.upper() in BUTTON_CODES
                                }

                            with ctrl_lock:
                                ctrl_state["buttons"] = buttons
                                ctrl_state["mouse_dx"] += float(msg.get("mouse_dx", 0.0))
                                ctrl_state["mouse_dy"] += float(msg.get("mouse_dy", 0.0))
                                ctrl_state["client_ts"] = msg.get("ts", ctrl_state["client_ts"])
                                ctrl_state["dirty"] = True
                            continue

                except WebSocketDisconnect:
                    logger.info(f"[{client_host}] Client disconnected")
                    running = False
                    break
                except Exception as e:
                    logger.error(f"[{client_host}] Receiver error: {e}", exc_info=True)
                    running = False
                    break

        async def sender() -> None:
            nonlocal running
            while running:
                try:
                    # Wait for signal from generator thread instead of polling
                    await frame_ready.wait()
                    frame_ready.clear()
                    # Drain all available frames in one batch
                    while not frame_queue.empty():
                        payload = frame_queue.get_nowait()
                        if isinstance(payload, bytes):
                            await websocket.send_bytes(payload)
                        else:
                            await websocket.send_text(json.dumps(payload))
                except Exception as e:
                    logger.error(f"[{client_host}] Sender error: {e}", exc_info=True)
                    running = False
                    break

        def generator() -> None:
            nonlocal running, paused, reset_flag, prompt_pending, scene_edit_request, last_generated_cpu_frames

            def run_coro(coro):
                return asyncio.run_coroutine_threadsafe(coro, main_loop).result()

            def _flush_pending():
                """JPEG-encode + queue pending CPU frames."""
                if not _flush_pending.work:
                    return
                cpu_frames, gen_time, n_frames, client_ts, t0, t_infer, t_sync = _flush_pending.work
                _flush_pending.work = None

                t_enc_start = time.perf_counter()
                encoded = [world_engine._numpy_to_jpeg(rgb) for rgb in cpu_frames]
                t_enc = time.perf_counter()

                if session.frame_count % 5 == 0:
                    _update_gpu_metrics()
                t_metrics = time.perf_counter()

                for jpeg in encoded:
                    session.frame_count += 1
                    t_queued = time.perf_counter()
                    profile = {
                        "t_infer_ms": round((t_infer - t0) * 1000, 1),
                        "t_sync_ms": round((t_sync - t_infer) * 1000, 1),
                        "t_enc_ms": round((t_enc - t_enc_start) * 1000, 1),
                        "t_metrics_ms": round((t_metrics - t_enc) * 1000, 1),
                        "t_overhead_ms": round((t_queued - t_metrics) * 1000, 1),
                    }
                    queue_send(build_binary_frame(jpeg, session.frame_count, client_ts, gen_time, n_frames=n_frames, profile=profile))

                if session.frame_count % 60 == 0:
                    logger.info(
                        f"[{client_host}] Sent frame {session.frame_count} (gen={gen_time:.1f}ms)"
                    )

            _flush_pending.work = None

            while running:
                if paused:
                    _flush_pending()
                    time.sleep(0.01)
                    continue

                try:
                    if prompt_pending is not None:
                        _flush_pending()
                        world_engine.current_prompt = prompt_pending
                        prompt_pending = None
                        run_coro(reset_engine())

                    if reset_flag or session.frame_count >= session.max_frames:
                        _flush_pending()
                        if session.frame_count >= session.max_frames:
                            logger.info(f"[{client_host}] Auto-reset at frame limit")
                        run_coro(reset_engine())
                        reset_flag = False

                    # Handle pending scene edit — runs inpainting on the last
                    # subframe from the most recent gen_frame, then appends.
                    if scene_edit_request is not None and last_generated_cpu_frames is not None:
                        req = scene_edit_request
                        scene_edit_request = None
                        _flush_pending()
                        try:
                            preview = _run_scene_edit_on_generator(
                                req["prompt"], last_generated_cpu_frames
                            )
                            session.frame_count = 0
                            req["future"].set_result(preview)
                        except Exception as e:
                            logger.error(f"[SCENE_EDIT] Failed: {e}", exc_info=True)
                            req["future"].set_exception(e)

                    with ctrl_lock:
                        if not ctrl_state["dirty"]:
                            buttons = None
                        else:
                            buttons = set(ctrl_state["buttons"])
                            mouse_dx = float(ctrl_state["mouse_dx"])
                            mouse_dy = float(ctrl_state["mouse_dy"])
                            client_ts = ctrl_state["client_ts"]
                            ctrl_state["mouse_dx"] = 0.0
                            ctrl_state["mouse_dy"] = 0.0
                            ctrl_state["dirty"] = False

                    if buttons is None:
                        _flush_pending()
                        time.sleep(0.001)
                        continue

                    ctrl = world_engine.CtrlInput(button=buttons, mouse=(mouse_dx, mouse_dy))

                    # client_ts is a performance.now() timestamp from the browser;
                    # we can't compare clocks, but we CAN forward it so the client
                    # can measure the full round-trip on its own clock.
                    t0 = time.perf_counter()

                    # Submit inference to CUDA thread (non-blocking) so we can
                    # overlap JPEG encoding of the previous batch with GPU work.
                    gpu_future = world_engine.cuda_executor.submit(
                        lambda c=ctrl: world_engine.engine.gen_frame(ctrl=c)
                    )

                    # Encode + send previous batch while GPU is busy
                    _flush_pending()

                    # Wait for GPU result
                    result = gpu_future.result()
                    t_infer = time.perf_counter()

                    if torch.cuda.is_available():
                        torch.cuda.synchronize()
                    t_sync = time.perf_counter()

                    gen_time = (t_sync - t0) * 1000
                    n_frames = world_engine.n_frames

                    # Transfer result tensors to CPU numpy arrays immediately
                    # while the data is still valid (gen_frame may reuse GPU
                    # buffers on the next call).
                    if n_frames > 1:
                        cpu_frames = [world_engine._tensor_to_numpy(result[i]) for i in range(result.shape[0])]
                    else:
                        cpu_frames = [world_engine._tensor_to_numpy(result)]

                    # Keep all subframes for scene editing (read by receiver thread)
                    last_generated_cpu_frames = cpu_frames

                    # Stash this batch's CPU frames for deferred JPEG encoding
                    _flush_pending.work = (cpu_frames, gen_time, n_frames, client_ts, t0, t_infer, t_sync)

                except Exception as cuda_err:
                    _flush_pending.work = None

                    error_msg = str(cuda_err)
                    is_cuda_error = any(
                        keyword in error_msg.lower()
                        for keyword in ["cuda", "cublas", "graph capture", "offset increment"]
                    )

                    if is_cuda_error:
                        logger.error(f"[{client_host}] CUDA error detected: {cuda_err}")
                        try:
                            recovery_success = run_coro(world_engine.recover_from_cuda_error())
                        except Exception:
                            recovery_success = False

                        if recovery_success:
                            queue_send(
                                {
                                    "type": "status",
                                    "stage": "session.reset",
                                    "message": "Recovered from CUDA error - engine reset",
                                }
                            )
                            logger.info(f"[{client_host}] Successfully recovered from CUDA error")
                        else:
                            queue_send(
                                {
                                    "type": "error",
                                    "message": "CUDA error - recovery failed. Please reconnect.",
                                }
                            )
                            logger.error(f"[{client_host}] Failed to recover from CUDA error")
                            running = False
                            break
                    else:
                        logger.error(f"[{client_host}] Generation error: {cuda_err}", exc_info=True)
                        queue_send({"type": "error", "message": str(cuda_err)})
                        running = False
                        break

            # Flush the last batch before the thread exits
            try:
                _flush_pending()
            except Exception:
                pass

        gen_thread = threading.Thread(target=generator, daemon=True, name=f"gen-{client_host}")
        gen_thread.start()

        recv_task = asyncio.create_task(receiver())
        send_task = asyncio.create_task(sender())
        done, pending = await asyncio.wait(
            [recv_task, send_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        running = False
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    except WebSocketDisconnect:
        logger.info(f"[{client_host}] WebSocket disconnected")
    except Exception as e:
        # Uvicorn may surface client close as ClientDisconnected instead of WebSocketDisconnect.
        # Treat both as normal disconnects to avoid noisy tracebacks during intentional reconnects.
        if e.__class__.__name__ == "ClientDisconnected":
            logger.info(f"[{client_host}] Client disconnected")
        else:
            logger.error(f"[{client_host}] Error: {e}", exc_info=True)
            try:
                await send_json({"type": "error", "message": str(e)})
            except Exception:
                pass
    finally:
        log_tail_task.cancel()
        progress_drain_task.cancel()
        world_engine.set_progress_callback(None)
        logger.info(f"[{client_host}] Disconnected (frames: {session.frame_count})")


# ============================================================================
# Entry Point
# ============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Biome Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=7987, help="Port to bind to")
    parser.add_argument("--parent-pid", type=int, default=None, help="PID of parent process; server exits if parent dies")
    args = parser.parse_args()

    if args.parent_pid is not None:
        _parent_pid = args.parent_pid
        print(f"[BIOME] Monitoring parent process PID {_parent_pid}", flush=True)
        _check_parent_alive()

    try:
        uvicorn.run(
            app,
            host=args.host,
            port=args.port,
            ws_ping_interval=300,
            ws_ping_timeout=300,
        )
    except BaseException:
        print("[BIOME] Fatal exception at server entrypoint", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        sys.stderr.flush()
        _hosted_log_fp.flush()
        raise
