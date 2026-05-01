"""
HuggingFace token resolution.

Biome overrides `HF_HOME` to keep the model cache inside `world_engine/`,
which means `huggingface_hub` won't find the user's default token at
`~/.cache/huggingface/token`. `apply_resolved_token()` re-implements the
Electron-side `getHfToken()` resolution order so both paths find the
same token regardless of `HF_HOME` overrides.

Call `apply_resolved_token()` once at startup, before any module that
reads `HF_TOKEN` is imported.
"""

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def resolve_hf_token() -> str | None:
    """Resolve a HuggingFace token from env vars and well-known file
    locations, in the same order the Electron-side `getHfToken()` uses.
    Returns None if no token is found."""
    # 1. HF_TOKEN env var
    token = os.environ.get("HF_TOKEN")
    if token:
        return token
    # 2. Deprecated HUGGING_FACE_HUB_TOKEN env var
    token = os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if token:
        return token
    # 3. File at HF_TOKEN_PATH env var
    token_path_env = os.environ.get("HF_TOKEN_PATH")
    if token_path_env:
        p = Path(token_path_env)
        if p.is_file():
            t = p.read_text().strip()
            if t:
                return t
    # 4. File at real user HF_HOME/token (use XDG_CACHE_HOME or ~/.cache,
    #    NOT the overridden HF_HOME which points into world_engine/)
    xdg = os.environ.get("XDG_CACHE_HOME")
    if xdg:
        p = Path(xdg) / "huggingface" / "token"
        if p.is_file():
            t = p.read_text().strip()
            if t:
                return t
    # 5. Default fallback: ~/.cache/huggingface/token
    p = Path.home() / ".cache" / "huggingface" / "token"
    if p.is_file():
        t = p.read_text().strip()
        if t:
            return t
    return None


def apply_resolved_token() -> None:
    """Resolve and stamp `HF_TOKEN` into the process environment so
    `huggingface_hub` finds it after our HF_HOME override. Logs the
    outcome at info / warning so server.log captures whether a token
    was discovered."""
    token = resolve_hf_token()
    if token:
        os.environ["HF_TOKEN"] = token
        logger.info("HF token resolved and set")
    else:
        logger.warning("No HuggingFace token found (set HF_TOKEN or run `huggingface-cli login`)")
