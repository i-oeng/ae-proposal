from __future__ import annotations

from core.client_extraction import _normalize_country, _normalize_industry, extract_client_info
from core.config_loader import load_config


def test_client_extraction_fallback_for_no_files() -> None:
    draft = extract_client_info([], load_config())
    assert draft.client_name is None
    assert draft.extraction_notes


def test_client_extraction_normalizers() -> None:
    assert _normalize_country("Côte d'Ivoire") == "Cote d'Ivoire"
    assert _normalize_country("Ivory Coast") == "Cote d'Ivoire"
    assert _normalize_industry("food processing") == "food_processing"
    assert _normalize_industry("cold storage") == "cold_storage"
