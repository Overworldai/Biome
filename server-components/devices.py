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
    """Detect the compute platform: 'mlx' (Apple Silicon, now via
    ``quark.Engine`` — label retained so existing branches keep
    triggering), 'cuda', or 'cpu'.

    The ``"mlx"`` literal is a misnomer post-``quark[engine]``: there's
    no MLX runtime involved, the DiT runs on the native Metal-cpp
    driver in ``quark`` and the VAE on the ANE via ``quark.taehv``.
    Renaming to ``"metal"`` is a follow-up touching every branch on
    this constant — left as separate cleanup.
    """
    if sys.platform == "darwin" and _platform_mod.machine() == "arm64":
        return "mlx"
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
        # ``quark.Engine`` on Apple Silicon is bf16 end-to-end. Metal
        # has no native fp8 (no e4m3 in MSL) and no int8 KV path in
        # quark today. The ``"none"`` quant maps to the engine's
        # ``QuantConfig.all_bf16()`` profile.
        return ["none"]
    elif PLATFORM == "cuda":
        return ["none", "fp8w8a8", "intw8a8"]
    else:
        return ["none"]
