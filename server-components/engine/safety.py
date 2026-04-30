"""
Image safety: the NSFW classifier (`Freepik/nsfw_image_detector`) plus the
disk-backed result cache that backs it.

Cache entries are SHA-256-keyed `SafetyCacheEntry` records persisted as JSON;
loading on a missing / corrupt file returns an empty dict so the next session
re-runs the checks (cache rebuilds, no permanent state loss). The classifier
itself is loaded lazily on first use, optionally pinned in GPU memory via
`load_resident()`.
"""

import logging
import threading
from pathlib import Path

import torch
import torch.nn.functional as F
from PIL import Image
from pydantic import BaseModel, ConfigDict, TypeAdapter
from timm.data import resolve_data_config
from timm.data.transforms_factory import create_transform
from timm.models import get_pretrained_cfg
from transformers import AutoModelForImageClassification

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Disk-backed safety cache
# ---------------------------------------------------------------------------


class SafetyCacheEntry(BaseModel):
    """One entry in the on-disk safety cache. Frozen Pydantic model —
    persisted as JSON so the cache file is human-readable and version-tolerant.
    `extra="forbid"` rejects unknown fields; adding new optional fields stays
    backwards-compat."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    is_safe: bool
    scores: dict[str, float]
    checked_at: float


SAFETY_CACHE_FILE = Path(__file__).parent.parent / "world_engine" / ".safety_cache.json"

_cache_adapter: TypeAdapter[dict[str, SafetyCacheEntry]] = TypeAdapter(dict[str, SafetyCacheEntry])


def load_safety_cache() -> dict[str, SafetyCacheEntry]:
    """Load hash-keyed safety cache from JSON. Returns an empty dict if
    the file is missing or fails to parse — failures are logged but
    non-fatal; cache rebuilds on next session."""
    if not SAFETY_CACHE_FILE.exists():
        return {}
    try:
        cache = _cache_adapter.validate_json(SAFETY_CACHE_FILE.read_bytes())
        logger.info(f"Loaded safety cache with {len(cache)} entries")
        return cache
    except Exception as e:
        logger.error(f"Failed to load safety cache: {e}")
        return {}


def save_safety_cache(cache: dict[str, SafetyCacheEntry]) -> None:
    """Persist the safety cache to disk; failures are logged but
    non-fatal (the cache rebuilds on next session)."""
    try:
        SAFETY_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        SAFETY_CACHE_FILE.write_bytes(_cache_adapter.dump_json(cache, indent=2))
    except Exception as e:
        logger.error(f"Failed to save safety cache: {e}")


# ---------------------------------------------------------------------------
# NSFW classifier
# ---------------------------------------------------------------------------


class SafetyChecker:
    """NSFW content detector for seed images."""

    def __init__(self):
        self.model = None
        self.processor = None
        self.current_device = None  # Track which device model is currently loaded on
        self._resident = False  # When True, model stays loaded between checks
        self._lock = threading.Lock()  # Prevent concurrent model access
        logger.info("SafetyChecker initialized")

    def _load_model(self, device: str = "cpu"):
        """Lazy load model on specified device."""
        # Reload if model not loaded or device changed
        if self.model is None or self.current_device != device:
            if self.model is not None:
                logger.info(f"Switching model from {self.current_device} to {device}")
                self.unload_model()

            logger.info(f"Loading NSFW detection model on {device}...")

            # Use float32 for CPU (better compatibility), bfloat16 for GPU (better performance)
            dtype = torch.float32 if device == "cpu" else torch.bfloat16
            self.model = AutoModelForImageClassification.from_pretrained(
                "Freepik/nsfw_image_detector", torch_dtype=dtype
            ).to(device)

            cfg = get_pretrained_cfg("eva02_base_patch14_448.mim_in22k_ft_in22k_in1k")
            self.processor = create_transform(**resolve_data_config(cfg.__dict__))

            self.current_device = device
            logger.info(f"NSFW detection model loaded on {device}")

    def unload_model(self):
        """Unload model from memory to free resources."""
        if self.model is not None:
            logger.info("Unloading NSFW detection model...")

            # Move to CPU before deletion if on GPU
            if self.current_device == "cuda":
                self.model.cpu()

            # Save device before clearing for cache cleanup decision
            was_on_cuda = self.current_device == "cuda"

            # Delete model and processor
            del self.model
            del self.processor
            self.model = None
            self.processor = None
            self.current_device = None
            self._resident = False

            # Clear CUDA cache only if was on GPU
            # Avoids clearing world engine's CUDA cache when safety checker ran on CPU
            if was_on_cuda and torch.cuda.is_available():
                torch.cuda.empty_cache()

            # Note: Removed gc.collect() as forced garbage collection can interfere
            # with world engine's memory allocation, causing 8+ second delays in append_frame()

            logger.info("NSFW detection model unloaded")

    def load_resident(self, device: str = "cuda"):
        """Load model and keep it resident in memory (no unload after checks).

        Call this during session setup so the model is ready for repeated
        checks without load/unload overhead.
        """
        with self._lock:
            self._load_model(device=device)
            self._resident = True
            logger.info(f"Safety checker model loaded as resident on {device}")

    @property
    def is_resident(self) -> bool:
        return self._resident

    def _should_unload(self) -> bool:
        """Return True if the model should be unloaded after a check."""
        return not self._resident

    def check_pil_image(self, image: Image.Image) -> dict[str, object]:
        """
        Check a PIL image for NSFW content.
        Uses the resident device if loaded, otherwise CPU.

        Args:
            image: PIL Image to check

        Returns:
            {'is_safe': bool, 'scores': {'neutral': float, 'low': float, 'medium': float, 'high': float}}
        """
        with self._lock:
            device = self.current_device if self._resident else "cpu"
            self._load_model(device=device)

            try:
                img = image
                if img.mode != "RGB":
                    img = img.convert("RGB")
                scores = self.predict_batch_values([img], device=device)[0]
                is_safe = scores["low"] < 0.5
                return {"is_safe": is_safe, "scores": scores}
            except Exception as e:
                logger.error(f"Failed to check PIL image: {e}")
                return {
                    "is_safe": False,
                    "scores": {"neutral": 0.0, "low": 1.0, "medium": 0.0, "high": 0.0},
                }
            finally:
                if self._should_unload():
                    self.unload_model()

    def predict_batch_values(self, img_batch: list[Image.Image], device: str = "cpu") -> list[dict[str, float]]:
        """
        Process a batch of images and return prediction scores for each NSFW category.

        Args:
            img_batch: List of PIL images
            device: Device to run inference on ("cpu" or "cuda")

        Returns:
            List of score dictionaries with cumulative probabilities:
            [
                {
                    'neutral': float,  # Probability of being neutral (only this category)
                    'low': float,      # Probability of being low or higher (cumulative)
                    'medium': float,   # Probability of being medium or higher (cumulative)
                    'high': float      # Probability of being high (cumulative)
                }
            ]
        """
        idx_to_label = {0: "neutral", 1: "low", 2: "medium", 3: "high"}

        # Prepare batch
        inputs = torch.stack([self.processor(img) for img in img_batch]).to(device)  # pyright: ignore[reportCallIssue]  # timm Compose typed as a tuple in its stubs but is callable at runtime
        output = []

        with torch.inference_mode():
            logits = self.model(inputs).logits
            batch_probs = F.log_softmax(logits, dim=-1)
            batch_probs = torch.exp(batch_probs).cpu()

            for i in range(len(batch_probs)):
                element_probs = batch_probs[i]
                output_img = {}
                danger_cum_sum = 0

                # Cumulative sum from high to low (reverse order)
                for j in range(len(element_probs) - 1, -1, -1):
                    danger_cum_sum += element_probs[j]
                    if j == 0:
                        danger_cum_sum = element_probs[j]  # Neutral is not cumulative
                    output_img[idx_to_label[j]] = danger_cum_sum.item()

                output.append(output_img)

        return output

    def prediction(
        self,
        img_batch: list[Image.Image],
        class_to_predict: str,
        threshold: float = 0.5,
        device: str = "cpu",
    ) -> list[bool]:
        """
        Predict if images meet or exceed a specific NSFW threshold.

        Args:
            img_batch: List of PIL images
            class_to_predict: One of "low", "medium", "high"
            threshold: Probability threshold (0.0 to 1.0)
            device: Device to run inference on ("cpu" or "cuda")

        Returns:
            List of booleans indicating if each image meets the threshold
        """
        if class_to_predict not in ["low", "medium", "high"]:
            raise ValueError("class_to_predict must be one of: low, medium, high")

        if not 0 <= threshold <= 1:
            raise ValueError("threshold must be between 0 and 1")

        output = self.predict_batch_values(img_batch, device=device)
        return [output[i][class_to_predict] >= threshold for i in range(len(output))]
