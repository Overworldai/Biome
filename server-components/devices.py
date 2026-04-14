"""
Centralised platform detection and device-placement rules.

Every decision about which compute platform we're on, which device a
model or tensor lands on, and which quantization options are available
should be expressed here so the mapping is visible at a glance.
"""

import platform as _platform_mod
import sys
from typing import Literal

import torch

Platform = Literal["mlx", "cuda", "cpu"]
Quant = Literal["none", "fp8w8a8", "intw8a8"]


def _detect_platform() -> Platform:
    """Detect the compute platform: 'mlx' (Apple Silicon), 'cuda', or 'cpu'."""
    if sys.platform == "darwin" and _platform_mod.machine() == "arm64":
        try:
            import mlx.core  # noqa: F401
            return "mlx"
        except ImportError:
            pass
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


PLATFORM: Platform = _detect_platform()
"""Detected compute platform, resolved once at import time."""

IS_MLX: bool = PLATFORM == "mlx"
"""Convenience flag for guarding MLX-specific code paths."""

DEVICE: str = "cuda" if PLATFORM == "cuda" else "cpu"
"""Primary torch device string for the world-engine model.

MLX placement is handled internally by MLXWorldEngine, so this
remains ``"cpu"`` on Apple Silicon.
"""


def seed_device() -> Platform:
    """Device for seed-image tensors.

    MLX: CPU (the VAE handles device placement internally).
    CUDA: same as the model device.
    """
    if PLATFORM == "mlx":
        return "cpu"
    return DEVICE


def safety_device() -> Platform:
    """Device for the safety-checker model.

    MLX: CPU (the safety checker is PyTorch-only, no Metal support).
    CUDA: runs on GPU alongside the main model.
    """
    if PLATFORM == "mlx":
        return "cpu"
    return DEVICE


def available_quants() -> list[Quant]:
    """Quantization options the server can offer for the current platform."""
    if PLATFORM == "mlx":
        return ["intw8a8"]
    elif PLATFORM == "cuda":
        return ["none", "fp8w8a8", "intw8a8"]
    else:
        return ["none"]
