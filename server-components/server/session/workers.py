"""
The three concurrency workers that drive a WebSocket session.

`run_receiver` (asyncio task) drains inbound messages and dispatches them
to typed handlers. `run_sender` (asyncio task) ferries the frame queue
out over the WebSocket. `run_generator` (dedicated thread, runs sync)
owns the per-frame inference loop, batches device output for deferred
JPEG encoding, drains scene-authoring futures at clean frame boundaries,
and recovers from device errors.

The three communicate exclusively through `Connection` — its frame queue,
control state, scene-authoring handoff fields, and the `running` /
`paused` flags. No closure capture between them.
"""

# pyright: reportMissingTypeArgument=none, reportMissingTypeStubs=none, reportUnknownArgumentType=none, reportUnknownMemberType=none, reportUnknownVariableType=none

import asyncio
import concurrent.futures
import contextlib
import logging
import threading
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import WebSocketDisconnect
from pydantic import ValidationError
from world_engine import CtrlInput

from engine import devices
from engine.keymap import BUTTON_CODES
from engine.scene_authoring import run_generate_scene, run_scene_edit
from server.protocol import (
    CheckSeedSafetyRequest,
    ClientMessage,
    ClientMessageAdapter,
    ControlNotif,
    GenerateSceneRequest,
    InitRequest,
    MessageId,
    PauseNotif,
    PromptNotif,
    ResetNotif,
    ResumeNotif,
    RpcError,
    RpcSuccess,
    SceneEditRequest,
    StageId,
    StatusMessage,
    rpc_err,
    rpc_ok,
)
from server.session.connection import Connection
from server.session.handlers import build_init_response_data, handle_check_seed_safety, handle_init

if TYPE_CHECKING:
    from engine import Engines
    from engine.manager import WorldEngineManager

logger = logging.getLogger(__name__)


async def run_session(
    conn: Connection,
    engines: "Engines",
) -> None:
    """Spawn the generator thread + receiver / sender asyncio tasks for
    the active session, then await disconnect or terminal error. The
    first-to-finish task signals shutdown; the surviving sibling and
    the gen thread are torn down together via `conn.running = False`."""
    gen_thread = threading.Thread(
        target=run_generator,
        args=(conn, engines),
        daemon=True,
        name=f"gen-{conn.client_host}",
    )
    gen_thread.start()

    recv_task = asyncio.create_task(
        run_receiver(
            conn,
            engines,
            BUTTON_CODES,
        )
    )
    send_task = asyncio.create_task(run_sender(conn))
    _done, pending = await asyncio.wait(
        [recv_task, send_task],
        return_when=asyncio.FIRST_COMPLETED,
    )

    conn.running = False
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


def reset_engine(
    conn: Connection,
    world_engine: "WorldEngineManager",
) -> None:
    """Restore the original seed and reset the engine session. Synchronous —
    runs device work via the executor. Called from the generator thread when
    `reset_flag` flips, `prompt_pending` arrives, or an auto-reset triggers
    at the perceptual frame limit."""
    if world_engine.original_seed_frame is not None:
        world_engine.seed_frame = world_engine.original_seed_frame
    world_engine.set_progress_callback(conn.push_progress, conn.main_loop)
    world_engine.init_session()
    world_engine.set_progress_callback(None)
    conn.perceptual_frame_count = 0
    logger.info(f"[{conn.client_host}] Engine Reset")


@dataclass
class _PendingFlush:
    """One batch of CPU frames stashed by the inference path so the next
    loop iteration can JPEG-encode + send them while the GPU works on the
    following frame. The fields cover both the frames themselves and the
    timing breakdown that ends up in the binary frame header."""

    cpu_frames: list
    gen_time: float
    temporal_compression: int
    client_ts: float
    t_infer_start: float
    t_infer: float
    t_sync: float


