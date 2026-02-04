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
import json
import logging
import time
from contextlib import asynccontextmanager

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

    print("[BIOME] Importing WorldEngine module...", flush=True)
    from world_engine import WorldEngineManager, Session, BUTTON_CODES

    print("[BIOME] WorldEngine module imported", flush=True)

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

# ============================================================================
# Application Lifecycle
# ============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle handler."""
    global world_engine, safety_checker

    logger.info("=" * 60)
    logger.info("BIOME SERVER STARTUP")
    logger.info("=" * 60)

    # Initialize modules
    logger.info("Initializing WorldEngine...")
    world_engine = WorldEngineManager()

    logger.info("Initializing Safety Checker...")
    safety_checker = SafetyChecker()

    # Load WorldEngine on startup
    await world_engine.load_engine()

    logger.info("=" * 60)
    logger.info("[SERVER] Ready - WorldEngine and Safety modules loaded")
    logger.info("=" * 60)
    print("SERVER READY", flush=True)  # Signal for Rust to detect

    yield

    # Cleanup
    logger.info("[SERVER] Shutting down")


app = FastAPI(title="Biome Server", lifespan=lifespan)

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
            {"type": "reset"}
            {"type": "set_initial_seed", "seed_base64": str}
            {"type": "prompt", "prompt": str}
            {"type": "prompt_with_seed", "prompt": str, "seed_url": str}
            {"type": "pause"}
            {"type": "resume"}

    Status codes: waiting_for_seed, init, loading, ready, reset, warmup
    """
    client_host = websocket.client.host if websocket.client else "unknown"
    logger.info(f"Client connected: {client_host}")

    await websocket.accept()
    session = Session()

    async def send_json(data: dict):
        await websocket.send_text(json.dumps(data))

    async def reset_engine():
        await world_engine.reset_state()
        session.frame_count = 0
        await send_json({"type": "status", "code": Status.RESET})
        logger.info(f"[{client_host}] Engine Reset")

    try:
        # Wait for initial seed from client
        await send_json({"type": "status", "code": Status.WAITING_FOR_SEED})
        logger.info(f"[{client_host}] Waiting for initial seed from client...")

        # Wait for set_initial_seed message
        while world_engine.seed_frame is None:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                msg = json.loads(raw)
                msg_type = msg.get("type")

                if msg_type == "set_initial_seed":
                    seed_base64 = msg.get("seed_base64")
                    if seed_base64:
                        logger.info(
                            f"[{client_host}] Received initial seed ({len(seed_base64)} chars)"
                        )
                        loaded_frame = world_engine.load_seed_from_base64(seed_base64)
                        if loaded_frame is not None:
                            world_engine.seed_frame = loaded_frame
                            logger.info(f"[{client_host}] Initial seed loaded successfully")
                        else:
                            await send_json(
                                {"type": "error", "message": "Failed to decode seed image"}
                            )
                    else:
                        await send_json(
                            {"type": "error", "message": "No seed_base64 provided"}
                        )
                else:
                    logger.info(
                        f"[{client_host}] Ignoring message type '{msg_type}' while waiting for seed"
                    )

            except asyncio.TimeoutError:
                await send_json(
                    {"type": "error", "message": "Timeout waiting for initial seed"}
                )
                return

        # Warmup on first connection AFTER seed is loaded
        if not world_engine.engine_warmed_up:
            await send_json({"type": "status", "code": Status.WARMUP})
            await world_engine.warmup()

        await send_json({"type": "status", "code": Status.INIT})

        logger.info(f"[{client_host}] Calling engine.reset()...")
        await asyncio.to_thread(world_engine.engine.reset)

        await send_json({"type": "status", "code": Status.LOADING})

        logger.info(f"[{client_host}] Calling append_frame...")
        await asyncio.to_thread(world_engine.engine.append_frame, world_engine.seed_frame)

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
            skipped_count = 0

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
                    if latest_control_msg is not None:
                        skipped_count += 1
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
                        from world_engine import DEFAULT_PROMPT

                        world_engine.current_prompt = (
                            new_prompt if new_prompt else DEFAULT_PROMPT
                        )
                        await reset_engine()
                    except Exception as e:
                        logger.error(f"[GEN] Failed to set prompt: {e}")

                case "prompt_with_seed":
                    new_prompt = msg.get("prompt", "").strip()
                    seed_url = msg.get("seed_url")
                    logger.info(
                        f"[RECV] Prompt with seed: '{new_prompt}', URL: {seed_url}"
                    )
                    try:
                        if seed_url:
                            url_frame = world_engine.load_seed_from_url(seed_url)
                            if url_frame is not None:
                                world_engine.seed_frame = url_frame
                                logger.info("[RECV] Seed frame loaded from URL")

                        from world_engine import DEFAULT_PROMPT

                        world_engine.current_prompt = (
                            new_prompt if new_prompt else DEFAULT_PROMPT
                        )
                        logger.info(
                            "[RECV] Seed frame prompt loaded from URL, resetting engine"
                        )
                        await reset_engine()
                    except Exception as e:
                        logger.error(f"[GEN] Failed to set prompt: {e}")

                case "set_initial_seed":
                    # Allow updating the seed mid-session
                    seed_base64 = msg.get("seed_base64")
                    logger.info(
                        f"[RECV] set_initial_seed received ({len(seed_base64) if seed_base64 else 0} chars)"
                    )
                    try:
                        if seed_base64:
                            loaded_frame = world_engine.load_seed_from_base64(
                                seed_base64
                            )
                            if loaded_frame is not None:
                                world_engine.seed_frame = loaded_frame
                                logger.info("[RECV] Seed frame updated from base64")
                                await reset_engine()
                            else:
                                await send_json(
                                    {
                                        "type": "error",
                                        "message": "Failed to decode seed image",
                                    }
                                )
                        else:
                            await send_json(
                                {"type": "error", "message": "No seed_base64 provided"}
                            )
                    except Exception as e:
                        logger.error(f"[GEN] Failed to set seed: {e}")

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

    except Exception as e:
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
