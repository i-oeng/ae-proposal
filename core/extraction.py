from __future__ import annotations

import base64
import json
import logging
import mimetypes
import os
import re
from datetime import date
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from core.config_loader import AppConfig
from core.models import BillData, BillExtractionResult, BillTariffPeriod
from core.utils import load_local_env

logger = logging.getLogger(__name__)
DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"


def fallback_bill(reason: str) -> BillData:
    return BillData(
        source_file=None,
        monthly_kwh=10000,
        currency="USD",
        total_cost=2000,
        tariff_per_kwh=0.20,
        billing_period_start=None,
        billing_period_end=None,
        tariff_basis="fallback_default_tariff",
        extraction_notes=[reason, "Fallback bill data must be reviewed before client use."],
        field_confidence={
            "monthly_kwh": 0.1,
            "currency": 0.1,
            "total_cost": 0.1,
            "tariff_per_kwh": 0.1,
        },
    )


def _extract_json_object(text: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        raise json.JSONDecodeError("No JSON object found", text, 0)
    return json.loads(match.group(0))


def _content_block_for_file(file_path: str) -> dict[str, Any]:
    path = Path(file_path)
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    if media_type.startswith("image/"):
        return {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": data},
        }
    return {
        "type": "document",
        "source": {"type": "base64", "media_type": media_type, "data": data},
    }


def _call_claude_for_bill(file_path: str) -> dict[str, Any]:
    load_local_env()
    from anthropic import Anthropic

    client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    model = os.getenv("ANTHROPIC_VISION_MODEL", DEFAULT_ANTHROPIC_MODEL)
    prompt = """
Extract utility bill data into strict JSON. Handle English, Russian, Kazakh, and French bills.

Many West African French bills are CIE/Compagnie Ivoirienne d'Electricite style invoices.
For those bills, pay special attention to:
- "TOTAL ACTIF" or active energy total. Use active kWh only for monthly_kwh.
- Time-of-use rows such as "Nuit", "Pointe", and "Jour". If present, monthly_kwh is the sum of those active kWh values.
- Ignore "Reactif", "Ima", penalties, taxes, and demand/fixed charges when identifying active kWh.
- "MONTANT TOTAL FACTURE", "NET A PAYER", or similar should be total_cost: the total invoice amount due.
- If penalties such as "PENALITE MAUVAIS FACT" or "PENALITE DEPASSEMENT" appear, include them in penalties and extraction_notes.
- For tariff_per_kwh on time-of-use bills, prefer the weighted average active energy tariff:
  sum(active_kwh_by_period * active_unit_price_by_period) / sum(active_kwh_by_period).
  Use unit prices from "PRIX UNITAIRE" for active energy rows, excluding penalties, taxes, and fixed charges.
- If no unit prices are visible, use active_energy_charge / monthly_kwh when available.
- Use total_cost / monthly_kwh only as a last resort, with low tariff confidence and a note explaining that total invoice includes non-energy charges.
- For "PERIODE DE CONSOMMATION MM/YYYY", set billing_period_start to the first day of that month and billing_period_end to the last day of that month. Do not use the payment due date as the consumption end date.

Return exactly this JSON object and no prose:
{
  "monthly_kwh": number | null,
  "currency": "USD" | "GHS" | "XOF" | "NGN" | "KZT" | "RUB" | string,
  "total_cost": number | null,
  "tariff_per_kwh": number | null,
  "billing_period_start": "YYYY-MM-DD" | null,
  "billing_period_end": "YYYY-MM-DD" | null,
  "tariff_periods": [
    {
      "label": "Nuit" | "Pointe" | "Jour" | string,
      "kwh": number | null,
      "unit_price_per_kwh": number | null,
      "energy_charge": number | null,
      "confidence": number between 0 and 1
    }
  ],
  "active_energy_charge": number | null,
  "penalties": number | null,
  "taxes_and_fees": number | null,
  "fixed_or_demand_charges": number | null,
  "tariff_basis": "weighted_active_time_of_use_unit_prices" | "active_energy_charge_divided_by_active_kwh" | "total_invoice_divided_by_active_kwh" | "extracted_direct" | "unknown",
  "extraction_notes": ["short note"],
  "field_confidence": {
    "monthly_kwh": number between 0 and 1,
    "currency": number between 0 and 1,
    "total_cost": number between 0 and 1,
    "tariff_per_kwh": number between 0 and 1,
    "tariff_periods": number between 0 and 1,
    "active_energy_charge": number between 0 and 1,
    "penalties": number between 0 and 1
  }
}
If a value is missing, use null and explain it in extraction_notes. Do not guess silently.
"""
    message = client.messages.create(
        model=model,
        max_tokens=1800,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    _content_block_for_file(file_path),
                ],
            }
        ],
    )
    text = "".join(block.text for block in message.content if getattr(block, "type", None) == "text")
    return _extract_json_object(text)