async def run_receiver(
    conn: Connection,
    engines: "Engines",
    button_codes: dict[str, int],
) -> None:
    """Drain inbound websocket messages, dispatch them via the typed
    protocol union. Posts scene-edit / generate-scene futures into
    `conn.scene_edit_request` / `conn.generate_scene_request` for the
    generator thread to resolve at the next clean frame boundary."""
    world_engine = engines.world_engine
    scene_authoring = engines.scene_authoring
    safety_checker = engines.safety_checker

    while conn.running:
        try:
            raw = await conn.websocket.receive_text()
            try:
                parsed: ClientMessage = ClientMessageAdapter.validate_json(raw)
            except (ValidationError, ValueError) as e:
                logger.info(f"[{conn.client_host}] Ignoring invalid game-loop message: {e}")
                continue

            match parsed:
                case InitRequest() as req:
                    # init RPC: apply deltas and respond with metrics.
                    ready, new_seed = await handle_init(conn, world_engine, safety_checker, req, is_game_loop=True)
                    if ready:
                        response = rpc_ok(req.req_id, build_init_response_data(world_engine, conn.system_monitor.info))
                    else:
                        response = rpc_err(req.req_id, error_id=MessageId.INIT_FAILED)
                    conn.queue_send(response)
                    if new_seed:
                        conn.reset_flag = True

                case SceneEditRequest() as req:
                    # scene_edit is handled by the generator thread at
                    # the next clean frame boundary — post a request and
                    # await the future.
                    prompt = req.prompt.strip()
                    if conn.action_logger is not None:
                        conn.action_logger.scene_edit(prompt)
                    edit_response: RpcSuccess | RpcError
                    if not prompt:
                        edit_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_EMPTY_PROMPT)
                    elif not scene_authoring.is_loaded:
                        edit_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_MODEL_NOT_LOADED)
                    elif conn.scene_edit_request is not None:
                        edit_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_ALREADY_IN_PROGRESS)
                    else:
                        fut = concurrent.futures.Future()
                        conn.scene_edit_request = {"prompt": prompt, "future": fut}
                        try:
                            preview = await asyncio.wrap_future(fut)
                            edit_response = rpc_ok(req.req_id, preview)
                        except Exception as e:  # noqa: BLE001  -- scene-edit future resolves with any worker-side exception; we map message_id-bearing ones and forward the rest verbatim
                            error_id = getattr(e, "message_id", None)
                            if error_id is not None:
                                edit_response = rpc_err(req.req_id, error_id=MessageId(error_id))
                            else:
                                edit_response = rpc_err(req.req_id, error=str(e))
                    conn.queue_send(edit_response)

                case GenerateSceneRequest() as req:
                    # generate_scene: like scene_edit but with a blank
                    # canvas — generates a new seed from a text prompt.
                    prompt = req.prompt.strip()
                    gen_response: RpcSuccess | RpcError
                    if not prompt:
                        gen_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_EMPTY_PROMPT)
                    elif not scene_authoring.is_loaded:
                        gen_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_MODEL_NOT_LOADED)
                    elif conn.scene_edit_request is not None or conn.generate_scene_request is not None:
                        gen_response = rpc_err(req.req_id, error_id=MessageId.SCENE_AUTHORING_ALREADY_IN_PROGRESS)
                    else:
                        fut = concurrent.futures.Future()
                        conn.generate_scene_request = {"prompt": prompt, "future": fut}
                        try:
                            data = await asyncio.wrap_future(fut)
                            gen_response = rpc_ok(req.req_id, data)
                        except Exception as e:  # noqa: BLE001  -- generate-scene future resolves with any worker-side exception; we map message_id-bearing ones and forward the rest verbatim
                            error_id = getattr(e, "message_id", None)
                            if error_id is not None:
                                gen_response = rpc_err(req.req_id, error_id=MessageId(error_id))
                            else:
                                gen_response = rpc_err(req.req_id, error=str(e))
                    conn.queue_send(gen_response)

                case CheckSeedSafetyRequest() as req:
                    seed_response = await handle_check_seed_safety(safety_checker, req)
                    conn.queue_send(seed_response)

                case ResetNotif():
                    logger.info(f"[{conn.client_host}] Reset requested")
                    conn.reset_flag = True

                case PauseNotif():
                    conn.paused = True
                    logger.info("[RECV] Paused")

                case ResumeNotif():
                    conn.paused = False
                    logger.info("[RECV] Resumed")

                case PromptNotif() as notif:
                    conn.prompt_pending = notif.prompt.strip()

                case ControlNotif() as notif:
                    if conn.paused:
                        continue
                    buttons = {button_codes[b.upper()] for b in notif.buttons if b.upper() in button_codes}
                    with conn.ctrl_lock:
                        conn.ctrl.buttons = buttons
                        conn.ctrl.mouse_dx += notif.mouse_dx
                        conn.ctrl.mouse_dy += notif.mouse_dy
                        if notif.ts is not None:
                            conn.ctrl.client_ts = notif.ts
                        conn.ctrl.dirty = True

        except WebSocketDisconnect:
            logger.info(f"[{conn.client_host}] Client disconnected")
            conn.running = False
            break
        except Exception as e:
            logger.error(f"[{conn.client_host}] Receiver error: {e}", exc_info=True)
            conn.running = False
            break


