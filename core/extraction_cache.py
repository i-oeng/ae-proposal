from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import TypeVar
from uuid import uuid4

from pydantic import BaseModel

logger = logging.getLogger(__name__)
ModelT = TypeVar("ModelT", bound=BaseModel)


def _cache_root() -> Path:
    return Path(os.getenv("EXTRACTION_CACHE_DIR", "cache/extractions"))


def cache_key_for_files(namespace: str, file_paths: list[str], discriminator: str) -> str:
    file_digests: list[str] = []
    for file_path in file_paths:
        digest = hashlib.sha256(Path(file_path).read_bytes()).hexdigest()
        file_digests.append(digest)
    payload = "|".join([namespace, discriminator, *sorted(file_digests)])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def cache_key_for_text(namespace: str, text: str, discriminator: str) -> str:
    payload = f"{namespace}|{discriminator}|{text}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_cached_model(key: str, model_type: type[ModelT]) -> ModelT | None:
    cache_path = _cache_root() / f"{key}.json"
    if not cache_path.exists():
        return None
    try:
        return model_type.model_validate_json(cache_path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Ignoring invalid extraction cache %s: %s", cache_path, exc)
        return None


def store_cached_model(key: str, value: BaseModel) -> None:
    cache_root = _cache_root()
    cache_root.mkdir(parents=True, exist_ok=True)
    cache_path = cache_root / f"{key}.json"
    temporary_path = cache_root / f".{key}-{uuid4().hex}.tmp"
    try:
        temporary_path.write_text(value.model_dump_json(), encoding="utf-8")
        temporary_path.replace(cache_path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not write extraction cache %s: %s", cache_path, exc)
        temporary_path.unlink(missing_ok=True)
