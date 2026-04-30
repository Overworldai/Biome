"""
Image safety: the NSFW classifier (`Freepik/nsfw_image_detector`) plus the
disk-backed result cache that backs it.

`SafetyChecker` owns its own cache: hand it a raw image (`check_image_bytes`)
and it consults the on-disk cache, runs the classifier on a miss, and
persists the new entry. Callers never touch the cache directly — the only
way an entry lands in it is by classifying a real image. `check_pil_image`
is the lower-level path used for already-decoded images that don't have a
stable hash (e.g. freshly-generated scenes); those don't get cached.

Cache entries are SHA-256-keyed `SafetyCacheEntry` records persisted as JSON;
loading on a missing / corrupt file leaves an empty cache so the next session
re-runs the checks (cache rebuilds, no permanent state loss).
"""

import hashlib
import io
import logging
import threading
import time
from dataclasses import dataclass
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


_DEFAULT_CACHE_FILE = Path(__file__).parent.parent / "world_engine" / ".safety_cache.json"


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SafetyVerdict:
    """Result of one classification — `is_safe` plus the per-category scores
    the model produced. No hash; this is what `check_pil_image` returns for
    images we don't cache (e.g. freshly generated scenes)."""

    is_safe: bool
    scores: dict[str, float]


@dataclass(frozen=True)
class SafetyResult:
    """`SafetyVerdict` + the SHA-256 hash of the input bytes. Returned by
    `check_image_bytes`; the hash is what the cache is keyed on and what the
    client uses to dedupe seed uploads."""

    is_safe: bool
    scores: dict[str, float]
    image_hash: str