async def run_sender(conn: Connection) -> None:
    """Drain `conn.frame_queue` and dispatch each entry over the WebSocket.

    Binary frames go via `send_bytes`; Pydantic messages route through
    `conn.send_message`. Exits when `conn.running` flips off or any
    transport error occurs (which also flips `conn.running` to halt
    the receiver and generator)."""
    while conn.running:
        try:
            await conn.frame_ready.wait()
            conn.frame_ready.clear()
            while not conn.frame_queue.empty():
                payload = conn.frame_queue.get_nowait()
                if isinstance(payload, bytes):
                    await conn.websocket.send_bytes(payload)
                else:
                    await conn.send_message(payload)
        except Exception as e:
            logger.error(f"[{conn.client_host}] Sender error: {e}", exc_info=True)
            conn.running = False
            break


def run_generator(
    conn: Connection,
    engines: "Engines",
) -> None:
    """The per-session inference loop, run on a dedicated thread.

    Submits gen_frame to the device thread, overlaps JPEG encoding of the
    previous batch with the next device pass, drains scene-edit / generate-
    scene futures at clean frame boundaries, applies frame pacing, and
    recovers from device errors via WorldEngineManager.recover_from_device_error.
    """
    world_engine = engines.world_engine
    pending: _PendingFlush | None = None

    def _flush_pending() -> None:
        """JPEG-encode + queue any pending CPU frames."""
        nonlocal pending
        if pending is None:
            return
        p = pending
        pending = None

        t_enc_start = time.perf_counter()
        encoded = [world_engine.numpy_to_jpeg(rgb) for rgb in p.cpu_frames]
        t_enc = time.perf_counter()

        if conn.perceptual_frame_count % 5 == 0:
            conn.update_gpu_metrics()
        t_metrics = time.perf_counter()

        for jpeg in encoded:
            conn.perceptual_frame_count += 1
            t_queued = time.perf_counter()
            profile = {
                "t_infer_ms": round((p.t_infer - p.t_infer_start) * 1000, 1),
                "t_sync_ms": round((p.t_sync - p.t_infer) * 1000, 1),
                "t_enc_ms": round((t_enc - t_enc_start) * 1000, 1),
                "t_metrics_ms": round((t_metrics - t_enc) * 1000, 1),
                "t_overhead_ms": round((t_queued - t_metrics) * 1000, 1),
            }
            conn.queue_send(
                conn.build_frame_envelope(
                    jpeg,
                    conn.perceptual_frame_count,
                    p.client_ts,
                    p.gen_time,
                    temporal_compression=p.temporal_compression,
                    profile=profile,
                )
            )

        if conn.perceptual_frame_count % 60 == 0:
            logger.info(f"[{conn.client_host}] Sent frame {conn.perceptual_frame_count} (gen={p.gen_time:.1f}ms)")

    gen_was_paused = False
    next_frame_time = 0.0  # perf_counter target for frame pacing

    while conn.running:
        if conn.paused:
            _flush_pending()
            if not gen_was_paused:
                conn.end_action_log_segment()
                conn.end_video_segment()
                gen_was_paused = True

            # Handle generate_scene while paused (it's triggered from
            # the pause menu, so the generator must process it here).
            if conn.generate_scene_request is not None:
                req = conn.generate_scene_request
                conn.generate_scene_request = None
                try:
                    data = run_generate_scene(engines, req["prompt"], conn.biome_version)
                    conn.perceptual_frame_count = 0
                    req["future"].set_result(data)
                    # Send the generated seed as a single frame so the pause
                    # overlay background updates to show the new scene.
                    seed = world_engine.primary_seed_frame
                    assert seed is not None, "seed must be loaded after generate_scene"
                    seed_jpeg = world_engine.frame_to_jpeg(seed)
                    conn.queue_send(conn.build_frame_envelope(seed_jpeg, conn.perceptual_frame_count, 0.0, 0.0))
                except Exception as e:
                    logger.error(f"[GENERATE_SCENE] Failed: {e}", exc_info=True)
                    req["future"].set_exception(e)

            time.sleep(0.01)
            next_frame_time = 0.0
            continue

        if gen_was_paused:
            gen_was_paused = False
            conn.start_action_log_segment(world_engine)
            conn.start_video_segment(world_engine)

        try:
            # Start frame timer before pacing sleep so gen_time
            # reflects actual frame-to-frame throughput.
            t0 = time.perf_counter()

            # Frame pacing: sleep until target time, just before
            # reading input, so we use the freshest controls.
            if conn.cap_inference_fps and next_frame_time > 0.0:
                sleep_time = next_frame_time - time.perf_counter()
                if sleep_time > 0.001:
                    time.sleep(sleep_time)

            if conn.prompt_pending is not None:
                _flush_pending()
                conn.prompt_pending = None
                reset_engine(conn, world_engine)
                conn.start_action_log_segment(world_engine)
                conn.start_video_segment(world_engine)
                next_frame_time = 0.0

            # Auto-reset at context length limit (single-frame models only;
            # multiframe models don't support mid-session reset).
            auto_reset = not world_engine.is_multiframe and conn.perceptual_frame_count >= conn.max_perceptual_frames
            if conn.reset_flag or auto_reset:
                _flush_pending()
                if auto_reset:
                    logger.info(f"[{conn.client_host}] Auto-reset at frame limit")
                reset_engine(conn, world_engine)
                conn.reset_flag = False
                conn.start_action_log_segment(world_engine)
                conn.start_video_segment(world_engine)
                next_frame_time = 0.0

            # Handle pending scene edit — runs inpainting on the last
            # subframe from the most recent gen_frame, then appends.
            if conn.scene_edit_request is not None and conn.last_generated_cpu_frames is not None:
                req = conn.scene_edit_request
                conn.scene_edit_request = None
                _flush_pending()
                try:
                    preview = run_scene_edit(engines, req["prompt"], conn.last_generated_cpu_frames)
                    conn.perceptual_frame_count = 0
                    if conn.video_recorder is not None:
                        conn.video_recorder.note_edit(req["prompt"])
                    req["future"].set_result(preview)
                except Exception as e:
                    logger.error(f"[SCENE_EDIT] Failed: {e}", exc_info=True)
                    req["future"].set_exception(e)

            # Handle pending generate_scene — creates a new seed from
            # a text prompt (blank canvas + inpainting pipeline).
            if conn.generate_scene_request is not None:
                req = conn.generate_scene_request
                conn.generate_scene_request = None
                _flush_pending()
                try:
                    data = run_generate_scene(engines, req["prompt"], conn.biome_version)
                    conn.perceptual_frame_count = 0
                    req["future"].set_result(data)
                except Exception as e:
                    logger.error(f"[GENERATE_SCENE] Failed: {e}", exc_info=True)
                    req["future"].set_exception(e)

            buttons: set[int] | None = None
            mouse_dx = 0.0
            mouse_dy = 0.0
            client_ts = 0.0
            with conn.ctrl_lock:
                if conn.ctrl.dirty:
                    buttons = set(conn.ctrl.buttons)
                    mouse_dx = float(conn.ctrl.mouse_dx)
                    mouse_dy = float(conn.ctrl.mouse_dy)
                    client_ts = conn.ctrl.client_ts
                    conn.ctrl.mouse_dx = 0.0
                    conn.ctrl.mouse_dy = 0.0
                    conn.ctrl.dirty = False

            if buttons is None:
                _flush_pending()
                time.sleep(0.001)
                continue

            ctrl = CtrlInput(button=buttons, mouse=(mouse_dx, mouse_dy))

            if conn.action_logger is not None:
                conn.action_logger.frame_input(
                    buttons=buttons,
                    mouse_dx=mouse_dx,
                    mouse_dy=mouse_dy,
                    client_ts=client_ts,
                )

            # client_ts is a performance.now() timestamp from the browser;
            # we can't compare clocks, but we CAN forward it so the client
            # can measure the full round-trip on its own clock.
            t_infer_start = time.perf_counter()

            # Advance frame pacing target for next iteration.
            if conn.cap_inference_fps:
                fps = world_engine.inference_fps
                if fps > 0:
                    frame_interval = world_engine.temporal_compression / fps
                    if next_frame_time == 0.0:
                        next_frame_time = t_infer_start + frame_interval
                    else:
                        next_frame_time = max(t_infer_start, next_frame_time) + frame_interval

            # Submit inference to the device thread (non-blocking) so we can
            # overlap JPEG encoding of the previous batch with device work.
            device_future = world_engine.submit_gen_frame(ctrl)

            # Encode + send previous batch while the device is busy
            _flush_pending()

            # Wait for device result
            result = device_future.result()
            t_infer = time.perf_counter()

            devices.synchronize()
            t_sync = time.perf_counter()

            gen_time = (t_sync - t0) * 1000
            temporal_compression = world_engine.temporal_compression

            # Transfer result tensors to CPU numpy arrays immediately while
            # the data is still valid (gen_frame may reuse device buffers
            # on the next call).
            if temporal_compression > 1:
                cpu_frames = [world_engine.tensor_to_numpy(result[i]) for i in range(result.shape[0])]
            else:
                cpu_frames = [world_engine.tensor_to_numpy(result)]

            # Keep all subframes for scene editing (read by receiver thread)
            conn.last_generated_cpu_frames = cpu_frames

            if conn.video_recorder is not None:
                conn.video_recorder.write_frames(cpu_frames)

            # Stash this batch's CPU frames for deferred JPEG encoding
            pending = _PendingFlush(
                cpu_frames=cpu_frames,
                gen_time=gen_time,
                temporal_compression=temporal_compression,
                client_ts=client_ts,
                t_infer_start=t_infer_start,
                t_infer=t_infer,
                t_sync=t_sync,
            )

        except Exception as device_err:
            pending = None

            if devices.is_recoverable_device_error(device_err):
                logger.error(f"[{conn.client_host}] Device error detected: {device_err}")  # noqa: TRY400  -- recovery path follows; recovery handler logs its own traceback if needed
                try:
                    recovery_success = world_engine.recover_from_device_error()
                except Exception:  # noqa: BLE001  -- recovery is itself best-effort; failure here means we treat the session as terminal
                    recovery_success = False

                if recovery_success:
                    conn.queue_send(
                        StatusMessage(
                            stage=StageId.SESSION_RESET,
                            message="Recovered from device error - engine reset",
                        )
                    )
                    logger.info(f"[{conn.client_host}] Successfully recovered from device error")
                else:
                    conn.queue_error(message_id=MessageId.DEVICE_RECOVERY_FAILED)
                    logger.error(f"[{conn.client_host}] Failed to recover from device error")  # noqa: TRY400  -- final status; recovery handler already logged the traceback
                    conn.running = False
                    break
            else:
                logger.error(f"[{conn.client_host}] Generation error: {device_err}", exc_info=True)
                conn.queue_error(message=str(device_err))
                conn.running = False
                break

    # Flush the last batch before the thread exits
    with contextlib.suppress(Exception):
        _flush_pending()