def extract_bill(file_path: str, config: AppConfig) -> BillData:  # noqa: ARG001
    load_local_env()
    if not Path(file_path).exists():
        return fallback_bill(f"Bill file not found: {file_path}").model_copy(
            update={"source_file": Path(file_path).name}
        )
    if not os.getenv("ANTHROPIC_API_KEY"):
        return fallback_bill("ANTHROPIC_API_KEY not set; extraction fallback used.")

    last_error: Exception | None = None
    for _attempt in range(2):
        try:
            payload = _call_claude_for_bill(file_path)
            bill = BillData.model_validate(payload)
            return bill.model_copy(update={"source_file": Path(file_path).name})
        except (json.JSONDecodeError, ValidationError, OSError, Exception) as exc:  # noqa: BLE001
            logger.warning("Bill extraction attempt failed: %s", exc)
            last_error = exc

    bill = fallback_bill(
        f"Claude extraction failed twice using model "
        f"{os.getenv('ANTHROPIC_VISION_MODEL', DEFAULT_ANTHROPIC_MODEL)}: {last_error}"
    )
    return bill.model_copy(update={"source_file": Path(file_path).name})


def _average_optional(values: list[float | None]) -> float | None:
    usable = [value for value in values if value is not None]
    if not usable:
        return None
    return sum(usable) / len(usable)


def _aggregate_tariff_periods(bills: list[BillData]) -> list[BillTariffPeriod]:
    grouped: dict[str, dict[str, float | str]] = {}
    for bill in bills:
        for period in bill.tariff_periods:
            key = period.label.strip().lower()
            if not key:
                continue
            entry = grouped.setdefault(
                key,
                {
                    "label": period.label,
                    "kwh": 0.0,
                    "price_weight": 0.0,
                    "price_kwh": 0.0,
                    "energy_charge": 0.0,
                    "energy_charge_count": 0.0,
                    "confidence": 0.0,
                    "confidence_count": 0.0,
                },
            )
            if period.kwh is not None:
                entry["kwh"] = float(entry["kwh"]) + period.kwh
                if period.unit_price_per_kwh is not None:
                    entry["price_weight"] = float(entry["price_weight"]) + period.kwh * period.unit_price_per_kwh
                    entry["price_kwh"] = float(entry["price_kwh"]) + period.kwh
            if period.energy_charge is not None:
                entry["energy_charge"] = float(entry["energy_charge"]) + period.energy_charge
                entry["energy_charge_count"] = float(entry["energy_charge_count"]) + 1
            if period.confidence is not None:
                entry["confidence"] = float(entry["confidence"]) + period.confidence
                entry["confidence_count"] = float(entry["confidence_count"]) + 1

    count = len(bills)
    aggregated: list[BillTariffPeriod] = []
    for entry in grouped.values():
        price_kwh = float(entry["price_kwh"])
        charge_count = float(entry["energy_charge_count"])
        confidence_count = float(entry["confidence_count"])
        aggregated.append(
            BillTariffPeriod(
                label=str(entry["label"]),
                kwh=float(entry["kwh"]) / count if count else None,
                unit_price_per_kwh=float(entry["price_weight"]) / price_kwh if price_kwh > 0 else None,
                energy_charge=float(entry["energy_charge"]) / charge_count if charge_count > 0 else None,
                confidence=float(entry["confidence"]) / confidence_count if confidence_count > 0 else None,
            )
        )
    return aggregated