class SafetyCacheEntry(BaseModel):
    """One entry in the on-disk safety cache. Frozen Pydantic model — written
    only by `SafetyChecker._record`, never directly by external code. The on-
    disk format is human-readable JSON; `extra="forbid"` rejects unknown fields
    so adding new optional fields stays backwards-compat."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    is_safe: bool
    scores: dict[str, float]
    checked_at: float


_cache_adapter: TypeAdapter[dict[str, SafetyCacheEntry]] = TypeAdapter(dict[str, SafetyCacheEntry])


# Default treat-as-unsafe verdict returned when the underlying classification
# raises (we never let an exception bubble up as "safe").
_FAILURE_VERDICT = SafetyVerdict(
    is_safe=False,
    scores={"neutral": 0.0, "low": 1.0, "medium": 0.0, "high": 0.0},
)


# ---------------------------------------------------------------------------
# NSFW classifier + disk-backed cache
# ---------------------------------------------------------------------------


class SafetyChecker:
    """NSFW content detector for seed images.

    The model is loaded once at startup via `load(device)` and stays resident
    for the process lifetime. Owns the disk-backed cache: callers can't write
    to it — entries land in the cache only as a side effect of
    `check_image_bytes` classifying a real payload. `check_pil_image` is the
    non-caching path used for images without a stable input hash (e.g. freshly
    generated scenes)."""

    def __init__(self, device: str = "cuda", cache_path: Path | None = None) -> None:
        self._lock = threading.Lock()  # serialises model access
        self._cache_lock = threading.Lock()  # serialises cache writes
        self._cache_path = cache_path or _DEFAULT_CACHE_FILE
        self._cache: dict[str, SafetyCacheEntry] = self._load_cache_from_disk()
        self._device = device
        logger.info(f"Loading NSFW detection model on {device} ({len(self._cache)} cache entries)...")

        # Use float32 for CPU (better compatibility), bfloat16 for GPU
        # (better performance).
        dtype = torch.float32 if device == "cpu" else torch.bfloat16
        self.model = AutoModelForImageClassification.from_pretrained(
            "Freepik/nsfw_image_detector", torch_dtype=dtype
        ).to(device)

        cfg = get_pretrained_cfg("eva02_base_patch14_448.mim_in22k_ft_in22k_in1k")
        self.processor = create_transform(**resolve_data_config(cfg.__dict__))

        logger.info(f"NSFW detection model loaded on {device}")

    # ─── Cache lifecycle ──────────────────────────────────────────────

    def _load_cache_from_disk(self) -> dict[str, SafetyCacheEntry]:
        """Read the on-disk cache. Failures are logged but non-fatal
        (cache rebuilds on next session)."""
        if not self._cache_path.exists():
            return {}
        try:
            return _cache_adapter.validate_json(self._cache_path.read_bytes())
        except Exception as e:
            logger.error(f"Failed to load safety cache: {e}")
            return {}

    @property
    def cache_size(self) -> int:
        return len(self._cache)

    def _persist_cache(self) -> None:
        """Persist the cache to disk. Caller holds `_cache_lock`."""
        try:
            self._cache_path.parent.mkdir(parents=True, exist_ok=True)
            self._cache_path.write_bytes(_cache_adapter.dump_json(self._cache, indent=2))
        except Exception as e:
            logger.error(f"Failed to save safety cache: {e}")

    def _record(self, image_hash: str, verdict: SafetyVerdict) -> None:
        """Record a fresh classification + persist. Internal — only called
        from `check_image_bytes` after a real classification."""
        entry = SafetyCacheEntry(
            is_safe=verdict.is_safe,
            scores=verdict.scores,
            checked_at=time.time(),
        )
        with self._cache_lock:
            self._cache[image_hash] = entry
            self._persist_cache()

    # ─── Classification ───────────────────────────────────────────────

    def check_image_bytes(self, image_bytes: bytes) -> SafetyResult:
        """Classify a raw image payload, consulting the disk-backed cache and
        persisting any new result automatically. The only public path that
        writes to the cache."""
        image_hash = hashlib.sha256(image_bytes).hexdigest()

        cached = self._cache.get(image_hash)
        if cached is not None:
            return SafetyResult(
                is_safe=cached.is_safe,
                scores=cached.scores,
                image_hash=image_hash,
            )

        pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        verdict = self.check_pil_image(pil)
        self._record(image_hash, verdict)
        return SafetyResult(
            is_safe=verdict.is_safe,
            scores=verdict.scores,
            image_hash=image_hash,
        )

    def check_pil_image(self, image: Image.Image) -> SafetyVerdict:
        """Classify an already-decoded image. Used directly for images that
        don't have a meaningful input hash (e.g. freshly-generated scenes);
        results are NOT cached. On internal failure returns a treat-as-unsafe
        verdict — failure never reads as "safe"."""
        with self._lock:
            try:
                img = image if image.mode == "RGB" else image.convert("RGB")
                scores = self._predict_batch_values([img])[0]
                return SafetyVerdict(is_safe=scores["low"] < 0.5, scores=scores)
            except Exception as e:
                logger.error(f"Failed to check PIL image: {e}")
                return _FAILURE_VERDICT

    def _predict_batch_values(self, img_batch: list[Image.Image]) -> list[dict[str, float]]:
        """Run the classifier on a batch and return cumulative-probability score
        dicts. `idx_to_label`-mapped, with high→medium→low cumulated and
        `neutral` carrying its own (non-cumulative) probability."""
        idx_to_label = {0: "neutral", 1: "low", 2: "medium", 3: "high"}

        # Prepare batch
        inputs = torch.stack([self.processor(img) for img in img_batch]).to(self._device)  # pyright: ignore[reportCallIssue]  # timm Compose typed as a tuple in its stubs but is callable at runtime
        output: list[dict[str, float]] = []

        with torch.inference_mode():
            logits = self.model(inputs).logits
            batch_probs = F.log_softmax(logits, dim=-1)
            batch_probs = torch.exp(batch_probs).cpu()

            for i in range(len(batch_probs)):
                element_probs = batch_probs[i]
                output_img: dict[str, float] = {}
                danger_cum_sum = 0

                # Cumulative sum from high to low (reverse order)
                for j in range(len(element_probs) - 1, -1, -1):
                    danger_cum_sum += element_probs[j]
                    if j == 0:
                        danger_cum_sum = element_probs[j]  # Neutral is not cumulative
                    output_img[idx_to_label[j]] = danger_cum_sum.item()

                output.append(output_img)

        return output
