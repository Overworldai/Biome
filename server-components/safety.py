"""
Safety module - NSFW image detection for seed validation.

Uses Freepik/nsfw_image_detector model to check images for inappropriate content.
"""

import logging
import threading
from typing import List, Dict

import torch
import torch.nn.functional as F
from PIL import Image
from transformers import AutoModelForImageClassification
from timm.data.transforms_factory import create_transform
from torchvision.transforms import Compose
from timm.data import resolve_data_config
from timm.models import get_pretrained_cfg

logger = logging.getLogger(__name__)


class SafetyChecker:
    """NSFW content detector for seed images."""

    def __init__(self):
        self.model = None
        self.processor = None
        self.current_device = None  # Track which device model is currently loaded on
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

            # Clear CUDA cache only if was on GPU
            # Avoids clearing world engine's CUDA cache when safety checker ran on CPU
            if was_on_cuda and torch.cuda.is_available():
                torch.cuda.empty_cache()

            # Note: Removed gc.collect() as forced garbage collection can interfere
            # with world engine's memory allocation, causing 8+ second delays in append_frame()

            logger.info("NSFW detection model unloaded")

    def check_image(self, image_path: str) -> Dict[str, any]:
        """
        Check single image for NSFW content.
        Uses CPU to avoid GPU memory conflicts with world model.

        Args:
            image_path: Path to image file

        Returns:
            {
                'is_safe': bool,
                'scores': {
                    'neutral': float,
                    'low': float,
                    'medium': float,
                    'high': float
                }
            }
        """
        with self._lock:
            self._load_model(device="cpu")

            try:
                img = Image.open(image_path)
                # Convert to RGB to handle RGBA/RGB mode differences
                if img.mode != "RGB":
                    img = img.convert("RGB")
                scores = self.predict_batch_values([img], device="cpu")[0]
                is_safe = scores["low"] < 0.5  # Strict threshold
                result = {"is_safe": is_safe, "scores": scores}
            except Exception as e:
                logger.error(f"Failed to check image {image_path}: {e}")
                # Default to unsafe on error (conservative approach)
                result = {
                    "is_safe": False,
                    "scores": {"neutral": 0.0, "low": 1.0, "medium": 0.0, "high": 0.0},
                }
            finally:
                # Unload model after check to free memory
                self.unload_model()

            return result

    def check_batch(
        self, image_paths: List[str], batch_size: int = 8
    ) -> List[Dict[str, any]]:
        """
        Check multiple images efficiently with proper batching.
        Uses GPU for efficient parallel processing.

        Args:
            image_paths: List of paths to image files
            batch_size: Number of images to process at once (default 8 to avoid GPU OOM)

        Returns:
            List of results matching check_image() format
        """
        if not image_paths:
            return []

        device = "cuda" if torch.cuda.is_available() else "cpu"

        with self._lock:
            self._load_model(device=device)

            try:
                # First pass: load all images and track which ones failed
                images = []
                for path in image_paths:
                    try:
                        img = Image.open(path)
                        # Convert to RGB to handle RGBA/RGB mode differences
                        if img.mode != "RGB":
                            img = img.convert("RGB")
                        images.append(img)
                    except Exception as e:
                        logger.error(f"Failed to load image {path}: {e}")
                        images.append(None)

                # Process valid images in batches
                valid_images = [img for img in images if img is not None]
                all_scores = []

                for i in range(0, len(valid_images), batch_size):
                    batch = valid_images[i : i + batch_size]
                    batch_scores = self.predict_batch_values(batch, device=device)
                    all_scores.extend(batch_scores)

                # Build results, matching order of input paths
                results = []
                score_idx = 0
                for img in images:
                    if img is None:
                        # Failed to load - mark as unsafe
                        results.append(
                            {
                                "is_safe": False,
                                "scores": {
                                    "neutral": 0.0,
                                    "low": 1.0,
                                    "medium": 0.0,
                                    "high": 0.0,
                                },
                            }
                        )
                    else:
                        scores = all_scores[score_idx]
                        results.append({"is_safe": scores["low"] < 0.5, "scores": scores})
                        score_idx += 1

                return results
            except Exception as e:
                logger.error(f"Failed to check batch: {e}")
                # Return all unsafe on batch failure
                return [
                    {
                        "is_safe": False,
                        "scores": {"neutral": 0.0, "low": 1.0, "medium": 0.0, "high": 0.0},
                    }
                    for _ in image_paths
                ]
            finally:
                # Unload model after batch check to free memory
                self.unload_model()

    def predict_batch_values(
        self, img_batch: List[Image.Image], device: str = "cpu"
    ) -> List[Dict[str, float]]:
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
        inputs = torch.stack([self.processor(img) for img in img_batch]).to(device)
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
        img_batch: List[Image.Image],
        class_to_predict: str,
        threshold: float = 0.5,
        device: str = "cpu",
    ) -> List[bool]:
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
