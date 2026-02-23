"""
Tauri <> Python Communication Bridge

Low-latency WebSocket server that orchestrates WorldEngine and Safety modules.
This server acts as a unified interface for both world generation and safety checking.

Usage:
    python server.py --host 0.0.0.0 --port 7987

Client connects via WebSocket to ws://localhost:7987/ws
Safety checks via HTTP POST to http://localhost:7987/safety/check_batch
"""

# Immediate startup logging before any imports that could fail
import sys

print(f"[BIOME] Python {sys.version}", flush=True)
print(f"[BIOME] Starting server...", flush=True)

import asyncio
import base64
import hashlib
import json
import logging
import os
import pickle
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

# Reduce CUDA allocator fragmentation during repeated model loads/switches.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("biome_server")

print("[BIOME] Basic imports done", flush=True)

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
    from pydantic import BaseModel

    print("[BIOME] FastAPI imported", flush=True)

    print("[BIOME] Importing Engine Manager module...", flush=True)
    from engine_manager import WorldEngineManager, Session, BUTTON_CODES

    print("[BIOME] Engine Manager module imported", flush=True)

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
safety_checker = None
safe_seeds_cache = {}  # Maps filename -> {hash, is_safe, path}
rescan_lock = None  # Prevent concurrent rescans (initialized in lifespan)

# ============================================================================
# Seed Management Configuration
# ============================================================================

# Server-side seed storage paths
SEEDS_BASE_DIR = Path(__file__).parent.parent / "world_engine" / "seeds"
DEFAULT_SEEDS_DIR = SEEDS_BASE_DIR / "default"
UPLOADS_DIR = SEEDS_BASE_DIR / "uploads"
DEFAULT_INITIAL_SEED = "default.png"
CACHE_FILE = Path(__file__).parent.parent / "world_engine" / ".seeds_cache.bin"

# Local seeds directory (for dev/standalone usage - relative to project root)
LOCAL_SEEDS_DIR = Path(__file__).parent.parent.parent / "seeds"

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
    # Check if seeds already exist (bundled by Tauri on first run, or from previous setup)
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
    logger.error(f"  - {DEFAULT_SEEDS_DIR} (bundled by Tauri installer)")
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

        status = "✓ SAFE" if safety_result.get("is_safe") else "✗ UNSAFE"
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

            status = "✓ SAFE" if safety_result.get("is_safe") else "✗ UNSAFE"
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
# Application Lifecycle
# ============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle handler."""
    global world_engine, safety_checker, safe_seeds_cache, rescan_lock

    logger.info("=" * 60)
    logger.info("BIOME SERVER STARTUP")
    logger.info("=" * 60)

    # Initialize lock for rescan operations
    rescan_lock = asyncio.Lock()

    # Initialize modules
    logger.info("Initializing WorldEngine...")
    world_engine = WorldEngineManager()

    logger.info("Initializing Safety Checker...")
    safety_checker = SafetyChecker()

    # Warmup safety checker to trigger first-time transformers initialization
    # This prevents CUDA state pollution from affecting WorldEngine's first operations
    # Without this it seems that the first upload of seed image will have a 
    logger.info("Warming up Safety Checker (first-time model load)...")
    warmup_start = time.perf_counter()

    # Create a small dummy image for warmup
    import tempfile
    dummy_img = Image.new('RGB', (64, 64), color='gray')
    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
        dummy_img.save(tmp.name)
        dummy_path = tmp.name

    # Run safety check to trigger model loading
    await asyncio.to_thread(safety_checker.check_image, dummy_path)

    # Cleanup dummy image
    os.unlink(dummy_path)

    logger.info(f"Safety Checker warmed up in {time.perf_counter() - warmup_start:.2f}s")

    # WorldEngine is loaded lazily on first client connection.
    # This allows remote clients to select model per session.

    # Initialize seed management system
    logger.info("Initializing server-side seed storage...")
    ensure_seed_directories()
    await setup_default_seeds()

    # Validate and update seed cache (checks for stale data, missing files, new files)
    async with rescan_lock:
        cache = await validate_and_update_cache()

    # Update global cache (map filename -> metadata)
    safe_seeds_cache = cache.get("files", {})

    logger.info("=" * 60)
    logger.info("[SERVER] Ready - Safety loaded, WorldEngine will load on first client")
    logger.info(f"[SERVER] {len(safe_seeds_cache)} seeds available")
    logger.info("=" * 60)
    print("SERVER READY", flush=True)  # Signal for Rust to detect

    yield

    # Cleanup
    logger.info("[SERVER] Shutting down")


