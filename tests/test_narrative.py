from __future__ import annotations

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
