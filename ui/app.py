from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.calc_engine import calculate_proposal
from core.client_extraction import extract_client_info
from core.config_loader import load_config
from core.extraction import extract_bill_collection
from core.models import BillData, BillTariffPeriod, ClientInfo
from core.pipeline import generate_proposal_artifacts
from core.utils import ensure_dir, format_currency, format_kwp, format_number, load_local_env


load_local_env()

TEXT_STATE_KEYS = [
    "bill_monthly_kwh",
    "bill_currency",
    "bill_total_cost",
    "bill_tariff",
    "bill_period_start",
    "bill_period_end",
    "bill_active_energy_charge",
    "bill_penalties",
    "bill_taxes_and_fees",
    "bill_fixed_or_demand_charges",
    "bill_tariff_basis",
    "bill_notes",
    "client_name",
    "city",
    "business_description",
    "client_notes",
    "grid_connection_kva",
    "latitude",
    "available_roof_area_m2",
    "longitude",
    "daytime_fraction_override",
    "ppa_tariff_per_kwh_override",
    "diesel_price_per_liter_override",
]

APP_STATE_KEYS = [
    "extracted_bill",
    "extracted_monthly_bills",
    "extracted_client_info",
    "bill_confidence",
    "bill_tariff_periods",
    "bill_editor_version",
    "client_confidence",
    "industry",
    "country",
    "has_diesel_generators",
    "proposal_path",
    "proposal_warnings",
    *TEXT_STATE_KEYS,
]

LEGACY_DEFAULTS = {
    "bill_monthly_kwh": 10000.0,
    "bill_currency": "USD",
    "bill_total_cost": 2000.0,
    "bill_tariff": 0.20,
    "bill_period_start": None,
    "bill_period_end": None,
    "bill_notes": "Demo defaults loaded. Replace with extracted or confirmed bill data.",
    "client_name": "Neskao",
    "industry": "food_processing",
    "country": "Ghana",
    "city": "Accra",
    "business_description": "",
    "has_diesel_generators": True,
    "grid_connection_kva": 600.0,
    "latitude": 0.0,
    "available_roof_area_m2": 4000.0,
    "longitude": 0.0,
    "daytime_fraction_override": 0.75,
    "ppa_tariff_per_kwh_override": 0.0,
    "diesel_price_per_liter_override": 0.0,
}

st.set_page_config(
    page_title="Aspan Proposal Engine",
    page_icon=None,
    layout="wide",
    initial_sidebar_state="expanded",
)