app = FastAPI(title="Biome Server", lifespan=lifespan)

# Add CORS middleware to allow frontend requests
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "tauri://localhost"],  # Vite dev server and Tauri
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
# Health Endpoints
# ============================================================================


@app.get("/health")
async def health():
    """Health check for Tauri backend."""
    return JSONResponse(
        {
            "status": "ok",
            "world_engine": {
                "loaded": world_engine.engine is not None,
                "warmed_up": world_engine.engine_warmed_up,
                "has_seed": world_engine.seed_frame is not None,
            },
            "safety": {"loaded": safety_checker.model is not None},
        }
    )


# ============================================================================
# Safety Endpoints
# ============================================================================


class CheckImageRequest(BaseModel):
    path: str


class CheckBatchRequest(BaseModel):
    paths: list[str]


@app.post("/safety/check_image")
async def check_image(request: CheckImageRequest):
    """Check single image for NSFW content."""
    try:
        result = safety_checker.check_image(request.path)
        return JSONResponse(result)
    except Exception as e:
        logger.error(f"Safety check failed: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/safety/check_batch")
async def check_batch(request: CheckBatchRequest):
    """Check multiple images for NSFW content."""
    try:
        results = safety_checker.check_batch(request.paths)
        return JSONResponse({"results": results})
    except Exception as e:
        logger.error(f"Safety batch check failed: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


class SetCacheRequest(BaseModel):
    seeds: dict[str, dict]  # filename -> {hash, is_safe, path}


@app.post("/safety/set_cache")
async def set_cache(request: SetCacheRequest):
    """Receive safety cache from Rust on startup."""
    global safe_seeds_cache
    safe_seeds_cache = request.seeds
    logger.info(f"Safety cache updated: {len(safe_seeds_cache)} seeds loaded")
    return JSONResponse({"status": "ok", "count": len(safe_seeds_cache)})


# ============================================================================
# Seed Management Endpoints
# ============================================================================


@app.get("/seeds/list")
async def list_seeds():
    """Return list of all seeds with metadata (including unsafe ones).
    If a scan is in progress, waits for it to finish before returning."""
    # Wait for any in-progress scan to complete before reading cache
    async with rescan_lock:
        pass

    all_seeds = {
        filename: {
            "filename": filename,
            "hash": data["hash"],
            "is_safe": data.get("is_safe", False),
            "is_default": not str(data.get("path", "")).startswith(str(UPLOADS_DIR)),
            "checked_at": data.get("checked_at", 0),
        }
        for filename, data in safe_seeds_cache.items()
    }
    return JSONResponse({"seeds": all_seeds, "count": len(all_seeds)})


@app.get("/seeds/image/{filename}")
async def get_seed_image(filename: str):
    """Serve full PNG seed image."""
    from fastapi.responses import FileResponse

    # Validate filename is in cache and safe
    if filename not in safe_seeds_cache:
        return JSONResponse({"error": "Seed not found"}, status_code=404)

    seed_data = safe_seeds_cache[filename]
    if not seed_data.get("is_safe", False):
        return JSONResponse({"error": "Seed marked unsafe"}, status_code=403)

    file_path = seed_data.get("path", "")
    if not os.path.exists(file_path):
        return JSONResponse({"error": "Seed file not found"}, status_code=404)

    ext = Path(file_path).suffix.lower()
    media_type = MIME_TYPES.get(ext, "application/octet-stream")
    return FileResponse(file_path, media_type=media_type)


@app.get("/seeds/thumbnail/{filename}")
async def get_seed_thumbnail(filename: str):
    """Serve 80x80 JPEG thumbnail of seed image."""
    import io

    # Validate filename is in cache
    if filename not in safe_seeds_cache:
        return JSONResponse({"error": "Seed not found"}, status_code=404)

    seed_data = safe_seeds_cache[filename]
    file_path = seed_data.get("path", "")
    if not os.path.exists(file_path):
        return JSONResponse({"error": "Seed file not found"}, status_code=404)

    try:
        # Generate thumbnail
        img = await asyncio.to_thread(Image.open, file_path)
        img.thumbnail((80, 80))

        # Convert RGBA to RGB if needed (JPEG doesn't support transparency)
        if img.mode in ('RGBA', 'LA', 'P'):
            # Create white background and composite
            background = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
            img = background
        elif img.mode != 'RGB':
            img = img.convert('RGB')

        # Convert to JPEG in memory
        buffer = io.BytesIO()
        await asyncio.to_thread(img.save, buffer, format="JPEG", quality=85)
        buffer.seek(0)

        from fastapi.responses import StreamingResponse

        return StreamingResponse(buffer, media_type="image/jpeg")
    except Exception as e:
        logger.error(f"Failed to generate thumbnail for {filename}: {e}")
        return JSONResponse({"error": "Thumbnail generation failed"}, status_code=500)


class UploadSeedRequest(BaseModel):
    filename: str
    data: str  # base64 encoded image


@app.post("/seeds/upload")
async def upload_seed(request: UploadSeedRequest):
    """Upload a custom seed image (will be safety checked)."""
    global safe_seeds_cache

    filename = request.filename
    if not any(filename.lower().endswith(ext) for ext in SUPPORTED_IMAGE_EXTENSIONS):
        return JSONResponse(
            {"error": f"Unsupported format. Accepted: {', '.join(SUPPORTED_IMAGE_EXTENSIONS)}"},
            status_code=400,
        )

    # Decode base64
    try:
        image_data = base64.b64decode(request.data)
    except Exception as e:
        return JSONResponse({"error": f"Invalid base64 data: {e}"}, status_code=400)

    # Save to uploads directory
    file_path = UPLOADS_DIR / filename
    await asyncio.to_thread(file_path.write_bytes, image_data)
    logger.info(f"Uploaded seed saved to {file_path}")

    # Compute hash
    file_hash = await asyncio.to_thread(compute_file_hash, str(file_path))

    # Run safety check
    try:
        safety_result = await asyncio.to_thread(
            safety_checker.check_image, str(file_path)
        )
        is_safe = safety_result.get("is_safe", False)

        # Update cache
        safe_seeds_cache[filename] = {
            "hash": file_hash,
            "is_safe": is_safe,
            "path": str(file_path),
            "scores": safety_result.get("scores", {}),
            "checked_at": time.time(),
        }

        # Save to disk
        cache = load_seeds_cache()
        cache["files"] = safe_seeds_cache
        save_seeds_cache(cache)

        status_msg = "SAFE" if is_safe else "UNSAFE"
        logger.info(f"Uploaded seed {filename}: {status_msg}\nScores: {safety_result.get('scores', {})}")

        return JSONResponse(
            {
                "status": "ok",
                "filename": filename,
                "hash": file_hash,
                "is_safe": is_safe,
                "scores": safety_result.get("scores", {}),
            }
        )

    except Exception as e:
        logger.error(f"Safety check failed for uploaded seed: {e}")
        # Delete the file if safety check failed
        if file_path.exists():
            file_path.unlink()
        return JSONResponse(
            {"error": f"Safety check failed: {e}"}, status_code=500
        )


class RescanRequest(BaseModel):
    force_full_rescan: bool = False  # Optional: force full rescan instead of smart validation


@app.post("/seeds/rescan")
async def rescan_seeds_endpoint(request: Optional[RescanRequest] = None):
    """
    Trigger a rescan of seed directories.

    By default, performs smart validation (incremental updates).
    Set force_full_rescan=true to force a complete rescan of all files.
    """
    global safe_seeds_cache

    force_full = request.force_full_rescan if request else False

    # If a scan is already in progress, wait for it to finish
    async with rescan_lock:
        if force_full:
            logger.info("Manual full rescan triggered")
            cache = await rescan_seeds()
        else:
            logger.info("Manual rescan triggered (smart validation)")
            cache = await validate_and_update_cache()

        safe_seeds_cache = cache.get("files", {})

        safe_count = sum(1 for data in safe_seeds_cache.values() if data.get("is_safe"))
        return JSONResponse(
            {
                "status": "ok",
                "total_seeds": len(safe_seeds_cache),
                "safe_seeds": safe_count,
                "method": "full_rescan" if force_full else "smart_validation",
            }
        )


@app.delete("/seeds/{filename}")
async def delete_seed(filename: str):
    """Delete a custom seed (only from uploads directory)."""
    global safe_seeds_cache

    if filename not in safe_seeds_cache:
        return JSONResponse({"error": "Seed not found"}, status_code=404)

    seed_data = safe_seeds_cache[filename]
    file_path = Path(seed_data.get("path", ""))

    # Only allow deleting from uploads directory
    if not str(file_path).startswith(str(UPLOADS_DIR)):
        return JSONResponse(
            {"error": "Cannot delete default seeds"}, status_code=403
        )

    try:
        if file_path.exists():
            await asyncio.to_thread(file_path.unlink)
        del safe_seeds_cache[filename]

        # Update cache file
        cache = load_seeds_cache()
        cache["files"] = safe_seeds_cache
        save_seeds_cache(cache)

        logger.info(f"Deleted seed: {filename}")
        return JSONResponse({"status": "ok", "deleted": filename})

    except Exception as e:
        logger.error(f"Failed to delete seed {filename}: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


# ============================================================================
# WorldEngine WebSocket
# ============================================================================


# Status codes (client maps these to display text)
class Status:
    WAITING_FOR_SEED = "waiting_for_seed"
    INIT = "init"
    LOADING = "loading"
    READY = "ready"
    RESET = "reset"
    WARMUP = "warmup"


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for frame streaming.

    Protocol:
        Server -> Client:
            {"type": "status", "code": str}
            {"type": "frame", "data": base64_jpeg, "frame_id": int, "client_ts": float, "gen_ms": float}
            {"type": "error", "message": str}

        Client -> Server:
            {"type": "control", "buttons": [str], "mouse_dx": float, "mouse_dy": float, "ts": float}
            {"type": "set_model", "model": str}
            {"type": "reset"}
            {"type": "set_initial_seed", "filename": str}
            {"type": "prompt", "prompt": str}
            {"type": "prompt_with_seed", "filename": str}
            {"type": "pause"}
            {"type": "resume"}

    Status codes: waiting_for_seed, init, loading, ready, reset, warmup
    """
    client_host = websocket.client.host if websocket.client else "unknown"
    logger.info(f"Client connected: {client_host}")

    await websocket.accept()
    session = Session()
    # Each websocket session must perform an explicit model/seed handshake.
    # Do not reuse seed state from a previous disconnected client.
    world_engine.seed_frame = None

    async def send_json(data: dict):
        await websocket.send_text(json.dumps(data))

    async def reset_engine():
        await world_engine.reset_state()
        session.frame_count = 0
        await send_json({"type": "status", "code": Status.RESET})
        logger.info(f"[{client_host}] Engine Reset")

    async def load_initial_seed(filename: str | None) -> bool:
        """Validate and load seed into world_engine.seed_frame."""
        if not filename:
            await send_json({"type": "error", "message": "Missing filename"})
            return False

        if filename not in safe_seeds_cache:
            logger.warning(f"[{client_host}] Seed '{filename}' not in safety cache")
            await send_json(
                {"type": "error", "message": f"Seed '{filename}' not in safety cache"}
            )
            return False

        cached_entry = safe_seeds_cache[filename]
        if not cached_entry.get("is_safe", False):
            logger.warning(f"[{client_host}] Seed '{filename}' marked as unsafe")
            await send_json(
                {"type": "error", "message": f"Seed '{filename}' marked as unsafe"}
            )
            return False

        cached_hash = cached_entry.get("hash", "")
        file_path = cached_entry.get("path", "")
        if not os.path.exists(file_path):
            logger.error(f"[{client_host}] Seed file not found: {file_path}")
            await send_json(
                {"type": "error", "message": f"Seed file not found: {filename}"}
            )
            return False

        actual_hash = await asyncio.to_thread(compute_file_hash, file_path)
        if actual_hash != cached_hash:
            logger.warning(
                f"[{client_host}] File integrity check failed for '{filename}' - file may have been modified"
            )
            await send_json(
                {
                    "type": "error",
                    "message": "File integrity verification failed - please rescan seeds",
                }
            )
            return False

        logger.info(f"[{client_host}] Loading initial seed '{filename}'")
        loaded_frame = await world_engine.load_seed_from_file(file_path)
        if loaded_frame is None:
            await send_json({"type": "error", "message": "Failed to load seed image"})
            return False

        world_engine.seed_frame = loaded_frame
        logger.info(f"[{client_host}] Initial seed loaded successfully")
        return True

    async def handle_model_request(
        model_uri: str | None, live_switch: bool, seed_filename: str | None = None
    ) -> None:
        """Load/switch model and transition back to waiting-for-seed state."""
        model_uri = (model_uri or "").strip()
        if not model_uri:
            await send_json({"type": "error", "message": "Missing model id"})
            return

        if live_switch:
            logger.info(f"[{client_host}] Live model switch requested: {model_uri}")
        else:
            logger.info(f"[{client_host}] Requested model: {model_uri}")
        logger.info(f"[{client_host}] set_model seed payload: {seed_filename!r}")

        # Model switches can take tens of seconds. Keep emitting loading status so
        # clients don't treat the connection as stalled mid-switch.
        await send_json({"type": "status", "code": Status.LOADING})
        load_task = asyncio.create_task(world_engine.load_engine(model_uri))
        while True:
            try:
                await asyncio.wait_for(asyncio.shield(load_task), timeout=5.0)
                break
            except asyncio.TimeoutError:
                await send_json({"type": "status", "code": Status.LOADING})

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
            await send_json({"type": "status", "code": Status.WAITING_FOR_SEED})
        logger.info(f"[{client_host}] Model loaded: {world_engine.model_uri}")

    try:
        # Wait for initial seed from client
        await send_json({"type": "status", "code": Status.WAITING_FOR_SEED})
        logger.info(f"[{client_host}] Waiting for initial seed from client...")

        # Wait for model selection + initial seed message
        while world_engine.seed_frame is None:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                msg = json.loads(raw)
                msg_type = msg.get("type")

                if msg_type == "set_model":
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

        # If no model was selected by client, load default/current model now.
        if world_engine.engine is None:
            await send_json({"type": "status", "code": Status.LOADING})
            await world_engine.load_engine()

        if world_engine.seed_frame is None:
            logger.info(
                f"[{client_host}] Seed frame missing before initialization; client likely disconnected/reconnected during model switch"
            )
            return

        # Warmup on first connection AFTER seed is loaded
        if not world_engine.engine_warmed_up:
            await send_json({"type": "status", "code": Status.WARMUP})
            await world_engine.warmup()

        await send_json({"type": "status", "code": Status.INIT})

        logger.info(f"[{client_host}] Calling engine.reset()...")
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(world_engine.cuda_executor, world_engine.engine.reset)

        await send_json({"type": "status", "code": Status.LOADING})

        logger.info(f"[{client_host}] Calling append_frame...")
        await loop.run_in_executor(
            world_engine.cuda_executor,
            lambda: world_engine.engine.append_frame(world_engine.seed_frame)
        )

        # Send initial frame so client has something to display
        jpeg = await asyncio.to_thread(
            world_engine.frame_to_jpeg, world_engine.seed_frame
        )
        await send_json(
            {
                "type": "frame",
                "data": base64.b64encode(jpeg).decode("ascii"),
                "frame_id": 0,
                "client_ts": 0,
                "gen_ms": 0,
            }
        )

        await send_json({"type": "status", "code": Status.READY})
        logger.info(f"[{client_host}] Ready for game loop")
        paused = False

        # Helper to drain all pending messages and return only the latest control input
        async def get_latest_control():
            """Drain the message queue and return only the most recent control input."""
            latest_control_msg = None

            while True:
                try:
                    raw = await asyncio.wait_for(
                        websocket.receive_text(), timeout=0.001
                    )
                    msg = json.loads(raw)

                    # Handle non-control messages immediately
                    msg_type = msg.get("type", "control")
                    if msg_type != "control":
                        return msg  # Return special messages immediately

                    # For control messages, keep only the latest
                    latest_control_msg = msg

                except asyncio.TimeoutError:
                    # No more messages in queue
                    return latest_control_msg
                except WebSocketDisconnect:
                    raise

        # Main game loop
        while True:
            try:
                msg = await get_latest_control()
                if msg is None:
                    continue
            except WebSocketDisconnect:
                logger.info(f"[{client_host}] Client disconnected")
                break

            msg_type = msg.get("type", "control")

            match msg_type:
                case "set_model":
                    await handle_model_request(msg.get("model"), live_switch=True)
                    continue

                case "reset":
                    logger.info(f"[{client_host}] Reset requested")
                    await reset_engine()
                    continue

                case "pause":
                    paused = True
                    logger.info("[RECV] Paused")

                case "resume":
                    paused = False
                    logger.info("[RECV] Resumed")

                case "prompt":
                    new_prompt = msg.get("prompt", "").strip()
                    logger.info(f"[RECV] Prompt received: '{new_prompt[:50]}...'")
                    try:
                        from engine_manager import DEFAULT_PROMPT

                        world_engine.current_prompt = (
                            new_prompt if new_prompt else DEFAULT_PROMPT
                        )
                        await reset_engine()
                    except Exception as e:
                        logger.error(f"[GEN] Failed to set prompt: {e}")

                case "prompt_with_seed":
                    # Load new seed mid-session (server verifies against cache)
                    filename = msg.get("filename")
                    logger.info(f"[RECV] prompt_with_seed: filename={filename}")

                    try:
                        if not filename:
                            await send_json(
                                {
                                    "type": "error",
                                    "message": "Missing filename",
                                }
                            )
                            continue

                        # Check if seed is in safety cache
                        if filename not in safe_seeds_cache:
                            logger.warning(
                                f"[RECV] Seed '{filename}' not in safety cache"
                            )
                            await send_json(
                                {
                                    "type": "error",
                                    "message": f"Seed '{filename}' not in safety cache",
                                }
                            )
                            continue

                        cached_entry = safe_seeds_cache[filename]

                        # Verify is_safe flag
                        if not cached_entry.get("is_safe", False):
                            logger.warning(
                                f"[RECV] Seed '{filename}' marked as unsafe in cache"
                            )
                            await send_json(
                                {
                                    "type": "error",
                                    "message": f"Seed '{filename}' marked as unsafe",
                                }
                            )
                            continue

                        # Get cached hash and file path
                        cached_hash = cached_entry.get("hash", "")
                        file_path = cached_entry.get("path", "")

                        # Verify file exists
                        if not os.path.exists(file_path):
                            logger.error(f"[RECV] Seed file not found: {file_path}")
                            await send_json(
                                {
                                    "type": "error",
                                    "message": f"Seed file not found: {filename}",
                                }
                            )
                            continue

                        # Verify file integrity (check if file on disk matches cached hash)
                        actual_hash = await asyncio.to_thread(
                            compute_file_hash, file_path
                        )
                        if actual_hash != cached_hash:
                            logger.warning(
                                f"[RECV] File integrity check failed for '{filename}' - file may have been modified"
                            )
                            await send_json(
                                {
                                    "type": "error",
                                    "message": "File integrity verification failed - please rescan seeds",
                                }
                            )
                            continue

                        # All checks passed - load the seed
                        logger.info(f"[RECV] Loading seed '{filename}' from {file_path}")
                        loaded_frame = await world_engine.load_seed_from_file(file_path)

                        if loaded_frame is not None:
                            world_engine.seed_frame = loaded_frame
                            logger.info(f"[RECV] Seed '{filename}' loaded successfully")
                            await reset_engine()
                        else:
                            await send_json(
                                {
                                    "type": "error",
                                    "message": f"Failed to load seed image: {filename}",
                                }
                            )

                    except Exception as e:
                        logger.error(f"[GEN] Failed to set seed: {e}")
                        await send_json(
                            {
                                "type": "error",
                                "message": f"Failed to set seed: {str(e)}",
                            }
                        )

                case "control":
                    if paused:
                        continue

                    buttons = {
                        BUTTON_CODES[b.upper()]
                        for b in msg.get("buttons", [])
                        if b.upper() in BUTTON_CODES
                    }
                    mouse_dx = float(msg.get("mouse_dx", 0))
                    mouse_dy = float(msg.get("mouse_dy", 0))
                    client_ts = msg.get("ts", 0)

                    if session.frame_count >= session.max_frames:
                        logger.info(f"[{client_host}] Auto-reset at frame limit")
                        await reset_engine()

                    ctrl = world_engine.CtrlInput(
                        button=buttons, mouse=(mouse_dx, mouse_dy)
                    )

                    t0 = time.perf_counter()
                    try:
                        frame = await world_engine.generate_frame(ctrl)
                        gen_time = (time.perf_counter() - t0) * 1000

                        session.frame_count += 1

                        # Encode and send frame with timing info
                        jpeg = await asyncio.to_thread(world_engine.frame_to_jpeg, frame)
                        await send_json(
                            {
                                "type": "frame",
                                "data": base64.b64encode(jpeg).decode("ascii"),
                                "frame_id": session.frame_count,
                                "client_ts": client_ts,
                                "gen_ms": gen_time,
                            }
                        )

                        # Logging
                        if session.frame_count % 60 == 0:
                            logger.info(
                                f"[{client_host}] Received control (buttons={buttons}, mouse=({mouse_dx},{mouse_dy})) -> Sent frame {session.frame_count} (gen={gen_time:.1f}ms)"
                            )
                    except Exception as cuda_err:
                        # Check if it's a CUDA-related error (RuntimeError or torch.AcceleratorError)
                        error_msg = str(cuda_err)
                        is_cuda_error = any(keyword in error_msg.lower() for keyword in ['cuda', 'cublas', 'graph capture', 'offset increment'])

                        if is_cuda_error:
                            logger.error(f"[{client_host}] CUDA error detected: {cuda_err}")

                            # Attempt recovery
                            recovery_success = await world_engine.recover_from_cuda_error()

                            if recovery_success:
                                await send_json({
                                    "type": "status",
                                    "code": Status.RESET,
                                    "message": "Recovered from CUDA error - engine reset"
                                })
                                logger.info(f"[{client_host}] Successfully recovered from CUDA error")
                            else:
                                await send_json({
                                    "type": "error",
                                    "message": "CUDA error - recovery failed. Please reconnect."
                                })
                                logger.error(f"[{client_host}] Failed to recover from CUDA error")
                                break
                        else:
                            # Re-raise if not a CUDA error
                            raise

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
        logger.info(f"[{client_host}] Disconnected (frames: {session.frame_count})")


# ============================================================================
# Entry Point
# ============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Biome Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=7987, help="Port to bind to")
    args = parser.parse_args()

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        ws_ping_interval=300,
        ws_ping_timeout=300,
    )
