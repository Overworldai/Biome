"""
Server system/runtime introspection.

`SystemMonitor` is the one-stop access point: a snapshot of static hardware
identity queried once at startup (CPU/GPU/driver/etc.), live samplers (VRAM,
GPU util) for frame-header metrics, and an error-snapshot builder used when
constructing `error` push messages.

One instance per process — constructed at startup in `main.py` and threaded
through to consumers (no module globals). The wire-typed `SystemInfo` and
`ErrorSnapshot` Pydantic models live in `protocol.py`; this module produces
and consumes them directly.
"""

import cpuinfo
import psutil
import pynvml
import torch

from server.protocol import ErrorSnapshot, SystemInfo
from util.server_logging import logger


def _collect_system_info_and_nvml() -> tuple[SystemInfo, object]:
    """Query CPU / GPU / NVML once at startup. Returns the static info plus
    the opaque NVML handle (or `None` if NVML init failed). Each subsystem
    is wrapped so a failure in one doesn't prevent the others from
    populating."""
    cpu_name: str | None = None
    gpu_name: str | None = None
    vram_total_bytes: int | None = None
    cuda_version: str | None = None
    driver_version: str | None = None
    gpu_count = 0
    nvml_handle: object | None = None

    try:
        cpu_name = cpuinfo.get_cpu_info().get("brand_raw") or None
    except Exception as e:
        logger.warning(f"Failed to query CPU info: {e}")

    try:
        if torch.cuda.is_available():
            gpu_count = torch.cuda.device_count()
            gpu_name = torch.cuda.get_device_name(0) or None
            vram_total_bytes = torch.cuda.get_device_properties(0).total_memory
            cuda_version = torch.version.cuda
    except Exception as e:
        logger.warning(f"Failed to query GPU info: {e}")

    try:
        pynvml.nvmlInit()
        nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(torch.cuda.current_device() if torch.cuda.is_available() else 0)
        try:
            raw = pynvml.nvmlSystemGetDriverVersion()
            driver_version = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        except Exception:
            pass
    except Exception as e:
        logger.warning(f"Failed to initialize NVML: {e}")

    info = SystemInfo(
        cpu_name=cpu_name,
        gpu_name=gpu_name,
        vram_total_bytes=vram_total_bytes,
        cuda_version=cuda_version,
        driver_version=driver_version,
        torch_version=torch.__version__,
        gpu_count=gpu_count,
    )
    return info, nvml_handle


def _log_system_info(info: SystemInfo) -> None:
    """Log the static system info. Called once at startup so server.log has
    hardware context above any later errors (Overworldai/Biome#98)."""
    gpu_name = info.gpu_name or "[unknown]"
    gpu_count = info.gpu_count
    gpu_summary = f"{gpu_name} (x{gpu_count})" if gpu_count > 1 else gpu_name
    vram_str = f", {info.vram_total_bytes // (1024 * 1024)} MB VRAM" if info.vram_total_bytes else ""
    logger.info("System info:")
    logger.info(f"  CPU:    {info.cpu_name or '[unknown]'}")
    logger.info(f"  GPU:    {gpu_summary}{vram_str}")
    logger.info(f"  CUDA:   {info.cuda_version or '[unavailable]'}")
    logger.info(f"  Driver: {info.driver_version or '[unknown]'}")
    logger.info(f"  Torch:  {info.torch_version}")


class SystemMonitor:
    """Static hardware identity + live samplers + error-state snapshots.

    One instance per process; pass it down to consumers explicitly. The
    static `info` is collected once at construction and never changes.
    Sampler methods (`vram_used_bytes`, `gpu_util_percent`,
    `capture_error_snapshot`) re-query each call."""

    info: SystemInfo

    def __init__(self, info: SystemInfo, nvml_handle: object) -> None:
        self.info = info
        self._nvml_handle = nvml_handle

    @classmethod
    def collect(cls) -> "SystemMonitor":
        """Query the host once and log the result. Call exactly once at
        process startup; the returned instance is the canonical handle for
        the rest of the process."""
        info, nvml_handle = _collect_system_info_and_nvml()
        _log_system_info(info)
        return cls(info=info, nvml_handle=nvml_handle)

    # ─── Live samplers ────────────────────────────────────────────────

    def gpu_util_percent(self) -> int:
        """Current GPU utilization (0-100), or -1 if unavailable. Prefers
        `torch.cuda.utilization()` (fast path); falls back to NVML which
        talks to the same driver as nvidia-smi."""
        try:
            util = torch.cuda.utilization()
            if util >= 0:
                return int(util)
        except Exception:
            pass
        if self._nvml_handle is not None:
            try:
                return int(pynvml.nvmlDeviceGetUtilizationRates(self._nvml_handle).gpu)
            except Exception:
                pass
        return -1

    def vram_used_bytes(self) -> int:
        """VRAM allocated by torch on device 0, in bytes. -1 if unavailable."""
        try:
            if torch.cuda.is_available():
                return torch.cuda.memory_allocated()
        except Exception:
            pass
        return -1

    def vram_reserved_bytes(self) -> int:
        """VRAM held by torch's allocator (allocated + cached), in bytes.
        -1 if unavailable."""
        try:
            if torch.cuda.is_available():
                return torch.cuda.memory_reserved()
        except Exception:
            pass
        return -1

    # ─── Error snapshot ──────────────────────────────────────────────

    def capture_error_snapshot(self) -> ErrorSnapshot:
        """Best-effort snapshot of ephemeral state at the moment of an error.

        Attached to outgoing error push messages so bug reports include what
        the server was actually doing at failure time, not the idle state
        recorded when the user later clicks "Copy Report"."""
        process_rss_bytes: int | None = None
        ram_used_bytes: int | None = None
        ram_total_bytes: int | None = None

        try:
            process = psutil.Process()
            process_rss_bytes = process.memory_info().rss
            vm = psutil.virtual_memory()
            ram_used_bytes = vm.total - vm.available
            ram_total_bytes = vm.total
        except Exception:
            pass

        vram_used = self.vram_used_bytes()
        vram_reserved = self.vram_reserved_bytes()
        util = self.gpu_util_percent()

        return ErrorSnapshot(
            process_rss_bytes=process_rss_bytes,
            ram_used_bytes=ram_used_bytes,
            ram_total_bytes=ram_total_bytes,
            vram_used_bytes=vram_used if vram_used >= 0 else None,
            vram_reserved_bytes=vram_reserved if vram_reserved >= 0 else None,
            gpu_util_percent=util if util >= 0 else None,
        )
