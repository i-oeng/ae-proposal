from __future__ import annotations

import core.extraction as extraction
from core.config_loader import load_config
from core.models import BillData


def test_extract_multiple_bills_uses_kwh_weighted_tariff(monkeypatch) -> None:
    bills = {
        "jan.pdf":
        BillData(
            monthly_kwh=100,
            currency="XOF",
            total_cost=8000,
            tariff_per_kwh=80,
            billing_period_start=None,
            billing_period_end=None,
            tariff_periods=[
                {"label": "Nuit", "kwh": 40, "unit_price_per_kwh": 70, "energy_charge": 2800},
                {"label": "Jour", "kwh": 60, "unit_price_per_kwh": 86.6667, "energy_charge": 5200},
            ],
            active_energy_charge=8000,
            penalties=100,
            field_confidence={"tariff_per_kwh": 0.9},
        ),
        "feb.pdf":
        BillData(
            monthly_kwh=300,
            currency="XOF",
            total_cost=30000,
            tariff_per_kwh=100,
            billing_period_start=None,
            billing_period_end=None,
            tariff_periods=[
                {"label": "Nuit", "kwh": 100, "unit_price_per_kwh": 80, "energy_charge": 8000},
                {"label": "Jour", "kwh": 200, "unit_price_per_kwh": 110, "energy_charge": 22000},
            ],
            active_energy_charge=30000,
            penalties=300,
            field_confidence={"tariff_per_kwh": 0.9},
        ),
    }

    def fake_extract_bill(file_path, config):  # noqa: ARG001
        return bills[file_path]

    monkeypatch.setattr(extraction, "extract_bill", fake_extract_bill)
    combined = extraction.extract_multiple_bills(["jan.pdf", "feb.pdf"], load_config())

    assert combined.monthly_kwh == 200
    assert combined.total_cost == 19000
    assert combined.tariff_per_kwh == 95
    assert combined.active_energy_charge == 19000
    assert combined.penalties == 200
    assert len(combined.tariff_periods) == 2
    assert combined.tariff_periods[0].kwh == 70


def test_extract_bill_collection_preserves_monthly_bills(monkeypatch) -> None:
    bills = {
        "2025.01.pdf":
        BillData(
            source_file="2025.01.pdf",
            monthly_kwh=100,
            currency="XOF",
            total_cost=8000,
            tariff_per_kwh=80,
            billing_period_start=None,
            billing_period_end=None,
        ),
        "2025.02.pdf":
        BillData(
            source_file="2025.02.pdf",
            monthly_kwh=200,
            currency="XOF",
            total_cost=18000,
            tariff_per_kwh=90,
            billing_period_start=None,
            billing_period_end=None,
        ),
    }

    def fake_extract_bill(file_path, config):  # noqa: ARG001
        return bills[file_path]

    monkeypatch.setattr(extraction, "extract_bill", fake_extract_bill)
    result = extraction.extract_bill_collection(["2025.01.pdf", "2025.02.pdf"], load_config())

    assert len(result.bills) == 2
    assert result.bills[0].source_file == "2025.01.pdf"
    assert result.combined_bill.monthly_kwh == 150
