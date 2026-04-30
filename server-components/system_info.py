"""
Server system/runtime introspection.

Single home for:
  * Host identity snapshot queried once at startup (CPU/GPU/driver/etc.), logged
    so every error in server.log has hardware context above it
    (Overworldai/Biome#98) and reused by WS sessions instead of re-querying.
  * Live metrics sampler (VRAM, GPU util) used by frame-header metrics.
  * Error snapshot — a one-shot capture of ephemeral state (RAM/VRAM/GPU util)
    attached to outgoing error push messages, so bug reports include the
    momentary state at the failure point rather than steady-state idle values.

All three share the same NVML handle and care about the same hardware, so they
live together.
"""

from __future__ import annotations

from typing import TypedDict

import torch

from server_logging import logger


class SystemInfo(TypedDict, total=False):
    cpu_name: str | None
    gpu_name: str | None
    vram_total_bytes: int | None
    cuda_version: str | None
    driver_version: str | None
    torch_version: str
    gpu_count: int


# Module-level caches — populated by collect_system_info().
system_info: SystemInfo = {}
nvml_handle = None


def collect_system_info() -> SystemInfo:
    """Query hardware / software identifiers.

    Safe to call once at startup; each subsystem (cpuinfo, torch, NVML) is
    wrapped so a failure in one doesn't prevent the others from populating.
    Also initializes the module-level NVML handle used by the live samplers.
    """
    global nvml_handle

    info: SystemInfo = {
        "cpu_name": None,
        "gpu_name": None,
        "vram_total_bytes": None,
        "cuda_version": None,
        "driver_version": None,
        "torch_version": torch.__version__,
        "gpu_count": 0,
    }

    try:
        import cpuinfo
        info["cpu_name"] = cpuinfo.get_cpu_info().get("brand_raw") or None
    except Exception as e:
        logger.warning(f"Failed to query CPU info: {e}")

    try:
        if torch.cuda.is_available():
            info["gpu_count"] = torch.cuda.device_count()
            info["gpu_name"] = torch.cuda.get_device_name(0) or None
            info["vram_total_bytes"] = torch.cuda.get_device_properties(0).total_memory
            info["cuda_version"] = torch.version.cuda
    except Exception as e:
        logger.warning(f"Failed to query GPU info: {e}")

    try:
        import pynvml
        pynvml.nvmlInit()
        nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(
            torch.cuda.current_device() if torch.cuda.is_available() else 0
        )
        try:
            raw = pynvml.nvmlSystemGetDriverVersion()
            info["driver_version"] = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        except Exception:
            pass
    except Exception as e:
        logger.warning(f"Failed to initialize NVML: {e}")

    return info


def log_system_info(info: SystemInfo) -> None:
    gpu_name = info.get("gpu_name") or "[unknown]"
    gpu_count = info.get("gpu_count", 0) or 0
    gpu_summary = f"{gpu_name} (x{gpu_count})" if gpu_count > 1 else gpu_name
    vram_bytes = info.get("vram_total_bytes")
    vram_str = f", {vram_bytes // (1024 * 1024)} MB VRAM" if vram_bytes else ""
    logger.info("System info:")
    logger.info(f"  CPU:    {info.get('cpu_name') or '[unknown]'}")
    logger.info(f"  GPU:    {gpu_summary}{vram_str}")
    logger.info(f"  CUDA:   {info.get('cuda_version') or '[unavailable]'}")
    logger.info(f"  Driver: {info.get('driver_version') or '[unknown]'}")
    logger.info(f"  Torch:  {info.get('torch_version')}")


def initialize() -> SystemInfo:
    """Collect + log system info.  Call once at startup."""
    global system_info
    system_info = collect_system_info()
    log_system_info(system_info)
    return system_info


# ---------------------------------------------------------------------------
# Live samplers
# ---------------------------------------------------------------------------


def get_gpu_util_percent() -> int:
    """Current GPU utilization (0-100), or -1 if unavailable.

    Prefers `torch.cuda.utilization()` (fast path); falls back to NVML which
    talks to the same driver as nvidia-smi.
    """
    try:
        util = torch.cuda.utilization()
        if util >= 0:
            return int(util)
    except Exception:
        pass
    if nvml_handle is not None:
        try:
            import pynvml
            return int(pynvml.nvmlDeviceGetUtilizationRates(nvml_handle).gpu)
        except Exception:
            pass
    return -1


def get_vram_used_bytes() -> int:
    """Current VRAM allocated by torch on device 0, in bytes.  -1 if unavailable."""
    try:
        if torch.cuda.is_available():
            return torch.cuda.memory_allocated()
    except Exception:
        pass
    return -1


def get_vram_reserved_bytes() -> int:
    """VRAM currently held by torch's allocator (allocated + cached), in bytes."""
    try:
        if torch.cuda.is_available():
            return torch.cuda.memory_reserved()
    except Exception:
        pass
    return -1


# ---------------------------------------------------------------------------
# Error snapshot
# ---------------------------------------------------------------------------


class ErrorSnapshot(TypedDict, total=False):
    # Host process
    process_rss_bytes: int
    ram_used_bytes: int
    ram_total_bytes: int
    # GPU
    vram_used_bytes: int
    vram_reserved_bytes: int
    gpu_util_percent: int


def capture_error_snapshot() -> ErrorSnapshot:
    """Best-effort snapshot of ephemeral state at the moment of an error.

    Attached to outgoing error push messages so bug reports include what the
    server was actually doing at failure time, not the idle state recorded
    when the user later clicks "Copy Report".
    """
    snap: ErrorSnapshot = {}

    try:
        import psutil
        process = psutil.Process()
        snap["process_rss_bytes"] = process.memory_info().rss
        vm = psutil.virtual_memory()
        snap["ram_used_bytes"] = vm.total - vm.available
        snap["ram_total_bytes"] = vm.total
    except Exception:
        pass

    vram_used = get_vram_used_bytes()
    if vram_used >= 0:
        snap["vram_used_bytes"] = vram_used
    vram_reserved = get_vram_reserved_bytes()
    if vram_reserved >= 0:
        snap["vram_reserved_bytes"] = vram_reserved

    util = get_gpu_util_percent()
    if util >= 0:
        snap["gpu_util_percent"] = util

    return snap
