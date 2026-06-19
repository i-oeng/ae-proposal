from __future__ import annotations

import pytest

from core.models import BillData, ClientInfo


def test_bill_data_computes_tariff_when_missing() -> None:
    bill = BillData(
        monthly_kwh=1000,
        total_cost=250,
        tariff_per_kwh=0,
        billing_period_start=None,
        billing_period_end=None,
        field_confidence={},
    )
    assert bill.tariff_per_kwh == pytest.approx(0.25)
    assert "tariff_per_kwh" in bill.field_confidence


def test_bill_data_fallbacks_for_messy_input() -> None:
    bill = BillData.model_validate(
        {
            "currency": "USD",
            "monthly_kwh": None,
            "total_cost": None,
            "tariff_per_kwh": None,
            "field_confidence": {},
        }
    )
    assert bill.monthly_kwh == pytest.approx(10000)
    assert bill.total_cost == pytest.approx(2000)
    assert bill.tariff_per_kwh == pytest.approx(0.20)
    assert bill.extraction_notes


def test_client_industry_normalized() -> None:
    client = ClientInfo(
        client_name="Client",
        industry="Food Processing",
        country="Ghana",
        has_diesel_generators=False,
    )
    assert client.industry == "food_processing"


def test_bill_data_computes_weighted_tariff_from_periods() -> None:
    bill = BillData.model_validate(
        {
            "monthly_kwh": None,
            "currency": "XOF",
            "total_cost": 50000,
            "tariff_per_kwh": None,
            "tariff_periods": [
                {"label": "Nuit", "kwh": 100, "unit_price_per_kwh": 70, "energy_charge": 7000},
                {"label": "Jour", "kwh": 300, "unit_price_per_kwh": 90, "energy_charge": 27000},
            ],
            "field_confidence": {},
        }
    )
    assert bill.monthly_kwh == pytest.approx(400)
    assert bill.active_energy_charge == pytest.approx(34000)
    assert bill.tariff_per_kwh == pytest.approx(85)
    assert bill.tariff_basis == "weighted_active_time_of_use_unit_prices"
