"""
Device backend — single home for the accelerator-specific bits.

Every reference to torch's device-namespaced API and to `pynvml` lives here.
The rest of the codebase passes the per-purpose device strings
(`WORLD_ENGINE_DEVICE`, `SCENE_AUTHORING_DEVICE`, `SAFETY_DEVICE`) to
`.to(...)` calls and uses the wrappers below for memory queries, lifecycle
ops, and NVML-backed monitoring.

Today the backend is NVIDIA's CUDA stack; ROCm / MPS / etc. will route
through this module when added — not through `torch.cuda.*` directly.
Outside this file, the substring `cuda` should not appear: callers refer
to "the device" / "the device thread" instead.
"""

import logging
import os

# Set the allocator config BEFORE torch is touched downstream — torch reads
# this env var when the device context first initialises. Module-level
# side effect by design: importing this module is the act of choosing
# the backend, and that has to happen before any device op.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import pynvml
import torch

logger = logging.getLogger(__name__)

# Device assignment per purpose. They all happen to be the same GPU today,
# but split here so we can move pieces around — e.g. safety on CPU while
# the world engine stays on GPU, or scene authoring on a second GPU —
# without rewriting every call site.
WORLD_ENGINE_DEVICE = "cuda"
SCENE_AUTHORING_DEVICE = "cuda"
SAFETY_DEVICE = "cuda"

# Torch's OOM exception, re-exported under a backend-neutral name.
OutOfMemoryError = torch.cuda.OutOfMemoryError

# Opaque NVML device handle — pynvml lacks proper stubs.
NvmlHandle = object


# ─── Availability / identity ─────────────────────────────────────────


def is_available() -> bool:
    return torch.cuda.is_available()


def device_count() -> int:
    return torch.cuda.device_count() if is_available() else 0


def current_device_index() -> int:
    return torch.cuda.current_device() if is_available() else 0


def device_name(index: int = 0) -> str | None:
    return torch.cuda.get_device_name(index) if is_available() else None


def total_memory(index: int = 0) -> int | None:
    return torch.cuda.get_device_properties(index).total_memory if is_available() else None


def runtime_version() -> str | None:
    """Backend runtime version string (e.g. CUDA toolkit version)."""
    return torch.version.cuda


# ─── Live samplers ────────────────────────────────────────────────────


def memory_allocated() -> int:
    """Bytes currently allocated by torch on device 0; -1 if unavailable."""
    if is_available():
        try:
            return torch.cuda.memory_allocated()
        except Exception:  # noqa: BLE001  -- best-effort sampler; torch surfaces a wide grab-bag of RuntimeError subclasses here
            pass
    return -1


def memory_reserved() -> int:
    """Bytes held by torch's allocator (allocated + cached); -1 if unavailable."""
    if is_available():
        try:
            return torch.cuda.memory_reserved()
        except Exception:  # noqa: BLE001  -- best-effort sampler; torch surfaces a wide grab-bag of RuntimeError subclasses here
            pass
    return -1


def utilization_via_torch() -> int:
    """Device utilisation (0-100) via torch's fast path; -1 if unavailable."""
    try:
        u = torch.cuda.utilization()
        return int(u) if u >= 0 else -1
    except Exception:  # noqa: BLE001  -- best-effort sampler; torch surfaces a wide grab-bag of RuntimeError subclasses here
        return -1


# ─── Lifecycle / cleanup ─────────────────────────────────────────────


def synchronize() -> None:
    if is_available():
        torch.cuda.synchronize()


def empty_cache() -> None:
    if is_available():
        torch.cuda.empty_cache()


def ipc_collect() -> None:
    if is_available():
        torch.cuda.ipc_collect()


def reset_compiled_graphs() -> None:
    """Clear torch's compiled-function/graph caches. Used during model
    unload + post-error recovery to drop possibly-corrupted CUDA graphs."""
    torch._dynamo.reset()


# ─── Error classification ────────────────────────────────────────────


# Heuristic — matches torch error messages we know are recoverable by
# clearing caches + resetting the engine.
_RECOVERABLE_ERROR_KEYWORDS = ("cuda", "cublas", "graph capture", "offset increment")


def is_recoverable_device_error(err: BaseException) -> bool:
    """True if the error text suggests a transient device-side fault that
    `recover_from_device_error` can clean up. Used by the gen-thread loop
    to decide between recovery and terminal-abort paths."""
    msg = str(err).lower()
    return any(keyword in msg for keyword in _RECOVERABLE_ERROR_KEYWORDS)


# Heuristic — torch raises a generic RuntimeError when the chosen
# quantization mode isn't supported by the GPU's compute capability;
# its message carries one of these substrings.
_QUANT_UNSUPPORTED_KEYWORDS = ("compute capability", "scaled_mm")


def is_quant_unsupported_error(err: BaseException) -> bool:
    """True if the error text indicates the active quantization mode is
    unsupported on the current device. Engine warmup translates this
    into a typed `QuantUnsupportedError`."""
    msg = str(err)
    return any(keyword in msg for keyword in _QUANT_UNSUPPORTED_KEYWORDS)


# ─── NVML (NVIDIA Management Library) ────────────────────────────────


def open_nvml_handle() -> NvmlHandle | None:
    """Initialise NVML and return a handle for the current device, or
    `None` if NVML init fails. Logs the failure but doesn't raise."""
    try:
        pynvml.nvmlInit()
        return pynvml.nvmlDeviceGetHandleByIndex(current_device_index())
    except Exception as e:  # noqa: BLE001  -- pynvml lacks typed stubs; raises NVMLError subclasses, not a single base we can name
        logger.warning(f"Failed to initialize NVML: {e}")
        return None


def driver_version_via_nvml() -> str | None:
    """GPU driver version (e.g. '550.78.01' on NVIDIA). `None` if NVML
    is unavailable or the call fails."""
    try:
        raw = pynvml.nvmlSystemGetDriverVersion()
        return raw.decode("utf-8") if isinstance(raw, bytes) else raw
    except Exception:  # noqa: BLE001  -- pynvml lacks typed stubs; raises NVMLError subclasses, not a single base we can name
        return None


def utilization_via_nvml(handle: NvmlHandle) -> int:
    """Device utilisation (0-100) from NVML; -1 on failure. NVML talks
    to the same driver as nvidia-smi, sometimes with fresher numbers
    than torch."""
    try:
        return int(pynvml.nvmlDeviceGetUtilizationRates(handle).gpu)
    except Exception:  # noqa: BLE001  -- pynvml lacks typed stubs; raises NVMLError subclasses, not a single base we can name
        return -1