def combine_bills(bills: list[BillData]) -> BillData:
    usable = [bill for bill in bills if bill.monthly_kwh > 0 and bill.total_cost >= 0]
    if not usable:
        return fallback_bill("No usable bill data extracted.")

    count = len(usable)
    monthly_kwh = sum(bill.monthly_kwh for bill in usable) / count
    total_cost = sum(bill.total_cost for bill in usable) / count
    active_energy_charge = _average_optional([bill.active_energy_charge for bill in usable])
    penalties = _average_optional([bill.penalties for bill in usable])
    taxes_and_fees = _average_optional([bill.taxes_and_fees for bill in usable])
    fixed_or_demand_charges = _average_optional([bill.fixed_or_demand_charges for bill in usable])
    total_kwh = sum(bill.monthly_kwh for bill in usable)
    tariff = (
        sum(bill.tariff_per_kwh * bill.monthly_kwh for bill in usable) / total_kwh
        if total_kwh > 0
        else sum(bill.tariff_per_kwh for bill in usable) / count
    )
    currency = usable[0].currency
    notes: list[str] = []
    confidence: dict[str, float] = {}

    for bill in bills:
        for note in bill.extraction_notes:
            if note not in notes:
                notes.append(note)
        for key, value in bill.field_confidence.items():
            confidence.setdefault(key, 0)
            confidence[key] += value / count

    min_kwh = min(bill.monthly_kwh for bill in usable)
    max_kwh = max(bill.monthly_kwh for bill in usable)
    if min_kwh > 0 and max_kwh > 1.4 * min_kwh:
        notes.append("Possible seasonality: max monthly kWh is more than 1.4x min monthly kWh.")

    starts = [bill.billing_period_start for bill in usable if bill.billing_period_start]
    ends = [bill.billing_period_end for bill in usable if bill.billing_period_end]
    billing_start: date | None = min(starts) if starts else None
    billing_end: date | None = max(ends) if ends else None

    return BillData(
        source_file=None,
        monthly_kwh=monthly_kwh,
        currency=currency,
        total_cost=total_cost,
        tariff_per_kwh=tariff,
        billing_period_start=billing_start,
        billing_period_end=billing_end,
        tariff_periods=_aggregate_tariff_periods(usable),
        active_energy_charge=active_energy_charge,
        penalties=penalties,
        taxes_and_fees=taxes_and_fees,
        fixed_or_demand_charges=fixed_or_demand_charges,
        tariff_basis="kwh_weighted_average_across_uploaded_bills",
        extraction_notes=notes,
        field_confidence=confidence,
    )


def extract_bill_collection(file_paths: list[str], config: AppConfig) -> BillExtractionResult:
    if not file_paths:
        fallback = fallback_bill("No bills uploaded; fallback bill data used.")
        return BillExtractionResult(
            bills=[],
            combined_bill=fallback,
            warnings=["No bills uploaded."],
        )

    bills = [extract_bill(path, config) for path in file_paths]
    combined = combine_bills(bills)
    warnings: list[str] = []
    if combined.extraction_notes:
        warnings.extend(
            note
            for note in combined.extraction_notes
            if "fallback" in note.lower() or "seasonality" in note.lower()
        )
    return BillExtractionResult(bills=bills, combined_bill=combined, warnings=warnings)


def extract_multiple_bills(file_paths: list[str], config: AppConfig) -> BillData:
    return extract_bill_collection(file_paths, config).combined_bill
