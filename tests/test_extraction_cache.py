from __future__ import annotations

from core.extraction_cache import (
    cache_key_for_files,
    cache_key_for_text,
    load_cached_model,
    store_cached_model,
)
from core.models import ClientInfoDraft


def test_model_cache_round_trip(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("EXTRACTION_CACHE_DIR", str(tmp_path / "cache"))
    key = cache_key_for_text("client", "same inputs", "model-v1")
    expected = ClientInfoDraft(client_name="NESKAO", country="Cote d'Ivoire")

    store_cached_model(key, expected)

    assert load_cached_model(key, ClientInfoDraft) == expected


def test_file_cache_key_is_order_independent(tmp_path) -> None:
    first = tmp_path / "first.pdf"
    second = tmp_path / "second.pdf"
    first.write_bytes(b"first")
    second.write_bytes(b"second")

    forward = cache_key_for_files("documents", [str(first), str(second)], "model-v1")
    reverse = cache_key_for_files("documents", [str(second), str(first)], "model-v1")

    assert forward == reverse