st.markdown(
    """
    <style>
    :root {
      --aspan-ink: #173b33;
      --aspan-text: #1f2933;
      --aspan-muted: #62716c;
      --aspan-teal: #00a884;
      --aspan-amber: #f4b942;
      --aspan-paper: #f7faf8;
      --aspan-line: #d7e3de;
    }
    .stApp {
      background:
        repeating-linear-gradient(135deg, rgba(0,168,132,0.035) 0, rgba(0,168,132,0.035) 1px, transparent 1px, transparent 12px),
        linear-gradient(180deg, #fbfdfb 0%, #eef6f2 100%);
      color: var(--aspan-text);
    }
    [data-testid="stSidebar"] {
      background: #163b33;
      color: white;
      border-right: 4px solid var(--aspan-amber);
    }
    [data-testid="stSidebar"] h1,
    [data-testid="stSidebar"] h2,
    [data-testid="stSidebar"] h3,
    [data-testid="stSidebar"] p,
    [data-testid="stSidebar"] small,
    [data-testid="stSidebar"] label {
      color: white;
    }
    h1, h2, h3 { color: var(--aspan-ink); letter-spacing: 0; }
    label,
    .stMarkdown,
    [data-testid="stText"],
    [data-testid="stWidgetLabel"] {
      color: var(--aspan-text);
    }
    input,
    textarea,
    [data-baseweb="input"] input,
    [data-baseweb="textarea"] textarea,
    [data-baseweb="select"] div,
    [data-baseweb="popover"] div,
    [role="listbox"] div {
      color: var(--aspan-text) !important;
    }
    input::placeholder,
    textarea::placeholder {
      color: #7a8782 !important;
      opacity: 1;
    }
    [data-baseweb="input"],
    [data-baseweb="textarea"],
    [data-baseweb="select"] > div {
      background: #ffffff !important;
      border-color: var(--aspan-line) !important;
    }
    [data-testid="stFileUploaderDropzone"] {
      background: rgba(255,255,255,0.86);
      border-color: var(--aspan-line);
    }
    [data-testid="stFileUploaderDropzone"] * {
      color: var(--aspan-text) !important;
    }
    div[data-testid="stMetric"] {
      background: rgba(255,255,255,0.82);
      border: 1px solid var(--aspan-line);
      border-left: 4px solid var(--aspan-teal);
      padding: 0.65rem 0.8rem;
    }
    .stButton > button, .stDownloadButton > button {
      background: var(--aspan-ink);
      color: white;
      border: 1px solid var(--aspan-ink);
      border-radius: 6px;
      min-height: 42px;
      font-weight: 700;
    }
    .stButton > button:hover, .stDownloadButton > button:hover {
      background: #0f2b25;
      color: white;
      border-color: var(--aspan-amber);
    }
    div[data-testid="stAlert"] {
      border-radius: 6px;
    }
    div[data-testid="stAlert"] * {
      color: var(--aspan-text) !important;
    }
    [data-testid="stSidebar"] .stButton > button {
      color: white !important;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_resource
def get_config():
    return load_config()


def save_uploads(uploaded_files) -> list[str]:
    upload_dir = ensure_dir("cache/uploads")
    paths: list[str] = []
    for uploaded in uploaded_files:
        target = upload_dir / Path(uploaded.name).name
        target.write_bytes(uploaded.getbuffer())
        paths.append(str(target))
    return paths


def reset_bill_review() -> None:
    for key in APP_STATE_KEYS:
        if key.startswith("bill_") or key in {
            "extracted_bill",
            "extracted_monthly_bills",
            "proposal_path",
            "proposal_warnings",
        }:
            st.session_state.pop(key, None)


def reset_client_review() -> None:
    for key in APP_STATE_KEYS:
        if key in {
            "extracted_client_info",
            "client_confidence",
            "client_name",
            "industry",
            "country",
            "city",
            "business_description",
            "client_notes",
            "has_diesel_generators",
            "grid_connection_kva",
            "latitude",
            "available_roof_area_m2",
            "longitude",
            "daytime_fraction_override",
            "ppa_tariff_per_kwh_override",
            "diesel_price_per_liter_override",
            "proposal_path",
            "proposal_warnings",
        }:
            st.session_state.pop(key, None)


def clear_all_inputs() -> None:
    for key in APP_STATE_KEYS:
        st.session_state.pop(key, None)


def legacy_value_matches(current, old_value) -> bool:
    if current == old_value:
        return True
    if old_value is None:
        return current in {None, ""}
    if isinstance(old_value, float):
        try:
            return float(str(current).replace(",", "").strip()) == old_value
        except ValueError:
            return False
    return str(current) == str(old_value)


def clear_legacy_demo_defaults() -> None:
    if st.session_state.get("_blank_defaults_migrated_client_extraction"):
        return
    for key, old_value in LEGACY_DEFAULTS.items():
        if key in st.session_state and legacy_value_matches(st.session_state.get(key), old_value):
            st.session_state.pop(key, None)
    st.session_state["_blank_defaults_migrated_client_extraction"] = True


def normalize_text_state() -> None:
    for key in TEXT_STATE_KEYS:
        if key not in st.session_state or st.session_state[key] is None:
            continue
        value = st.session_state[key]
        if isinstance(value, date):
            st.session_state[key] = value.isoformat()
        elif not isinstance(value, str):
            st.session_state[key] = f"{value:g}" if isinstance(value, float) else str(value)


def parse_float_field(
    key: str,
    label: str,
    errors: list[str],
    missing: list[str],
    *,
    required: bool = False,
    positive: bool = False,
    nonnegative: bool = False,
) -> float | None:
    raw = str(st.session_state.get(key, "") or "").strip()
    if not raw:
        if required:
            missing.append(label)
        return None
    try:
        value = float(raw.replace(",", "").replace(" ", ""))
    except ValueError:
        errors.append(f"{label} must be a number.")
        return None
    if positive and value <= 0:
        errors.append(f"{label} must be greater than zero.")
    if nonnegative and value < 0:
        errors.append(f"{label} cannot be negative.")
    return value


def parse_date_field(key: str, label: str, errors: list[str]) -> date | None:
    raw = str(st.session_state.get(key, "") or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        errors.append(f"{label} must use YYYY-MM-DD format.")
        return None


def monthly_bill_summary_rows(bills: list[BillData]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for bill in bills:
        rows.append(
            {
                "file": bill.source_file or "",
                "period_start": bill.billing_period_start.isoformat() if bill.billing_period_start else "",
                "period_end": bill.billing_period_end.isoformat() if bill.billing_period_end else "",
                "kwh": round(bill.monthly_kwh, 2),
                "total_cost": round(bill.total_cost, 2),
                "tariff": round(bill.tariff_per_kwh, 4),
                "active_energy_charge": round(bill.active_energy_charge, 2) if bill.active_energy_charge is not None else None,
                "penalties": round(bill.penalties, 2) if bill.penalties is not None else None,
                "tariff_basis": bill.tariff_basis,
            }
        )
    return rows


def parse_optional_number_value(value, label: str, errors: list[str]) -> float | None:
    raw = "" if value is None else str(value).strip()
    if not raw:
        return None
    try:
        return float(raw.replace(",", "").replace(" ", ""))
    except ValueError:
        errors.append(f"{label} must be a number.")
        return None


def parse_tariff_period_rows(errors: list[str]) -> list[BillTariffPeriod]:
    rows = st.session_state.get("bill_tariff_periods", [])
    if hasattr(rows, "to_dict"):
        rows = rows.to_dict("records")
    if not isinstance(rows, list):
        return []

    periods: list[BillTariffPeriod] = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or "").strip()
        if not label:
            continue
        kwh = parse_optional_number_value(row.get("kwh"), f"Tariff row {index} kWh", errors)
        unit_price = parse_optional_number_value(
            row.get("unit_price_per_kwh"),
            f"Tariff row {index} unit price",
            errors,
        )
        energy_charge = parse_optional_number_value(
            row.get("energy_charge"),
            f"Tariff row {index} energy charge",
            errors,
        )
        confidence = parse_optional_number_value(
            row.get("confidence"),
            f"Tariff row {index} confidence",
            errors,
        )
        if confidence is not None and not 0 <= confidence <= 1:
            errors.append(f"Tariff row {index} confidence must be between 0 and 1.")
        periods.append(
            BillTariffPeriod(
                label=label,
                kwh=kwh,
                unit_price_per_kwh=unit_price,
                energy_charge=energy_charge,
                confidence=confidence,
            )
        )
    return periods


def bill_from_form() -> tuple[BillData | None, list[str], list[str]]:
    errors: list[str] = []
    missing: list[str] = []
    monthly_kwh = parse_float_field(
        "bill_monthly_kwh",
        "Monthly kWh",
        errors,
        missing,
        required=True,
        positive=True,
    )
    total_cost = parse_float_field(
        "bill_total_cost",
        "Total cost",
        errors,
        missing,
        required=True,
        nonnegative=True,
    )
    tariff_periods = parse_tariff_period_rows(errors)
    active_energy_charge = parse_float_field(
        "bill_active_energy_charge",
        "Active energy charge",
        errors,
        missing,
        nonnegative=True,
    )
    penalties = parse_float_field("bill_penalties", "Penalties", errors, missing, nonnegative=True)
    taxes_and_fees = parse_float_field("bill_taxes_and_fees", "Taxes and fees", errors, missing, nonnegative=True)
    fixed_or_demand_charges = parse_float_field(
        "bill_fixed_or_demand_charges",
        "Fixed or demand charges",
        errors,
        missing,
        nonnegative=True,
    )
    tariff = parse_float_field(
        "bill_tariff",
        "Tariff per kWh",
        errors,
        missing,
        positive=True,
    )
    currency = str(st.session_state.get("bill_currency", "") or "").strip()
    if not currency:
        missing.append("Currency")

    billing_start = parse_date_field("bill_period_start", "Billing period start", errors)
    billing_end = parse_date_field("bill_period_end", "Billing period end", errors)
    if tariff is None and not tariff_periods and active_energy_charge is None:
        missing.append("Tariff per kWh or tariff breakdown")

    if errors or missing or monthly_kwh is None or total_cost is None:
        return None, errors, missing

    return BillData(
        monthly_kwh=monthly_kwh,
        currency=currency,
        total_cost=total_cost,
        tariff_per_kwh=tariff,
        billing_period_start=billing_start,
        billing_period_end=billing_end,
        tariff_periods=tariff_periods,
        active_energy_charge=active_energy_charge,
        penalties=penalties,
        taxes_and_fees=taxes_and_fees,
        fixed_or_demand_charges=fixed_or_demand_charges,
        tariff_basis=st.session_state.get("bill_tariff_basis") or "reviewed_manual_or_extracted",
        extraction_notes=st.session_state.get("bill_notes", "").splitlines(),
        field_confidence=st.session_state.get("bill_confidence", {}),
    ), errors, missing


def client_from_form() -> tuple[ClientInfo | None, list[str], list[str]]:
    errors: list[str] = []
    missing: list[str] = []
    client_name = str(st.session_state.get("client_name", "") or "").strip()
    industry = st.session_state.get("industry")
    country = st.session_state.get("country")
    if not client_name:
        missing.append("Client name")
    if not industry:
        missing.append("Industry")
    if not country:
        missing.append("Country")

    latitude = parse_float_field("latitude", "Latitude", errors, missing)
    longitude = parse_float_field("longitude", "Longitude", errors, missing)
    grid_kva = parse_float_field("grid_connection_kva", "Grid connection kVA", errors, missing, nonnegative=True)
    roof_area = parse_float_field("available_roof_area_m2", "Available roof area m2", errors, missing, nonnegative=True)
    daytime_override = parse_float_field("daytime_fraction_override", "Daytime fraction override", errors, missing)
    ppa_override = parse_float_field("ppa_tariff_per_kwh_override", "PPA tariff override", errors, missing, nonnegative=True)
    diesel_override = parse_float_field(
        "diesel_price_per_liter_override",
        "Diesel price per liter override",
        errors,
        missing,
        nonnegative=True,
    )
    if daytime_override is not None and not 0 < daytime_override <= 1:
        errors.append("Daytime fraction override must be between 0 and 1.")

    if errors or missing or not client_name or not industry or not country:
        return None, errors, missing

    return ClientInfo(
        client_name=client_name,
        industry=industry,
        country=country,
        city=st.session_state.get("city") or None,
        latitude=latitude,
        longitude=longitude,
        business_description=st.session_state.get("business_description") or None,
        has_diesel_generators=st.session_state.get("has_diesel_generators", False),
        grid_connection_kva=grid_kva,
        available_roof_area_m2=roof_area,
        daytime_fraction_override=daytime_override,
        ppa_tariff_per_kwh_override=ppa_override,
        diesel_price_per_liter_override=diesel_override,
    ), errors, missing


def apply_client_draft_to_state(draft) -> None:
    industry_options = {"manufacturing", "cold_storage", "food_processing", "retail", "hospitality"}
    country_options = {"Ghana", "Nigeria", "Senegal", "Cote d'Ivoire"}
    field_map = {
        "client_name": draft.client_name,
        "city": draft.city,
        "business_description": draft.business_description,
        "grid_connection_kva": draft.grid_connection_kva,
        "latitude": draft.latitude,
        "available_roof_area_m2": draft.available_roof_area_m2,
        "longitude": draft.longitude,
        "daytime_fraction_override": draft.daytime_fraction_override,
        "ppa_tariff_per_kwh_override": draft.ppa_tariff_per_kwh_override,
        "diesel_price_per_liter_override": draft.diesel_price_per_liter_override,
    }
    for key, value in field_map.items():
        if value is not None:
            st.session_state[key] = f"{value:g}" if isinstance(value, float) else value
    if draft.industry in industry_options:
        st.session_state["industry"] = draft.industry
    if draft.country in country_options:
        st.session_state["country"] = draft.country
    if draft.has_diesel_generators is not None:
        st.session_state["has_diesel_generators"] = draft.has_diesel_generators
    st.session_state["client_notes"] = "\n".join(draft.extraction_notes)
    st.session_state["client_confidence"] = draft.field_confidence


config = get_config()
clear_legacy_demo_defaults()
normalize_text_state()

with st.sidebar:
    st.title("Aspan")
    st.caption("Proposal Engine")
    st.divider()
    st.write("Deterministic Python owns the calculations.")
    st.write("Claude is limited to extraction and prose.")
    st.write("Streamlit is the local demo UI.")
    st.divider()
    if os.getenv("ANTHROPIC_API_KEY"):
        st.success("Claude API key loaded")
        st.caption(f"Vision: {os.getenv('ANTHROPIC_VISION_MODEL', 'claude-sonnet-4-6')}")
        st.caption(f"Text: {os.getenv('ANTHROPIC_TEXT_MODEL', 'claude-sonnet-4-6')}")
    else:
        st.error("Claude API key not loaded")
        st.caption("Check `.env`, then fully restart Streamlit.")
    if st.button("Clear all inputs", use_container_width=True):
        clear_all_inputs()
        st.rerun()

st.title("Aspan Proposal Engine")
st.caption("Upload bills, confirm assumptions, preview economics, and generate an editable PowerPoint proposal.")

utility_tab, client_tab = st.tabs(["Utility Bills", "Client Information"])

with utility_tab:
    st.subheader("Utility Bill Extraction")
    uploaded_files = st.file_uploader(
        "Upload utility bills",
        type=["pdf", "png", "jpg", "jpeg"],
        accept_multiple_files=True,
        key="utility_bill_uploads",
    )
    button_col, reset_col = st.columns([0.68, 0.32])
    extract_clicked = button_col.button("Extract Bill Data", use_container_width=True)
    if reset_col.button("Clear Bill", use_container_width=True):
        reset_bill_review()
        st.rerun()
    if extract_clicked:
        if not uploaded_files:
            st.warning("Upload at least one bill before extracting.")
        else:
            paths = save_uploads(uploaded_files)
            extraction_result = extract_bill_collection(paths, config)
            bill = extraction_result.combined_bill
            st.session_state["extracted_bill"] = bill
            st.session_state["extracted_monthly_bills"] = [
                monthly_bill.model_dump(mode="json")
                for monthly_bill in extraction_result.bills
            ]
            st.session_state["bill_monthly_kwh"] = f"{bill.monthly_kwh:g}"
            st.session_state["bill_currency"] = bill.currency
            st.session_state["bill_total_cost"] = f"{bill.total_cost:g}"
            st.session_state["bill_tariff"] = f"{bill.tariff_per_kwh:g}"
            st.session_state["bill_period_start"] = bill.billing_period_start.isoformat() if bill.billing_period_start else ""
            st.session_state["bill_period_end"] = bill.billing_period_end.isoformat() if bill.billing_period_end else ""
            st.session_state["bill_tariff_periods"] = [
                period.model_dump(mode="json") for period in bill.tariff_periods
            ]
            st.session_state["bill_active_energy_charge"] = (
                f"{bill.active_energy_charge:g}" if bill.active_energy_charge is not None else ""
            )
            st.session_state["bill_penalties"] = f"{bill.penalties:g}" if bill.penalties is not None else ""
            st.session_state["bill_taxes_and_fees"] = (
                f"{bill.taxes_and_fees:g}" if bill.taxes_and_fees is not None else ""
            )
            st.session_state["bill_fixed_or_demand_charges"] = (
                f"{bill.fixed_or_demand_charges:g}" if bill.fixed_or_demand_charges is not None else ""
            )
            st.session_state["bill_tariff_basis"] = bill.tariff_basis
            st.session_state["bill_editor_version"] = st.session_state.get("bill_editor_version", 0) + 1
            st.session_state["bill_notes"] = "\n".join(bill.extraction_notes)
            st.session_state["bill_confidence"] = bill.field_confidence
            st.success("Bill data extracted. Review and edit before generating.")

    extracted_monthly_bills = [
        BillData.model_validate(row)
        for row in st.session_state.get("extracted_monthly_bills", [])
        if isinstance(row, dict)
    ]
    if extracted_monthly_bills:
        st.subheader("Monthly Bill Summary")
        st.dataframe(
            monthly_bill_summary_rows(extracted_monthly_bills),
            use_container_width=True,
            hide_index=True,
        )

    st.subheader("Parsed Bill Review")
    st.text_input("Monthly kWh", key="bill_monthly_kwh", placeholder="Required")
    col_a, col_b = st.columns(2)
    with col_a:
        st.text_input("Currency", key="bill_currency", placeholder="Required")
        st.text_input("Billing period start", key="bill_period_start", placeholder="YYYY-MM-DD")
    with col_b:
        st.text_input("Total cost", key="bill_total_cost", placeholder="Required")
        st.text_input("Billing period end", key="bill_period_end", placeholder="YYYY-MM-DD")
    st.text_input("Tariff per kWh", key="bill_tariff", placeholder="Optional if breakdown is present")
    st.text_input("Tariff basis", key="bill_tariff_basis", placeholder="How tariff was derived")

    st.markdown("**Time-of-use breakdown**")
    current_period_rows = st.session_state.get("bill_tariff_periods", [])
    if hasattr(current_period_rows, "to_dict"):
        current_period_rows = current_period_rows.to_dict("records")
    if not isinstance(current_period_rows, list):
        current_period_rows = []
    edited_period_rows = st.data_editor(
        current_period_rows,
        column_config={
            "label": st.column_config.TextColumn("Period"),
            "kwh": st.column_config.NumberColumn("kWh", format="%.2f"),
            "unit_price_per_kwh": st.column_config.NumberColumn("Unit price", format="%.4f"),
            "energy_charge": st.column_config.NumberColumn("Energy charge", format="%.2f"),
            "confidence": st.column_config.NumberColumn("Confidence", min_value=0.0, max_value=1.0, format="%.2f"),
        },
        key=f"bill_tariff_periods_editor_{st.session_state.get('bill_editor_version', 0)}",
        num_rows="dynamic",
        use_container_width=True,
        hide_index=True,
    )
    st.session_state["bill_tariff_periods"] = edited_period_rows

    st.markdown("**Charge breakdown**")
    charge_a, charge_b = st.columns(2)
    with charge_a:
        st.text_input("Active energy charge", key="bill_active_energy_charge", placeholder="Optional")
        st.text_input("Penalties", key="bill_penalties", placeholder="Optional")
    with charge_b:
        st.text_input("Taxes and fees", key="bill_taxes_and_fees", placeholder="Optional")
        st.text_input("Fixed or demand charges", key="bill_fixed_or_demand_charges", placeholder="Optional")
    st.text_area("Extraction notes", height=100, key="bill_notes")

with client_tab:
    st.subheader("Client Information Extraction")
    client_files = st.file_uploader(
        "Upload client materials",
        type=["pdf", "pptx", "png", "jpg", "jpeg"],
        accept_multiple_files=True,
        key="client_info_uploads",
        help="Upload client profiles, site visit reports, business descriptions, previous proposals, PDFs, PPTX files, or screenshots.",
    )
    client_extract_col, client_reset_col = st.columns([0.68, 0.32])
    client_extract_clicked = client_extract_col.button("Extract Client Info", use_container_width=True)
    if client_reset_col.button("Clear Client", use_container_width=True):
        reset_client_review()
        st.rerun()
    if client_extract_clicked:
        if not client_files:
            st.warning("Upload at least one client information file before extracting.")
        else:
            paths = save_uploads(client_files)
            draft = extract_client_info(paths, config)
            st.session_state["extracted_client_info"] = draft
            apply_client_draft_to_state(draft)
            st.success("Client information extracted. Review and edit before generating.")

    st.subheader("Client Information Review")
    st.text_input("Client name", key="client_name")
    c1, c2, c3 = st.columns(3)
    with c1:
        st.selectbox(
            "Industry",
            ["manufacturing", "cold_storage", "food_processing", "retail", "hospitality"],
            index=None,
            placeholder="Select industry",
            key="industry",
        )
    with c2:
        st.selectbox(
            "Country",
            ["Ghana", "Nigeria", "Senegal", "Cote d'Ivoire"],
            index=None,
            placeholder="Select country",
            key="country",
        )
    with c3:
        st.text_input("City", key="city")

    st.text_area("Business description", height=80, key="business_description")
    st.checkbox("Has diesel generators", key="has_diesel_generators")
    st.text_area("Client extraction notes", height=100, key="client_notes")

    st.subheader("Assumptions Review")
    a1, a2, a3 = st.columns(3)
    with a1:
        st.text_input("Grid connection kVA", key="grid_connection_kva", placeholder="Optional")
        st.text_input("Latitude", key="latitude", placeholder="Optional")
    with a2:
        st.text_input("Available roof area m2", key="available_roof_area_m2", placeholder="Optional")
        st.text_input("Longitude", key="longitude", placeholder="Optional")
    with a3:
        st.text_input("Daytime fraction override", key="daytime_fraction_override", placeholder="Optional")
        st.text_input("PPA tariff override", key="ppa_tariff_per_kwh_override", placeholder="Optional")
        st.text_input("Diesel price per liter override", key="diesel_price_per_liter_override", placeholder="Optional")

bill, bill_errors, bill_missing = bill_from_form()
client, client_errors, client_missing = client_from_form()
calc = calculate_proposal(bill, client, config) if bill and client else None

st.subheader("Calculation Preview")
if bill_errors or client_errors:
    st.error("\n".join(bill_errors + client_errors))

if calc is None:
    missing_items = bill_missing + client_missing
    if missing_items:
        st.info("Enter or extract the required fields to preview calculations: " + ", ".join(missing_items))
    else:
        st.info("Enter or extract bill and client data to preview calculations.")
else:
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Recommended system", format_kwp(calc.pv_recommendation.recommended_kwp))
    m2.metric("Binding constraint", calc.pv_recommendation.binding_constraint)
    m3.metric("Annual production", f"{format_number(calc.annual_solar_production_kwh)} kWh")
    m4.metric("PPA tariff", format_currency(calc.ppa_tariff_per_kwh, bill.currency, 3))

    s1, s2 = st.columns(2)
    with s1:
        st.markdown("**Scenario 1: Grid Replacement**")
        st.write(f"Monthly savings: {format_currency(calc.scenario_grid_replacement.monthly_savings_year_1, bill.currency)}")
        st.write(f"Annual savings: {format_currency(calc.scenario_grid_replacement.annual_savings_year_1, bill.currency)}")
        st.write(f"{config.analysis_horizon_years}-year savings: {format_currency(calc.scenario_grid_replacement.cumulative_savings, bill.currency)}")
    with s2:
        st.markdown("**Scenario 2: Grid + Diesel**")
        st.write(f"Monthly savings: {format_currency(calc.scenario_grid_diesel.monthly_savings_year_1, bill.currency)}")
        st.write(f"Annual savings: {format_currency(calc.scenario_grid_diesel.annual_savings_year_1, bill.currency)}")
        st.write(f"{config.analysis_horizon_years}-year savings: {format_currency(calc.scenario_grid_diesel.cumulative_savings, bill.currency)}")

    if calc.warnings:
        st.warning("\n".join(calc.warnings))

st.subheader("Proposal Generation")
if st.button("Generate Proposal", use_container_width=True, disabled=calc is None):
    response = generate_proposal_artifacts(bill, client, config)
    st.session_state["proposal_path"] = response.output_pptx_path
    st.session_state["proposal_warnings"] = response.warnings
    st.success("Editable PowerPoint proposal generated.")

if st.session_state.get("proposal_warnings"):
    st.info("\n".join(st.session_state["proposal_warnings"]))

proposal_path = st.session_state.get("proposal_path")
if proposal_path and Path(proposal_path).exists():
    with Path(proposal_path).open("rb") as handle:
        st.download_button(
            "Download PowerPoint",
            handle,
            file_name=Path(proposal_path).name,
            mime="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            use_container_width=True,
        )
