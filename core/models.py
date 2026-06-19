from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class FieldConfidence(BaseModel):
    value: Any
    confidence: float = Field(ge=0, le=1)
    source_note: str | None = None


class BillTariffPeriod(BaseModel):
    label: str
    kwh: float | None = Field(default=None, ge=0)
    unit_price_per_kwh: float | None = Field(default=None, ge=0)
    energy_charge: float | None = Field(default=None, ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1)


class BillData(BaseModel):
    source_file: str | None = None
    monthly_kwh: float = Field(gt=0)
    currency: str = "USD"
    total_cost: float = Field(ge=0)
    tariff_per_kwh: float = Field(ge=0)
    billing_period_start: date | None = None
    billing_period_end: date | None = None
    tariff_periods: list[BillTariffPeriod] = Field(default_factory=list)
    active_energy_charge: float | None = Field(default=None, ge=0)
    penalties: float | None = Field(default=None, ge=0)
    taxes_and_fees: float | None = Field(default=None, ge=0)
    fixed_or_demand_charges: float | None = Field(default=None, ge=0)
    tariff_basis: str = "unknown"
    extraction_notes: list[str] = Field(default_factory=list)
    field_confidence: dict[str, float] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def fill_messy_bill_data(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        cleaned = dict(data)
        notes = list(cleaned.get("extraction_notes") or [])
        confidence = dict(cleaned.get("field_confidence") or {})
        periods = cleaned.get("tariff_periods") or cleaned.get("tou_periods") or []
        cleaned["tariff_periods"] = periods

        def period_value(period: Any, key: str) -> Any:
            if isinstance(period, dict):
                return period.get(key)
            return getattr(period, key, None)

        period_kwh = sum(
            float(period_value(period, "kwh") or 0)
            for period in periods
        )
        period_energy_charge = sum(
            float(period_value(period, "energy_charge") or 0)
            for period in periods
        )
        weighted_tariff_numerator = sum(
            float(period_value(period, "kwh") or 0)
            * float(period_value(period, "unit_price_per_kwh") or 0)
            for period in periods
            if period_value(period, "kwh") is not None
            and period_value(period, "unit_price_per_kwh") is not None
        )

        monthly_kwh = cleaned.get("monthly_kwh")
        if monthly_kwh is None or float(monthly_kwh or 0) <= 0:
            if period_kwh > 0:
                monthly_kwh = period_kwh
                cleaned["monthly_kwh"] = monthly_kwh
                notes.append("monthly_kwh calculated as the sum of extracted active tariff period kWh.")
                confidence["monthly_kwh"] = min(confidence.get("monthly_kwh", 0.8), 0.8)
            else:
                monthly_kwh = 10000.0
                cleaned["monthly_kwh"] = monthly_kwh
                notes.append("monthly_kwh missing or unreadable; fallback 10,000 kWh used.")
                confidence["monthly_kwh"] = min(confidence.get("monthly_kwh", 0.2), 0.2)

        total_cost = cleaned.get("total_cost")
        if total_cost is None or float(total_cost or 0) < 0:
            if period_energy_charge > 0:
                total_cost = period_energy_charge
                cleaned["total_cost"] = total_cost
                cleaned["active_energy_charge"] = cleaned.get("active_energy_charge") or total_cost
                notes.append("total_cost missing; active energy charge used as provisional total cost.")
                confidence["total_cost"] = min(confidence.get("total_cost", 0.5), 0.5)
            else:
                total_cost = float(monthly_kwh) * 0.20
                cleaned["total_cost"] = total_cost
                notes.append("total_cost missing or unreadable; fallback tariff of 0.20 used.")
                confidence["total_cost"] = min(confidence.get("total_cost", 0.2), 0.2)

        if cleaned.get("active_energy_charge") is None and period_energy_charge > 0:
            cleaned["active_energy_charge"] = period_energy_charge

        tariff = cleaned.get("tariff_per_kwh")
        if tariff is None or float(tariff or 0) <= 0:
            if period_kwh > 0 and weighted_tariff_numerator > 0:
                tariff = weighted_tariff_numerator / period_kwh
                cleaned["tariff_basis"] = "weighted_active_time_of_use_unit_prices"
                notes.append("tariff_per_kwh calculated as weighted average of active time-of-use unit prices.")
                confidence["tariff_per_kwh"] = min(confidence.get("tariff_per_kwh", 0.9), 0.9)
            elif cleaned.get("active_energy_charge") is not None and float(cleaned["active_energy_charge"]) > 0:
                tariff = float(cleaned["active_energy_charge"]) / float(monthly_kwh)
                cleaned["tariff_basis"] = "active_energy_charge_divided_by_active_kwh"
                notes.append("tariff_per_kwh calculated as active_energy_charge / monthly_kwh.")
                confidence["tariff_per_kwh"] = min(confidence.get("tariff_per_kwh", 0.8), 0.8)
            else:
                tariff = float(total_cost) / float(monthly_kwh)
                cleaned["tariff_basis"] = "total_invoice_divided_by_active_kwh"
                notes.append("tariff_per_kwh calculated as total_cost / monthly_kwh.")
                confidence["tariff_per_kwh"] = min(confidence.get("tariff_per_kwh", 0.5), 0.5)
            cleaned["tariff_per_kwh"] = tariff

        cleaned["currency"] = cleaned.get("currency") or "USD"
        cleaned["tariff_basis"] = cleaned.get("tariff_basis") or "unknown"
        cleaned["extraction_notes"] = notes
        cleaned["field_confidence"] = confidence
        return cleaned

    @field_validator("field_confidence")
    @classmethod
    def validate_confidence_map(cls, value: dict[str, float]) -> dict[str, float]:
        for key, confidence in value.items():
            if confidence < 0 or confidence > 1:
                raise ValueError(f"confidence for {key} must be between 0 and 1")
        return value


class BillExtractionResult(BaseModel):
    bills: list[BillData] = Field(default_factory=list)
    combined_bill: BillData
    warnings: list[str] = Field(default_factory=list)


class ClientInfo(BaseModel):
    client_name: str
    industry: str
    country: str
    city: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    business_description: str | None = None
    has_diesel_generators: bool = False
    grid_connection_kva: float | None = Field(default=None, ge=0)
    available_roof_area_m2: float | None = Field(default=None, ge=0)
    daytime_fraction_override: float | None = Field(default=None, gt=0, le=1)
    ppa_tariff_per_kwh_override: float | None = Field(default=None, ge=0)
    diesel_price_per_liter_override: float | None = Field(default=None, gt=0)

    @field_validator("industry")
    @classmethod
    def normalize_industry(cls, value: str) -> str:
        return value.strip().lower().replace(" ", "_")


class ClientInfoDraft(BaseModel):
    client_name: str | None = None
    industry: str | None = None
    country: str | None = None
    city: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    business_description: str | None = None
    has_diesel_generators: bool | None = None
    grid_connection_kva: float | None = Field(default=None, ge=0)
    available_roof_area_m2: float | None = Field(default=None, ge=0)
    daytime_fraction_override: float | None = Field(default=None, gt=0, le=1)
    ppa_tariff_per_kwh_override: float | None = Field(default=None, ge=0)
    diesel_price_per_liter_override: float | None = Field(default=None, ge=0)
    extraction_notes: list[str] = Field(default_factory=list)
    field_confidence: dict[str, float] = Field(default_factory=dict)

    @field_validator("industry")
    @classmethod
    def normalize_optional_industry(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().lower().replace(" ", "_")

    @field_validator("field_confidence")
    @classmethod
    def validate_optional_confidence_map(cls, value: dict[str, float]) -> dict[str, float]:
        for key, confidence in value.items():
            if confidence < 0 or confidence > 1:
                raise ValueError(f"confidence for {key} must be between 0 and 1")
        return value


class DocumentExtractionResult(BaseModel):
    bill: BillExtractionResult | None = None
    client: ClientInfoDraft | None = None
    warnings: list[str] = Field(default_factory=list)


class AssumptionsUsed(BaseModel):
    monthly_kwh: float
    daytime_fraction: float
    roof_area_m2: float | None
    grid_capacity_kva: float | None
    latitude: float | None
    longitude: float | None
    recommended_kwp: float
    ppa_tariff_per_kwh: float
    grid_tariff_per_kwh: float
    diesel_price_per_liter: float
    diesel_kwh_per_liter: float
    performance_ratio: float
    panel_degradation_rate: float
    tariff_escalation_rate: float
    analysis_horizon_years: int
    production_source: str
    confidence_notes: list[str] = Field(default_factory=list)
    extraction_notes: list[str] = Field(default_factory=list)


class PVRecommendation(BaseModel):
    recommended_kwp: float = Field(gt=0)
    binding_constraint: str
    constraints_kwp: dict[str, float]
    notes: list[str] = Field(default_factory=list)


class ScenarioResult(BaseModel):
    name: str
    monthly_savings_year_1: float
    annual_savings_year_1: float
    cumulative_savings: float
    year_1_solar_used_kwh: float
    yearly_savings: list[float]
    current_cost_per_kwh_year_1: float
    ppa_tariff_per_kwh: float


class CalcResult(BaseModel):
    daytime_kwh_monthly: float
    annual_daytime_consumption_kwh: float
    pv_recommendation: PVRecommendation
    annual_solar_production_kwh: float
    ppa_tariff_per_kwh: float
    scenario_grid_replacement: ScenarioResult
    scenario_grid_diesel: ScenarioResult
    assumptions: AssumptionsUsed
    warnings: list[str] = Field(default_factory=list)


class NarrativeSections(BaseModel):
    executive_summary: str
    current_energy_situation: str
    proposed_solar_solution: str
    ppa_model_explanation: str
    economic_analysis_summary: str
    scope_of_services: str
    implementation_process: str
    next_steps: str


class ProposalRequest(BaseModel):
    bill: BillData
    client: ClientInfo


class ProposalResponse(BaseModel):
    output_pptx_path: str
    calc_result: CalcResult
    narrative: NarrativeSections
    warnings: list[str] = Field(default_factory=list)
