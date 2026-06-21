from __future__ import annotations

from functools import lru_cache
import os

from core.utils import load_local_env


@lru_cache(maxsize=4)
def _client_for_key(api_key: str):
    from anthropic import Anthropic

    try:
        max_retries = max(0, int(os.getenv("ANTHROPIC_SDK_MAX_RETRIES", "1")))
    except ValueError:
        max_retries = 1
    return Anthropic(api_key=api_key, max_retries=max_retries)


def get_anthropic_client():
    """Return a shared client so concurrent extractions reuse HTTP connections."""
    load_local_env()
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return _client_for_key(api_key)
