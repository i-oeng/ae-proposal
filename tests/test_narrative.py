from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Lock
import time

from core import narrative
from core.calc_engine import calculate_proposal
from core.config_loader import load_config
from core.models import BillData, ClientInfo


def test_unauthorized_numbers_are_sanitized_without_second_model_call(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("EXTRACTION_CACHE_DIR", str(tmp_path / "cache"))
    calls = 0

    def fake_call(prompt_payload: str):  # noqa: ARG001
        nonlocal calls
        calls += 1
        return {
            "executive_summary": "A safe proposal with an invented 999-year term.",
            "current_energy_situation": "Current energy use has been reviewed.",
            "proposed_solar_solution": "The proposed system follows the calculated sizing.",
            "ppa_model_explanation": "The PPA avoids upfront system funding.",
            "economic_analysis_summary": "Savings follow the deterministic model.",
            "scope_of_services": "Scope is subject to commercial confirmation.",
            "implementation_process": "Implementation follows technical validation.",
            "next_steps": "Proceed with review and confirmation.",
        }

    monkeypatch.setattr(narrative, "_call_claude_narrative", fake_call)
    bill = BillData(monthly_kwh=10000, currency="XOF", total_cost=1000000, tariff_per_kwh=100)
    client = ClientInfo(
        client_name="NESKAO",
        industry="food_processing",
        country="Cote d'Ivoire",
        has_diesel_generators=True,
    )
    config = load_config().model_copy(update={"use_nasa_power": False})
    calc = calculate_proposal(bill, client, config)

    result = narrative.generate_narrative(bill, client, calc, "approved facts", None, config)

    assert calls == 1
    assert "999" not in result.executive_summary


def test_matching_concurrent_narratives_share_one_model_call(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("EXTRACTION_CACHE_DIR", str(tmp_path / "cache"))
    calls = 0
    calls_lock = Lock()

    def fake_call(prompt_payload: str):  # noqa: ARG001
        nonlocal calls
        with calls_lock:
            calls += 1
        time.sleep(0.05)
        return {
            "executive_summary": "Proposal summary.",
            "current_energy_situation": "Current energy situation.",
            "proposed_solar_solution": "Proposed solar solution.",
            "ppa_model_explanation": "PPA model explanation.",
            "economic_analysis_summary": "Economic analysis.",
            "scope_of_services": "Scope of services.",
            "implementation_process": "Implementation process.",
            "next_steps": "Next steps.",
        }

    monkeypatch.setattr(narrative, "_call_claude_narrative", fake_call)
    bill = BillData(monthly_kwh=12000, currency="XOF", total_cost=1200000, tariff_per_kwh=100)
    client = ClientInfo(
        client_name="Parallel Client",
        industry="food_processing",
        country="Cote d'Ivoire",
        has_diesel_generators=True,
    )
    config = load_config().model_copy(update={"use_nasa_power": False})
    calc = calculate_proposal(bill, client, config)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                narrative.generate_narrative,
                bill,
                client,
                calc,
                "approved facts",
                None,
                config,
            )
            for _ in range(2)
        ]
        results = [future.result() for future in futures]

    assert calls == 1
    assert results[0] == results[1]
