"use client";

import {
  AlertCircle,
  ArrowUp,
  Building2,
  Calculator,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  History,
  LayoutDashboard,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type TariffPeriod = {
  label: string;
  kwh: number | null;
  unit_price_per_kwh: number | null;
  energy_charge: number | null;
  confidence: number | null;
};

type BillData = {
  source_file: string | null;
  monthly_kwh: number;
  currency: string;
  total_cost: number;
  tariff_per_kwh: number;
  billing_period_start: string | null;
  billing_period_end: string | null;
  tariff_periods: TariffPeriod[];
  active_energy_charge: number | null;
  penalties: number | null;
  taxes_and_fees: number | null;
  fixed_or_demand_charges: number | null;
  tariff_basis: string;
  extraction_notes: string[];
  field_confidence: Record<string, number>;
};

type BillExtractionResult = {
  bills: BillData[];
  combined_bill: BillData;
  warnings: string[];
};

type ClientInfoDraft = {
  client_name: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  business_description: string | null;
  has_diesel_generators: boolean | null;
  grid_connection_kva: number | null;
  available_roof_area_m2: number | null;
  daytime_fraction_override: number | null;
  ppa_tariff_per_kwh_override: number | null;
  diesel_price_per_liter_override: number | null;
  extraction_notes: string[];
  field_confidence: Record<string, number>;
};

type ScenarioResult = {
  name: string;
  monthly_savings_year_1: number;
  annual_savings_year_1: number;
  cumulative_savings: number;
  year_1_solar_used_kwh: number;
  yearly_savings: number[];
  current_cost_per_kwh_year_1: number;
  ppa_tariff_per_kwh: number;
};

type CalcResult = {
  daytime_kwh_monthly: number;
  annual_daytime_consumption_kwh: number;
  annual_solar_production_kwh: number;
  ppa_tariff_per_kwh: number;
  pv_recommendation: {
    recommended_kwp: number;
    binding_constraint: string;
  };
  scenario_grid_replacement: ScenarioResult;
  scenario_grid_diesel: ScenarioResult;
  warnings: string[];
};

type BillForm = {
  monthly_kwh: string;
  currency: string;
  total_cost: string;
  tariff_per_kwh: string;
  billing_period_start: string;
  billing_period_end: string;
  active_energy_charge: string;
  penalties: string;
  taxes_and_fees: string;
  fixed_or_demand_charges: string;
  tariff_basis: string;
  tariff_periods: TariffPeriodForm[];
  extraction_notes: string[];
  field_confidence: Record<string, number>;
};

type TariffPeriodForm = {
  label: string;
  kwh: string;
  unit_price_per_kwh: string;
  energy_charge: string;
  confidence: string;
};

type ClientForm = {
  client_name: string;
  industry: string;
  country: string;
  city: string;
  latitude: string;
  longitude: string;
  business_description: string;
  has_diesel_generators: "" | "yes" | "no";
  grid_connection_kva: string;
  available_roof_area_m2: string;
  daytime_fraction_override: string;
  ppa_tariff_per_kwh_override: string;
  diesel_price_per_liter_override: string;
  extraction_notes: string[];
  field_confidence: Record<string, number>;
};

type Status = {
  tone: "ok" | "warn" | "error";
  text: string;
};

type ExtractionState = {
  phase: "idle" | "extracting" | "done" | "error";
  text: string;
};

type ApiResult<T> = {
  data: T;
  runId: string | null;
};

type ActiveView = "workspace" | "history";

type HistoryClient = {
  client_name?: string | null;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
};

type HistoryDocument = {
  id: string;
  kind: string;
  file_name: string;
  extraction_json?: unknown;
  created_at?: string | null;
};

type HistoryProposalOutput = {
  id: string;
  file_name: string;
  created_at?: string | null;
};

type HistoryNoteGroup = {
  title: string;
  meta: string;
  items: string[];
  tone?: "warning";
};

type HistoryRun = {
  id: string;
  status?: string | null;
  created_at?: string | null;
  client_json?: Partial<ClientInfoDraft> | null;
  bill_json?: Partial<BillExtractionResult> | Partial<BillData> | null;
  calc_json?: Partial<CalcResult> | null;
  warnings?: string[] | null;
  clients?: HistoryClient | null;
  documents?: HistoryDocument[] | null;
  proposal_outputs?: HistoryProposalOutput[] | null;
};

const emptyBillForm: BillForm = {
  monthly_kwh: "",
  currency: "",
  total_cost: "",
  tariff_per_kwh: "",
  billing_period_start: "",
  billing_period_end: "",
  active_energy_charge: "",
  penalties: "",
  taxes_and_fees: "",
  fixed_or_demand_charges: "",
  tariff_basis: "",
  tariff_periods: [],
  extraction_notes: [],
  field_confidence: {},
};

const emptyClientForm: ClientForm = {
  client_name: "",
  industry: "",
  country: "",
  city: "",
  latitude: "",
  longitude: "",
  business_description: "",
  has_diesel_generators: "",
  grid_connection_kva: "",
  available_roof_area_m2: "",
  daytime_fraction_override: "",
  ppa_tariff_per_kwh_override: "",
  diesel_price_per_liter_override: "",
  extraction_notes: [],
  field_confidence: {},
};

const idleExtraction: ExtractionState = {
  phase: "idle",
  text: "Waiting for files",
};

const industries = [
  { value: "manufacturing", label: "Manufacturing" },
  { value: "cold_storage", label: "Cold storage" },
  { value: "food_processing", label: "Food processing" },
  { value: "retail", label: "Retail" },
  { value: "hospitality", label: "Hospitality" },
];

const countries = ["Ghana", "Nigeria", "Senegal", "Cote d'Ivoire"];

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const moneyFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const tariffFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`;
}

function asText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function parseNumber(value: string): number | null {
  const cleaned = value.trim().replace(",", ".");
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFallbackBill(bill: BillData): boolean {
  return bill.tariff_basis.toLowerCase().includes("fallback");
}

function billToForm(bill: BillData): BillForm {
  const fallback = isFallbackBill(bill);
  return {
    monthly_kwh: fallback ? "" : asText(bill.monthly_kwh),
    currency: fallback ? "" : asText(bill.currency),
    total_cost: fallback ? "" : asText(bill.total_cost),
    tariff_per_kwh: fallback ? "" : asText(bill.tariff_per_kwh),
    billing_period_start: asText(bill.billing_period_start),
    billing_period_end: asText(bill.billing_period_end),
    active_energy_charge: fallback ? "" : asText(bill.active_energy_charge),
    penalties: fallback ? "" : asText(bill.penalties),
    taxes_and_fees: fallback ? "" : asText(bill.taxes_and_fees),
    fixed_or_demand_charges: fallback ? "" : asText(bill.fixed_or_demand_charges),
    tariff_basis: fallback ? "" : asText(bill.tariff_basis),
    tariff_periods: fallback
      ? []
      : bill.tariff_periods.map((period) => ({
          label: asText(period.label),
          kwh: asText(period.kwh),
          unit_price_per_kwh: asText(period.unit_price_per_kwh),
          energy_charge: asText(period.energy_charge),
          confidence: asText(period.confidence),
        })),
    extraction_notes: bill.extraction_notes,
    field_confidence: bill.field_confidence,
  };
}

function clientToForm(client: ClientInfoDraft): ClientForm {
  return {
    client_name: asText(client.client_name),
    industry: asText(client.industry),
    country: asText(client.country),
    city: asText(client.city),
    latitude: asText(client.latitude),
    longitude: asText(client.longitude),
    business_description: asText(client.business_description),
    has_diesel_generators:
      client.has_diesel_generators === null ? "" : client.has_diesel_generators ? "yes" : "no",
    grid_connection_kva: asText(client.grid_connection_kva),
    available_roof_area_m2: asText(client.available_roof_area_m2),
    daytime_fraction_override: asText(client.daytime_fraction_override),
    ppa_tariff_per_kwh_override: asText(client.ppa_tariff_per_kwh_override),
    diesel_price_per_liter_override: asText(client.diesel_price_per_liter_override),
    extraction_notes: client.extraction_notes,
    field_confidence: client.field_confidence,
  };
}

function optionalNumber(value: string): number | null {
  return parseNumber(value);
}

function requiredNumber(value: string, label: string): number {
  const parsed = parseNumber(value);
  if (parsed === null) {
    throw new Error(`${label} is required.`);
  }
  return parsed;
}

function apiHeaders(runId: string | null, contentType = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) {
    headers["Content-Type"] = "application/json";
  }
  if (runId) {
    headers["X-Proposal-Run-Id"] = runId;
  }
  return headers;
}

async function reserveProposalRun(signal: AbortSignal): Promise<string | null> {
  const response = await fetch(apiUrl("/proposal-runs"), {
    method: "POST",
    signal,
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const body = (await response.json()) as { run_id?: string | null };
  return body.run_id || response.headers.get("x-proposal-run-id");
}

async function uploadFiles<T>(
  path: string,
  files: File[],
  runId: string | null,
  signal: AbortSignal,
): Promise<ApiResult<T>> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: apiHeaders(runId),
    body: formData,
    signal,
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return {
    data: (await response.json()) as T,
    runId: response.headers.get("x-proposal-run-id"),
  };
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail || response.statusText;
  } catch {
    return response.statusText;
  }
}

function fileLabel(files: File[]): string {
  if (files.length === 0) {
    return "No files selected";
  }
  if (files.length === 1) {
    return files[0].name;
  }
  return `${files.length} files selected`;
}

function filenameFromDisposition(disposition: string | null): string {
  if (!disposition) {
    return "aspan-proposal.pptx";
  }
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || "aspan-proposal.pptx";
}

function formatRunDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function historyClientName(run: HistoryRun): string {
  return run.clients?.client_name || run.client_json?.client_name || "Untitled client";
}

function historyCountry(run: HistoryRun): string {
  return run.clients?.country || run.client_json?.country || "-";
}

function historyBillSnapshot(run: HistoryRun): { combined: Partial<BillData> | null; bills: Partial<BillData>[] } {
  const raw = run.bill_json;
  if (!raw || typeof raw !== "object") {
    return { combined: null, bills: [] };
  }

  if ("combined_bill" in raw) {
    const extraction = raw as Partial<BillExtractionResult>;
    const bills = Array.isArray(extraction.bills) ? extraction.bills : [];
    return {
      combined: extraction.combined_bill || bills[0] || null,
      bills,
    };
  }

  if ("monthly_kwh" in raw) {
    const bill = raw as Partial<BillData>;
    return { combined: bill, bills: [bill] };
  }

  return { combined: null, bills: [] };
}

function historyClientSnapshot(run: HistoryRun): ClientInfoDraft {
  return {
    client_name: run.client_json?.client_name || run.clients?.client_name || null,
    industry: run.client_json?.industry || run.clients?.industry || null,
    country: run.client_json?.country || run.clients?.country || null,
    city: run.client_json?.city || run.clients?.city || null,
    business_description: run.client_json?.business_description || null,
    has_diesel_generators: run.client_json?.has_diesel_generators ?? null,
    grid_connection_kva: run.client_json?.grid_connection_kva ?? null,
    available_roof_area_m2: run.client_json?.available_roof_area_m2 ?? null,
    latitude: run.client_json?.latitude ?? null,
    longitude: run.client_json?.longitude ?? null,
    daytime_fraction_override: run.client_json?.daytime_fraction_override ?? null,
    ppa_tariff_per_kwh_override: run.client_json?.ppa_tariff_per_kwh_override ?? null,
    diesel_price_per_liter_override: run.client_json?.diesel_price_per_liter_override ?? null,
    extraction_notes: run.client_json?.extraction_notes || [],
    field_confidence: run.client_json?.field_confidence || {},
  };
}

function historyBillToForm(bill: Partial<BillData> | null): BillForm {
  if (!bill) {
    return emptyBillForm;
  }
  const fallback = bill.tariff_basis ? String(bill.tariff_basis).toLowerCase().includes("fallback") : false;
  return {
    monthly_kwh: fallback ? "" : asText(bill.monthly_kwh),
    currency: fallback ? "" : asText(bill.currency),
    total_cost: fallback ? "" : asText(bill.total_cost),
    tariff_per_kwh: fallback ? "" : asText(bill.tariff_per_kwh),
    billing_period_start: asText(bill.billing_period_start),
    billing_period_end: asText(bill.billing_period_end),
    active_energy_charge: fallback ? "" : asText(bill.active_energy_charge),
    penalties: fallback ? "" : asText(bill.penalties),
    taxes_and_fees: fallback ? "" : asText(bill.taxes_and_fees),
    fixed_or_demand_charges: fallback ? "" : asText(bill.fixed_or_demand_charges),
    tariff_basis: fallback ? "" : asText(bill.tariff_basis),
    tariff_periods: fallback
      ? []
      : (bill.tariff_periods || []).map((period) => ({
          label: asText(period.label),
          kwh: asText(period.kwh),
          unit_price_per_kwh: asText(period.unit_price_per_kwh),
          energy_charge: asText(period.energy_charge),
          confidence: asText(period.confidence),
        })),
    extraction_notes: bill.extraction_notes || [],
    field_confidence: bill.field_confidence || {},
  };
}

function isCompleteBillData(bill: Partial<BillData>): bill is BillData {
  return (
    typeof bill.monthly_kwh === "number" &&
    typeof bill.total_cost === "number" &&
    typeof bill.tariff_per_kwh === "number" &&
    typeof bill.currency === "string" &&
    typeof bill.tariff_basis === "string"
  );
}

function isCompleteCalcResult(calc: Partial<CalcResult> | null | undefined): calc is CalcResult {
  return Boolean(
    calc &&
      calc.pv_recommendation &&
      calc.scenario_grid_replacement &&
      calc.scenario_grid_diesel &&
      typeof calc.annual_solar_production_kwh === "number",
  );
}

function formatNumberValue(value: number | null | undefined, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? `${numberFormat.format(value)}${suffix}` : "-";
}

function formatMoneyValue(currency: string | null | undefined, value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${currency || ""} ${moneyFormat.format(value)}`.trim()
    : "-";
}

function formatTariffValue(currency: string | null | undefined, value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${currency || ""} ${tariffFormat.format(value)}/kWh`.trim()
    : "-";
}

function formatBooleanValue(value: boolean | null | undefined): string {
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  return "-";
}

function formatTextValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value).replaceAll("_", " ");
}

function historyDownloadUrl(runId: string, group: "documents" | "proposal-outputs", fileId: string): string {
  return apiUrl(`/proposal-runs/${runId}/${group}/${fileId}/download`);
}

function fileKindLabel(kind: string): string {
  return kind.replaceAll("_", " ");
}

function readableFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    active_energy_charge: "Active energy charge",
    available_roof_area_m2: "Available roof area",
    business_description: "Business description",
    client_name: "Client name",
    diesel_price_per_liter_override: "Diesel price override",
    fixed_or_demand_charges: "Fixed or demand charges",
    grid_connection_kva: "Grid connection kVA",
    has_diesel_generators: "Diesel generators",
    monthly_kwh: "Monthly kWh",
    ppa_tariff_per_kwh_override: "PPA tariff override",
    tariff_per_kwh: "Tariff per kWh",
    tariff_periods: "Time-of-use rows",
    taxes_and_fees: "Taxes and fees",
    total_cost: "Total cost",
  };
  return labels[field] || field.replaceAll("_", " ");
}

function confidenceEntries(fieldConfidence: Record<string, number>): { label: string; percent: number }[] {
  return Object.entries(fieldConfidence)
    .filter(([, value]) => Number.isFinite(value))
    .map(([field, value]) => ({
      label: readableFieldLabel(field),
      percent: Math.round(value * 100),
    }))
    .sort((left, right) => left.percent - right.percent);
}

function readableHistoryNote(note: string): string {
  return note
    .replace(/\bmonthly_kwh\b/gi, "monthly kWh")
    .replace(/\btotal_cost\b/gi, "total cost")
    .replace(/\btariff_per_kwh\b/gi, "tariff per kWh")
    .replace(/\bactive_energy_charge\b/gi, "active energy charge")
    .replace(/\btaxes_and_fees\b/gi, "taxes and fees")
    .replace(/\bfixed_or_demand_charges\b/gi, "fixed or demand charges")
    .replace(/\bhas_diesel_generators\b/gi, "diesel generator status")
    .replace(/\bgrid_connection_kva\b/gi, "grid connection kVA")
    .replace(/\bavailable_roof_area_m2\b/gi, "available roof area m2")
    .replace(/\bppa_tariff_per_kwh_override\b/gi, "PPA tariff override")
    .replace(/\bdiesel_price_per_liter_override\b/gi, "diesel price override")
    .replace(/\bdaytime_fraction_override\b/gi, "daytime fraction override")
    .replace(/\bkwp\b/gi, "kWp")
    .replace(/\bkwh\b/gi, "kWh")
    .replace(/\bkva\b/gi, "kVA")
    .replace(/\bxof\b/gi, "XOF")
    .replace(/\bfcfa\b/gi, "FCFA")
    .replace(/\btva\b/gi, "TVA")
    .replace(/\bhta\b/gi, "HTA")
    .replace(/\bttc\b/gi, "TTC")
    .replace(/\bht\b/g, "HT")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueNotes(notes: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  notes.forEach((note) => {
    const readable = readableHistoryNote(note);
    const key = readable.toLowerCase().replace(/[^\w]+/g, " ").trim();
    if (!readable || seen.has(key)) {
      return;
    }
    seen.add(key);
    cleaned.push(readable);
  });
  return cleaned;
}

function billCoverageLabel(bills: Partial<BillData>[]): string {
  const starts = bills.map((bill) => bill.billing_period_start).filter(Boolean).sort();
  const ends = bills.map((bill) => bill.billing_period_end).filter(Boolean).sort();
  if (starts.length === 0 && ends.length === 0) {
    return "";
  }
  return `${starts[0] || "-"} to ${ends[ends.length - 1] || "-"}`;
}

function hasNote(notes: string[], pattern: RegExp): boolean {
  return notes.some((note) => pattern.test(note));
}

function buildHistoryNoteGroups(
  run: HistoryRun,
  billSnapshot: { combined: Partial<BillData> | null; bills: Partial<BillData>[] },
  client: Partial<ClientInfoDraft>,
): HistoryNoteGroup[] {
  const bill = billSnapshot.combined;
  const billNotes = bill?.extraction_notes || [];
  const clientNotes = client.extraction_notes || [];
  const warningNotes = run.warnings || [];
  const groups: HistoryNoteGroup[] = [];
  const billCount = billSnapshot.bills.length || (bill ? 1 : 0);

  const billItems: string[] = [];
  if (hasNote(billNotes, /periode de consommation|billing period|payment due date/i)) {
    const coverage = billCoverageLabel(billSnapshot.bills);
    billItems.push(
      `${billCount || "Uploaded"} bill${billCount === 1 ? "" : "s"} reviewed${
        coverage ? `, covering ${coverage}` : ""
      }. Consumption periods are used for billing dates; payment due dates are ignored.`,
    );
  }
  if (hasNote(billNotes, /reactif|ima|horaire|excluded/i)) {
    billItems.push("Reactive energy, Ima, and meter-index rows are excluded from active kWh.");
  }
  if (hasNote(billNotes, /weighted average|tariff per kwh|tariff_per_kwh|prix unitaire|unit prices/i)) {
    billItems.push(
      `Tariff values are derived from active energy rows or invoice active-energy totals. Reviewed tariff basis: ${formatTextValue(
        bill?.tariff_basis,
      )}.`,
    );
  }
  if (hasNote(billNotes, /penalite|penalt|tva|taxes|fixed|demand|prime fixe|location comptage|redevance/i)) {
    billItems.push(
      "Active energy, penalties, taxes, and fixed or demand charges are tracked separately when visible on the bill.",
    );
  }
  if (billItems.length > 0) {
    groups.push({
      title: "Bill interpretation",
      meta: `${billCount || 0} bill${billCount === 1 ? "" : "s"}`,
      items: uniqueNotes(billItems),
    });
  }

  const reviewFlags = uniqueNotes(
    billNotes.filter((note) => /partially|obscured|unreadable|ambiguity|possible|differ|unpaid|seasonality/i.test(note)),
  );
  if (reviewFlags.length > 0) {
    groups.push({
      title: "Review flags",
      meta: `${reviewFlags.length} item${reviewFlags.length === 1 ? "" : "s"}`,
      tone: "warning",
      items: reviewFlags.slice(0, 6),
    });
  }

  const clientItems = uniqueNotes(clientNotes);
  if (clientItems.length > 0) {
    groups.push({
      title: "Client extraction",
      meta: `${clientItems.length} item${clientItems.length === 1 ? "" : "s"}`,
      items:
        clientItems.length > 10
          ? [...clientItems.slice(0, 10), `${clientItems.length - 10} additional client extraction details are in the document snapshots.`]
          : clientItems,
    });
  }

  const warnings = uniqueNotes(warningNotes);
  if (warnings.length > 0) {
    groups.push({
      title: "Warnings",
      meta: `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`,
      tone: "warning",
      items: warnings,
    });
  }

  if (groups.length === 0) {
    const fallback = uniqueNotes([...billNotes, ...clientNotes, ...warningNotes]);
    if (fallback.length > 0) {
      groups.push({
        title: "Extraction notes",
        meta: `${fallback.length} item${fallback.length === 1 ? "" : "s"}`,
        items: fallback.slice(0, 12),
      });
    }
  }

  return groups;
}

export default function ProposalWorkspace() {
  const [billFiles, setBillFiles] = useState<File[]>([]);
  const [clientFiles, setClientFiles] = useState<File[]>([]);
  const [billForm, setBillForm] = useState<BillForm>(emptyBillForm);
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm);
  const [monthlyBills, setMonthlyBills] = useState<BillData[]>([]);
  const [preview, setPreview] = useState<CalcResult | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"preview" | "proposal" | null>(null);
  const [billExtraction, setBillExtraction] = useState<ExtractionState>(idleExtraction);
  const [clientExtraction, setClientExtraction] = useState<ExtractionState>(idleExtraction);
  const [proposalRunId, setProposalRunId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("workspace");
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const runPromiseRef = useRef<Promise<string | null> | null>(null);
  const runReservationAbortRef = useRef<AbortController | null>(null);
  const billRequestRef = useRef<AbortController | null>(null);
  const clientRequestRef = useRef<AbortController | null>(null);
  const billRequestSequence = useRef(0);
  const clientRequestSequence = useRef(0);

  const canPreview = useMemo(() => {
    return (
      parseNumber(billForm.monthly_kwh) !== null &&
      parseNumber(billForm.total_cost) !== null &&
      parseNumber(billForm.tariff_per_kwh) !== null &&
      billForm.currency.trim().length > 0 &&
      clientForm.client_name.trim().length > 0 &&
      clientForm.industry.trim().length > 0 &&
      clientForm.country.trim().length > 0 &&
      clientForm.has_diesel_generators !== ""
    );
  }, [billForm, clientForm]);

  const warnings = [
    ...billForm.extraction_notes.filter((note) => note.toLowerCase().includes("fallback")),
    ...clientForm.extraction_notes.filter((note) => note.toLowerCase().includes("fallback")),
    ...(preview?.warnings || []),
  ];

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const response = await fetch(apiUrl("/proposal-runs?limit=25"));
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const body = (await response.json()) as { runs?: HistoryRun[] };
      setHistoryRuns(body.runs || []);
    } catch (error) {
      setStatus({ tone: "warn", text: error instanceof Error ? error.message : "Proposal history unavailable." });
      setHistoryRuns([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (activeView === "history") {
      void loadHistory();
    }
  }, [activeView]);

  useEffect(() => {
    function onScroll() {
      setShowScrollTop(window.scrollY > 520);
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    return () => {
      runReservationAbortRef.current?.abort();
      billRequestRef.current?.abort();
      clientRequestRef.current?.abort();
    };
  }, []);

  function rememberRunId(runId: string | null) {
    if (!runId) {
      return;
    }
    runIdRef.current = runId;
    setProposalRunId(runId);
  }

  async function ensureProposalRun(): Promise<string | null> {
    if (runIdRef.current) {
      return runIdRef.current;
    }
    if (!runPromiseRef.current) {
      const controller = new AbortController();
      runReservationAbortRef.current = controller;
      runPromiseRef.current = reserveProposalRun(controller.signal);
    }

    const pending = runPromiseRef.current;
    try {
      const runId = await pending;
      rememberRunId(runId);
      return runId;
    } finally {
      if (runPromiseRef.current === pending) {
        runPromiseRef.current = null;
        runReservationAbortRef.current = null;
      }
    }
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetWorkspace() {
    runReservationAbortRef.current?.abort();
    billRequestRef.current?.abort();
    clientRequestRef.current?.abort();
    billRequestSequence.current += 1;
    clientRequestSequence.current += 1;
    runIdRef.current = null;
    runPromiseRef.current = null;
    setBillFiles([]);
    setClientFiles([]);
    setBillForm(emptyBillForm);
    setClientForm(emptyClientForm);
    setMonthlyBills([]);
    setPreview(null);
    setStatus(null);
    setBusy(null);
    setBillExtraction(idleExtraction);
    setClientExtraction(idleExtraction);
    setProposalRunId(null);
    setResetKey((value) => value + 1);
  }

  function loadHistoryRun(run: HistoryRun) {
    runReservationAbortRef.current?.abort();
    billRequestRef.current?.abort();
    clientRequestRef.current?.abort();
    billRequestSequence.current += 1;
    clientRequestSequence.current += 1;
    runPromiseRef.current = null;
    runIdRef.current = run.id;
    const billSnapshot = historyBillSnapshot(run);
    const client = historyClientSnapshot(run);
    const bills = billSnapshot.bills.filter(isCompleteBillData);

    setBillFiles([]);
    setClientFiles([]);
    setBillForm(historyBillToForm(billSnapshot.combined));
    setClientForm(clientToForm(client));
    setMonthlyBills(bills);
    setPreview(isCompleteCalcResult(run.calc_json) ? run.calc_json : null);
    setProposalRunId(run.id);
    setBusy(null);
    setBillExtraction({ phase: bills.length ? "done" : "idle", text: bills.length ? `${bills.length} bills loaded` : "Waiting for files" });
    setClientExtraction({
      phase: client.client_name ? "done" : "idle",
      text: client.client_name ? "Client details loaded" : "Waiting for files",
    });
    setResetKey((value) => value + 1);
    setActiveView("workspace");
    setStatus({
      tone: "ok",
      text: `Loaded ${historyClientName(run)} from history. Review the fields before regenerating.`,
    });
  }

  function onBillFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    setBillFiles(files);
    setBillForm(emptyBillForm);
    setMonthlyBills([]);
    setPreview(null);
    if (files.length === 0) {
      setBillExtraction(idleExtraction);
      return;
    }
    void extractBills(files);
  }

  function onClientFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    setClientFiles(files);
    setClientForm(emptyClientForm);
    setPreview(null);
    if (files.length === 0) {
      setClientExtraction(idleExtraction);
      return;
    }
    void extractClient(files);
  }

  async function extractBills(files: File[]) {
    billRequestRef.current?.abort();
    const controller = new AbortController();
    const sequence = billRequestSequence.current + 1;
    billRequestSequence.current = sequence;
    billRequestRef.current = controller;
    setBillExtraction({
      phase: "extracting",
      text: `Extracting ${files.length} bill${files.length === 1 ? "" : "s"}`,
    });
    setStatus(null);
    try {
      const runId = await ensureProposalRun();
      if (sequence !== billRequestSequence.current) {
        return;
      }
      const result = await uploadFiles<BillExtractionResult>("/extract-bill-collection", files, runId, controller.signal);
      if (sequence !== billRequestSequence.current) {
        return;
      }
      rememberRunId(result.runId);
      setBillForm(billToForm(result.data.combined_bill));
      setMonthlyBills(result.data.bills);
      setPreview(null);
      setBillExtraction({
        phase: "done",
        text: `${result.data.bills.length} bill${result.data.bills.length === 1 ? "" : "s"} extracted`,
      });
      if (result.data.warnings.length) {
        setStatus({ tone: "warn", text: result.data.warnings[0] });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const message = error instanceof Error ? error.message : "Bill extraction failed.";
      setBillExtraction({ phase: "error", text: message });
      setStatus({ tone: "error", text: message });
    } finally {
      if (billRequestRef.current === controller) {
        billRequestRef.current = null;
      }
    }
  }

  async function extractClient(files: File[]) {
    clientRequestRef.current?.abort();
    const controller = new AbortController();
    const sequence = clientRequestSequence.current + 1;
    clientRequestSequence.current = sequence;
    clientRequestRef.current = controller;
    setClientExtraction({
      phase: "extracting",
      text: `Extracting ${files.length} client file${files.length === 1 ? "" : "s"}`,
    });
    setStatus(null);
    try {
      const runId = await ensureProposalRun();
      if (sequence !== clientRequestSequence.current) {
        return;
      }
      const result = await uploadFiles<ClientInfoDraft>("/extract-client-info", files, runId, controller.signal);
      if (sequence !== clientRequestSequence.current) {
        return;
      }
      rememberRunId(result.runId);
      setClientForm(clientToForm(result.data));
      setPreview(null);
      setClientExtraction({ phase: "done", text: "Client details extracted" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const message = error instanceof Error ? error.message : "Client extraction failed.";
      setClientExtraction({ phase: "error", text: message });
      setStatus({ tone: "error", text: message });
    } finally {
      if (clientRequestRef.current === controller) {
        clientRequestRef.current = null;
      }
    }
  }

  function buildPayload() {
    return {
      bill: {
        source_file: null,
        monthly_kwh: requiredNumber(billForm.monthly_kwh, "Monthly kWh"),
        currency: billForm.currency.trim(),
        total_cost: requiredNumber(billForm.total_cost, "Total cost"),
        tariff_per_kwh: requiredNumber(billForm.tariff_per_kwh, "Tariff per kWh"),
        billing_period_start: billForm.billing_period_start || null,
        billing_period_end: billForm.billing_period_end || null,
        tariff_periods: billForm.tariff_periods
          .filter((period) => period.label.trim())
          .map((period) => ({
            label: period.label.trim(),
            kwh: optionalNumber(period.kwh),
            unit_price_per_kwh: optionalNumber(period.unit_price_per_kwh),
            energy_charge: optionalNumber(period.energy_charge),
            confidence: optionalNumber(period.confidence),
          })),
        active_energy_charge: optionalNumber(billForm.active_energy_charge),
        penalties: optionalNumber(billForm.penalties),
        taxes_and_fees: optionalNumber(billForm.taxes_and_fees),
        fixed_or_demand_charges: optionalNumber(billForm.fixed_or_demand_charges),
        tariff_basis: billForm.tariff_basis || "reviewed_manual_input",
        extraction_notes: billForm.extraction_notes,
        field_confidence: billForm.field_confidence,
      },
      client: {
        client_name: clientForm.client_name.trim(),
        industry: clientForm.industry,
        country: clientForm.country,
        city: clientForm.city.trim() || null,
        latitude: optionalNumber(clientForm.latitude),
        longitude: optionalNumber(clientForm.longitude),
        business_description: clientForm.business_description.trim() || null,
        has_diesel_generators: clientForm.has_diesel_generators === "yes",
        grid_connection_kva: optionalNumber(clientForm.grid_connection_kva),
        available_roof_area_m2: optionalNumber(clientForm.available_roof_area_m2),
        daytime_fraction_override: optionalNumber(clientForm.daytime_fraction_override),
        ppa_tariff_per_kwh_override: optionalNumber(clientForm.ppa_tariff_per_kwh_override),
        diesel_price_per_liter_override: optionalNumber(clientForm.diesel_price_per_liter_override),
      },
    };
  }

  async function previewEconomics() {
    if (!canPreview) {
      setStatus({ tone: "warn", text: "Review the required bill and client fields first." });
      return;
    }
    setBusy("preview");
    setStatus(null);
    try {
      const response = await fetch(apiUrl("/calculate-preview"), {
        method: "POST",
        headers: apiHeaders(proposalRunId, true),
        body: JSON.stringify(buildPayload()),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const nextRunId = response.headers.get("x-proposal-run-id");
      rememberRunId(nextRunId);
      setPreview((await response.json()) as CalcResult);
      setStatus({ tone: "ok", text: "Economics preview ready." });
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : "Calculation failed." });
    } finally {
      setBusy(null);
    }
  }

  async function generateProposal() {
    if (!canPreview) {
      setStatus({ tone: "warn", text: "Review the required bill and client fields first." });
      return;
    }
    setBusy("proposal");
    setStatus(null);
    try {
      const response = await fetch(apiUrl("/generate-proposal"), {
        method: "POST",
        headers: apiHeaders(proposalRunId, true),
        body: JSON.stringify(buildPayload()),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const nextRunId = response.headers.get("x-proposal-run-id");
      rememberRunId(nextRunId);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromDisposition(response.headers.get("content-disposition"));
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus({ tone: "ok", text: "PowerPoint generated." });
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : "Proposal generation failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="appShell">
      <aside className="sideRail" aria-label="Application">
        <nav className="railTabs" aria-label="Primary views">
          <button
            className={activeView === "workspace" ? "railTab active" : "railTab"}
            type="button"
            onClick={() => setActiveView("workspace")}
            title="Workspace"
          >
            <LayoutDashboard aria-hidden="true" />
            Workspace
          </button>
          <button
            className={activeView === "history" ? "railTab active" : "railTab"}
            type="button"
            onClick={() => setActiveView("history")}
            title="Dashboard and history"
          >
            <History aria-hidden="true" />
            Dashboard & History
          </button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topBar">
          <div>
            <p className="eyebrow">{activeView === "workspace" ? "" : "Proposal intelligence"}</p>
            <h2>{activeView === "workspace" ? "Extract, review, calculate, generate." : "Dashboard & History"}</h2>
          </div>
          <div className="topActions">
            {activeView === "workspace" ? (
              <div className="actionCluster">
                <button className="ghostButton" type="button" onClick={resetWorkspace} title="Reset workspace">
                  <RotateCcw aria-hidden="true" />
                  Reset
                </button>
                <button
                  className="primaryButton"
                  type="button"
                  onClick={generateProposal}
                  disabled={!canPreview || busy === "proposal"}
                  title="Generate PowerPoint"
                >
                  {busy === "proposal" ? <Loader2 className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                  Generate PPTX
                </button>
              </div>
            ) : (
              <button className="secondaryButton" type="button" onClick={loadHistory} disabled={historyLoading} title="Refresh history">
                {historyLoading ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                Refresh
              </button>
            )}
          </div>
        </header>

        {status ? (
          <div className={`statusLine ${status.tone}`} role="status">
            {status.tone === "ok" ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
            <span>{status.text}</span>
          </div>
        ) : null}

        {activeView === "workspace" ? (
          <>
            <section className="uploadGrid" aria-label="Document extraction">
              <UploadPanel
                icon={<FileText aria-hidden="true" />}
                title="Utility bills"
                fileLabel={fileLabel(billFiles)}
                inputKey={`bill-${resetKey}`}
                accept=".pdf,image/*"
                multiple
                onFiles={onBillFiles}
                extraction={billExtraction}
              />
              <UploadPanel
                icon={<Building2 aria-hidden="true" />}
                title="Client information"
                fileLabel={fileLabel(clientFiles)}
                inputKey={`client-${resetKey}`}
                accept=".pdf,.pptx,image/*"
                multiple
                onFiles={onClientFiles}
                extraction={clientExtraction}
              />
            </section>

            {monthlyBills.length > 0 ? <BillSummary bills={monthlyBills} /> : null}

            <section className="reviewGrid" aria-label="Review fields">
              <BillReview billForm={billForm} setBillForm={setBillForm} />
              <ClientReview clientForm={clientForm} setClientForm={setClientForm} />
            </section>

            <section className="commandStrip" aria-label="Calculation controls">
              <button
                className="secondaryButton"
                type="button"
                onClick={previewEconomics}
                disabled={!canPreview || busy === "preview"}
                title="Preview economics"
              >
                {busy === "preview" ? <Loader2 className="spin" aria-hidden="true" /> : <Calculator aria-hidden="true" />}
                Preview economics
              </button>
              <span className="requirementState">{canPreview ? "Ready for calculation" : "Required fields are still open"}</span>
            </section>

            {preview ? <EconomicsPreview preview={preview} billCurrency={billForm.currency} /> : null}

            {warnings.length > 0 ? (
              <section className="warningPanel" aria-label="Warnings">
                {warnings.map((warning) => (
                  <div key={warning}>
                    <AlertCircle aria-hidden="true" />
                    <span>{warning}</span>
                  </div>
                ))}
              </section>
            ) : null}
          </>
        ) : (
          <DashboardHistory
            runs={historyRuns}
            loading={historyLoading}
            currentRunId={proposalRunId}
            monthlyBills={monthlyBills}
            preview={preview}
            canPreview={canPreview}
            onLoadRun={loadHistoryRun}
          />
        )}
      </section>
      <button
        className={showScrollTop ? "scrollTopButton visible" : "scrollTopButton"}
        type="button"
        onClick={scrollToTop}
        aria-label="Back to top"
        aria-hidden={!showScrollTop}
        tabIndex={showScrollTop ? 0 : -1}
        title="Back to top"
      >
        <ArrowUp aria-hidden="true" />
      </button>
    </main>
  );
}

function DashboardHistory({
  runs,
  loading,
  currentRunId,
  monthlyBills,
  preview,
  canPreview,
  onLoadRun,
}: {
  runs: HistoryRun[];
  loading: boolean;
  currentRunId: string | null;
  monthlyBills: BillData[];
  preview: CalcResult | null;
  canPreview: boolean;
  onLoadRun: (run: HistoryRun) => void;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRun = runs.find((run) => run.id === selectedRunId) || runs[0] || null;
  const totalOutputs = runs.reduce((total, run) => total + (run.proposal_outputs?.length || 0), 0);
  const totalDocuments = runs.reduce((total, run) => total + (run.documents?.length || 0), 0);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }
    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  return (
    <section className="historyStack" aria-label="Dashboard and proposal history">
      <section className="metricsBand dashboardMetrics" aria-label="Workspace summary">
        <Metric label="Current run" value={currentRunId ? "Synced" : "Draft"} />
        <Metric label="Bills extracted" value={String(monthlyBills.length)} />
        <Metric label="Review state" value={canPreview ? "Ready" : "Open"} />
        <Metric
          label="Recommended PV"
          value={preview ? `${moneyFormat.format(preview.pv_recommendation.recommended_kwp)} kWp` : "-"}
        />
        <Metric label="Generated PPTX" value={String(totalOutputs)} />
        <Metric label="Stored docs" value={String(totalDocuments)} />
      </section>

      <section className="historyPanel" aria-label="Proposal runs">
        <div className="sectionHeader">
          <h3>Proposal runs</h3>
          <span>{loading ? "Syncing" : `${runs.length} saved`}</span>
        </div>
        {runs.length === 0 ? (
          <div className="historyEmpty">
            <History aria-hidden="true" />
            <strong>No saved proposal runs.</strong>
          </div>
        ) : (
          <div className="historyLayout">
            <div className="historyList" role="list" aria-label="Saved proposal runs">
              {runs.map((run) => {
                const billSnapshot = historyBillSnapshot(run);
                const selected = selectedRun?.id === run.id;
                return (
                  <button
                    className={selected ? "historyRunButton active" : "historyRunButton"}
                    type="button"
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    aria-pressed={selected}
                  >
                    <span className="historyRunMain">
                      <strong>{historyClientName(run)}</strong>
                      <small>
                        {historyCountry(run)} · {formatRunDate(run.created_at)}
                      </small>
                    </span>
                    <span className={run.status === "generated" ? "statusPill generated" : "statusPill"}>
                      {run.status || "draft"}
                    </span>
                    <span className="historyRunMeta">
                      <code>{run.id.slice(0, 8)}</code>
                      <small>
                        {(run.proposal_outputs?.length || 0)} PPTX · {billSnapshot.bills.length} bill
                        {billSnapshot.bills.length === 1 ? "" : "s"}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedRun ? <HistoryRunDetail run={selectedRun} onLoadRun={onLoadRun} /> : null}
          </div>
        )}
      </section>
    </section>
  );
}

function HistoryRunDetail({ run, onLoadRun }: { run: HistoryRun; onLoadRun: (run: HistoryRun) => void }) {
  const client = historyClientSnapshot(run);
  const billSnapshot = historyBillSnapshot(run);
  const bill = billSnapshot.combined;
  const currency = bill?.currency || "";
  const calc = run.calc_json;
  const outputs = run.proposal_outputs || [];
  const documents = run.documents || [];
  const extractionDocuments = documents.filter((document) => document.extraction_json);
  const noteGroups = buildHistoryNoteGroups(run, billSnapshot, client);
  const visibleNoteCount = noteGroups.reduce((total, group) => total + group.items.length, 0);

  return (
    <article className="historyDetail" aria-label="Selected proposal run details">
      <div className="historyDetailHero">
        <div>
          <span>Run {run.id.slice(0, 8)}</span>
          <h3>{historyClientName(run)}</h3>
          <p>
            {formatRunDate(run.created_at)} · {formatTextValue(client.industry)} · {historyCountry(run)}
          </p>
        </div>
        <div className="historyDetailActions">
          <span className={run.status === "generated" ? "statusPill generated" : "statusPill"}>{run.status || "draft"}</span>
          <button className="secondaryButton compactButton" type="button" onClick={() => onLoadRun(run)} title="Load run into workspace">
            <FolderOpen aria-hidden="true" />
            Load run
          </button>
        </div>
      </div>

      <section className="historyDetailBlock" aria-label="Stored files">
        <div className="sectionHeader">
          <h4>Files</h4>
          <span>{outputs.length + documents.length} stored</span>
        </div>
        <div className="fileAccessGrid">
          <div>
            <strong>Generated proposal</strong>
            {outputs.length === 0 ? <span className="miniEmpty">No PPTX saved yet.</span> : null}
            {outputs.map((output) => (
              <a
                className="fileAccessLink"
                href={historyDownloadUrl(run.id, "proposal-outputs", output.id)}
                key={output.id}
                download={output.file_name}
              >
                <Download aria-hidden="true" />
                <span>{output.file_name}</span>
              </a>
            ))}
          </div>
          <div>
            <strong>Source documents</strong>
            {documents.length === 0 ? <span className="miniEmpty">No source documents saved.</span> : null}
            {documents.map((document) => (
              <a
                className="fileAccessLink"
                href={historyDownloadUrl(run.id, "documents", document.id)}
                key={document.id}
                download={document.file_name}
              >
                <FileText aria-hidden="true" />
                <span>
                  {document.file_name}
                  <em>{fileKindLabel(document.kind)}</em>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <div className="historyValuesGrid">
        <section className="historyDetailBlock" aria-label="Client extracted values">
          <div className="sectionHeader">
            <h4>Client values</h4>
            <ConfidenceBadge value={client.field_confidence?.client_name} />
          </div>
          <dl className="detailRows">
            <DetailRow label="Client" value={formatTextValue(client.client_name)} />
            <DetailRow label="Industry" value={formatTextValue(client.industry)} />
            <DetailRow label="Country" value={formatTextValue(client.country)} />
            <DetailRow label="City" value={formatTextValue(client.city)} />
            <DetailRow label="Diesel generators" value={formatBooleanValue(client.has_diesel_generators)} />
            <DetailRow label="Grid capacity" value={formatNumberValue(client.grid_connection_kva, " kVA")} />
            <DetailRow label="Roof area" value={formatNumberValue(client.available_roof_area_m2, " m2")} />
          </dl>
          {client.business_description ? <p className="historyDescription">{client.business_description}</p> : null}
        </section>

        <section className="historyDetailBlock" aria-label="Bill extracted values">
          <div className="sectionHeader">
            <h4>Bill values</h4>
            <ConfidenceBadge value={bill?.field_confidence?.monthly_kwh} />
          </div>
          <dl className="detailRows">
            <DetailRow label="Monthly kWh" value={formatNumberValue(bill?.monthly_kwh, " kWh")} />
            <DetailRow label="Total cost" value={formatMoneyValue(currency, bill?.total_cost)} />
            <DetailRow label="Tariff" value={formatTariffValue(currency, bill?.tariff_per_kwh)} />
            <DetailRow label="Active energy" value={formatMoneyValue(currency, bill?.active_energy_charge)} />
            <DetailRow label="Penalties" value={formatMoneyValue(currency, bill?.penalties)} />
            <DetailRow label="Taxes and fees" value={formatMoneyValue(currency, bill?.taxes_and_fees)} />
            <DetailRow label="Tariff basis" value={formatTextValue(bill?.tariff_basis)} />
          </dl>
        </section>

        <section className="historyDetailBlock" aria-label="Calculated economics">
          <div className="sectionHeader">
            <h4>Economics</h4>
            <span>{calc ? "Calculated" : "Open"}</span>
          </div>
          <dl className="detailRows">
            <DetailRow label="Recommended PV" value={formatNumberValue(calc?.pv_recommendation?.recommended_kwp, " kWp")} />
            <DetailRow label="Annual production" value={formatNumberValue(calc?.annual_solar_production_kwh, " kWh")} />
            <DetailRow label="PPA tariff" value={formatTariffValue(currency, calc?.ppa_tariff_per_kwh)} />
            <DetailRow
              label="Grid Y1 savings"
              value={formatMoneyValue(currency, calc?.scenario_grid_replacement?.annual_savings_year_1)}
            />
            <DetailRow
              label="Grid + diesel Y1"
              value={formatMoneyValue(currency, calc?.scenario_grid_diesel?.annual_savings_year_1)}
            />
            <DetailRow label="Constraint" value={formatTextValue(calc?.pv_recommendation?.binding_constraint)} />
          </dl>
        </section>
      </div>

      {billSnapshot.bills.length > 1 ? <HistoryBillTable bills={billSnapshot.bills} currency={currency} /> : null}

      {noteGroups.length > 0 ? (
        <section className="historyDetailBlock" aria-label="Extraction notes and warnings">
          <div className="sectionHeader">
            <h4>Audit notes</h4>
            <span>{visibleNoteCount} shown</span>
          </div>
          <div className="historyNoteGroups">
            {noteGroups.map((group) => (
              <article className={group.tone === "warning" ? "historyNoteGroup warning" : "historyNoteGroup"} key={group.title}>
                <div className="historyNoteGroupHeader">
                  <strong>{group.title}</strong>
                  <span>{group.meta}</span>
                </div>
                <ul className="historyNotes">
                  {group.items.map((note, index) => (
                    <li key={`${group.title}-${note}-${index}`}>{note}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {extractionDocuments.length > 0 ? (
        <details className="historyDisclosure">
          <summary>Document extraction snapshots</summary>
          <div className="snapshotGrid">
            {extractionDocuments.map((document) => (
              <div className="snapshotBlock" key={document.id}>
                <strong>{document.file_name}</strong>
                <span>{fileKindLabel(document.kind)}</span>
                <pre>{JSON.stringify(document.extraction_json, null, 2)}</pre>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function HistoryBillTable({ bills, currency }: { bills: Partial<BillData>[]; currency: string }) {
  return (
    <section className="historyDetailBlock" aria-label="Monthly bill values">
      <div className="sectionHeader">
        <h4>Monthly bills</h4>
        <span>{bills.length} extracted</span>
      </div>
      <div className="tableScroller">
        <table className="historyMiniTable">
          <thead>
            <tr>
              <th>File</th>
              <th>Period</th>
              <th>kWh</th>
              <th>Total</th>
              <th>Tariff</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((bill, index) => (
              <tr key={`${bill.source_file || "bill"}-${index}`}>
                <td>{bill.source_file || `Bill ${index + 1}`}</td>
                <td>{[bill.billing_period_start, bill.billing_period_end].filter(Boolean).join(" to ") || "-"}</td>
                <td>{formatNumberValue(bill.monthly_kwh)}</td>
                <td>{formatMoneyValue(bill.currency || currency, bill.total_cost)}</td>
                <td>{formatTariffValue(bill.currency || currency, bill.tariff_per_kwh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UploadPanel({
  icon,
  title,
  fileLabel,
  inputKey,
  accept,
  multiple,
  onFiles,
  extraction,
}: {
  icon: React.ReactNode;
  title: string;
  fileLabel: string;
  inputKey: string;
  accept: string;
  multiple: boolean;
  onFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  extraction: ExtractionState;
}) {
  return (
    <div className={`uploadPanel ${extraction.phase}`}>
      <div className="panelTitle">
        <span className="panelIcon">{icon}</span>
        <h3>{title}</h3>
        <span className={`extractionStatus ${extraction.phase}`} aria-live="polite">
          {extraction.phase === "extracting" ? <Loader2 className="spin" aria-hidden="true" /> : null}
          {extraction.phase === "done" ? <CheckCircle2 aria-hidden="true" /> : null}
          {extraction.phase === "error" ? <AlertCircle aria-hidden="true" /> : null}
          {extraction.text}
        </span>
      </div>
      <label className="fileDrop">
        <UploadCloud aria-hidden="true" />
        <span>{fileLabel}</span>
        <input key={inputKey} type="file" accept={accept} multiple={multiple} onChange={onFiles} />
      </label>
    </div>
  );
}

function BillSummary({ bills }: { bills: BillData[] }) {
  return (
    <section className="dataBand" aria-label="Monthly bill summary">
      <div className="sectionHeader">
        <h3>Monthly bill summary</h3>
        <span>{bills.length} extracted</span>
      </div>
      <div className="tableScroller">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Period</th>
              <th>kWh</th>
              <th>Total</th>
              <th>Tariff</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((bill, index) => (
              <tr key={`${bill.source_file}-${index}`}>
                <td>{bill.source_file || `Bill ${index + 1}`}</td>
                <td>{[bill.billing_period_start, bill.billing_period_end].filter(Boolean).join(" to ") || "-"}</td>
                <td>{numberFormat.format(bill.monthly_kwh)}</td>
                <td>
                  {bill.currency} {moneyFormat.format(bill.total_cost)}
                </td>
                <td>{moneyFormat.format(bill.tariff_per_kwh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BillReview({
  billForm,
  setBillForm,
}: {
  billForm: BillForm;
  setBillForm: React.Dispatch<React.SetStateAction<BillForm>>;
}) {
  function update(field: keyof BillForm, value: string) {
    setBillForm((current) => ({ ...current, [field]: value }));
  }

  function updatePeriod(index: number, field: keyof TariffPeriodForm, value: string) {
    setBillForm((current) => ({
      ...current,
      tariff_periods: current.tariff_periods.map((period, itemIndex) =>
        itemIndex === index ? { ...period, [field]: value } : period,
      ),
    }));
  }

  function addPeriod() {
    setBillForm((current) => ({
      ...current,
      tariff_periods: [
        ...current.tariff_periods,
        { label: "", kwh: "", unit_price_per_kwh: "", energy_charge: "", confidence: "" },
      ],
    }));
  }

  function removePeriod(index: number) {
    setBillForm((current) => ({
      ...current,
      tariff_periods: current.tariff_periods.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  return (
    <section className="reviewPanel">
      <div className="sectionHeader">
        <h3>Bill review</h3>
        <ConfidenceBadge value={billForm.field_confidence.monthly_kwh} />
      </div>
      <ConfidenceStrip fieldConfidence={billForm.field_confidence} />
      <div className="fieldGrid">
        <TextField label="Monthly kWh" value={billForm.monthly_kwh} onChange={(value) => update("monthly_kwh", value)} />
        <TextField label="Currency" value={billForm.currency} onChange={(value) => update("currency", value)} />
        <TextField label="Total cost" value={billForm.total_cost} onChange={(value) => update("total_cost", value)} />
        <TextField label="Tariff per kWh" value={billForm.tariff_per_kwh} onChange={(value) => update("tariff_per_kwh", value)} />
        <TextField label="Period start" type="date" value={billForm.billing_period_start} onChange={(value) => update("billing_period_start", value)} />
        <TextField label="Period end" type="date" value={billForm.billing_period_end} onChange={(value) => update("billing_period_end", value)} />
        <TextField label="Active energy charge" value={billForm.active_energy_charge} onChange={(value) => update("active_energy_charge", value)} />
        <TextField label="Penalties" value={billForm.penalties} onChange={(value) => update("penalties", value)} />
        <TextField label="Taxes and fees" value={billForm.taxes_and_fees} onChange={(value) => update("taxes_and_fees", value)} />
        <TextField label="Fixed or demand charges" value={billForm.fixed_or_demand_charges} onChange={(value) => update("fixed_or_demand_charges", value)} />
      </div>
      <label className="stackedField">
        <span>Tariff basis</span>
        <input value={billForm.tariff_basis} onChange={(event) => update("tariff_basis", event.target.value)} />
      </label>
      <div className="periodHeader">
        <h4>Time-of-use rows</h4>
        <button className="iconButton" type="button" onClick={addPeriod} title="Add time-of-use row">
          <Plus aria-hidden="true" />
        </button>
      </div>
      <div className="periodRows">
        {billForm.tariff_periods.length === 0 ? <p className="emptyState">No time-of-use rows.</p> : null}
        {billForm.tariff_periods.map((period, index) => (
          <div className="periodRow" key={`${period.label}-${index}`}>
            <input aria-label="Period label" placeholder="Label" value={period.label} onChange={(event) => updatePeriod(index, "label", event.target.value)} />
            <input aria-label="Period kWh" placeholder="kWh" value={period.kwh} onChange={(event) => updatePeriod(index, "kwh", event.target.value)} />
            <input aria-label="Unit price" placeholder="Unit price" value={period.unit_price_per_kwh} onChange={(event) => updatePeriod(index, "unit_price_per_kwh", event.target.value)} />
            <input aria-label="Energy charge" placeholder="Charge" value={period.energy_charge} onChange={(event) => updatePeriod(index, "energy_charge", event.target.value)} />
            <button className="iconButton danger" type="button" onClick={() => removePeriod(index)} title="Remove row">
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ClientReview({
  clientForm,
  setClientForm,
}: {
  clientForm: ClientForm;
  setClientForm: React.Dispatch<React.SetStateAction<ClientForm>>;
}) {
  function update(field: keyof ClientForm, value: string) {
    setClientForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="reviewPanel">
      <div className="sectionHeader">
        <h3>Client review</h3>
        <ConfidenceBadge value={clientForm.field_confidence.client_name} />
      </div>
      <ConfidenceStrip fieldConfidence={clientForm.field_confidence} />
      <div className="fieldGrid">
        <TextField label="Client name" value={clientForm.client_name} onChange={(value) => update("client_name", value)} />
        <label className="stackedField">
          <span>Industry</span>
          <select value={clientForm.industry} onChange={(event) => update("industry", event.target.value)}>
            <option value="">Select</option>
            {industries.map((industry) => (
              <option key={industry.value} value={industry.value}>
                {industry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="stackedField">
          <span>Country</span>
          <select value={clientForm.country} onChange={(event) => update("country", event.target.value)}>
            <option value="">Select</option>
            {countries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </label>
        <TextField label="City" value={clientForm.city} onChange={(value) => update("city", value)} />
        <TextField label="Latitude" value={clientForm.latitude} onChange={(value) => update("latitude", value)} />
        <TextField label="Longitude" value={clientForm.longitude} onChange={(value) => update("longitude", value)} />
        <label className="stackedField">
          <span>Diesel generators</span>
          <select
            value={clientForm.has_diesel_generators}
            onChange={(event) => update("has_diesel_generators", event.target.value)}
          >
            <option value="">Select</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <TextField label="Grid capacity kVA" value={clientForm.grid_connection_kva} onChange={(value) => update("grid_connection_kva", value)} />
        <TextField label="Roof area m2" value={clientForm.available_roof_area_m2} onChange={(value) => update("available_roof_area_m2", value)} />
        <TextField label="Daytime fraction" value={clientForm.daytime_fraction_override} onChange={(value) => update("daytime_fraction_override", value)} />
        <TextField label="PPA tariff override" value={clientForm.ppa_tariff_per_kwh_override} onChange={(value) => update("ppa_tariff_per_kwh_override", value)} />
        <TextField label="Diesel price override" value={clientForm.diesel_price_per_liter_override} onChange={(value) => update("diesel_price_per_liter_override", value)} />
      </div>
      <label className="stackedField">
        <span>Business description</span>
        <textarea
          value={clientForm.business_description}
          onChange={(event) => update("business_description", event.target.value)}
          rows={4}
        />
      </label>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="stackedField">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ConfidenceBadge({ value }: { value: number | undefined }) {
  if (value === undefined) {
    return <span className="confidenceBadge muted">Open</span>;
  }
  const percent = Math.round(value * 100);
  return <span className={percent >= 75 ? "confidenceBadge good" : "confidenceBadge"}>{percent}%</span>;
}

function ConfidenceStrip({ fieldConfidence }: { fieldConfidence: Record<string, number> }) {
  const entries = confidenceEntries(fieldConfidence);
  if (entries.length === 0) {
    return null;
  }
  const low = entries.filter((entry) => entry.percent < 75);
  if (low.length === 0) {
    return (
      <div className="confidenceStrip good" aria-label="Confidence summary">
        <CheckCircle2 aria-hidden="true" />
        <span>Extracted fields are above 75% confidence.</span>
      </div>
    );
  }
  return (
    <div className="confidenceStrip warn" aria-label="Low confidence fields">
      <AlertCircle aria-hidden="true" />
      <div>
        <strong>Review low-confidence values</strong>
        <span>
          {low
            .slice(0, 4)
            .map((entry) => `${entry.label} ${entry.percent}%`)
            .join(" · ")}
          {low.length > 4 ? ` · ${low.length - 4} more` : ""}
        </span>
      </div>
    </div>
  );
}

function EconomicsPreview({ preview, billCurrency }: { preview: CalcResult; billCurrency: string }) {
  const scenarios = [preview.scenario_grid_replacement, preview.scenario_grid_diesel];

  return (
    <div className="economicsStack">
      <section className="metricsBand" aria-label="Economics preview">
        <Metric label="Recommended PV" value={`${moneyFormat.format(preview.pv_recommendation.recommended_kwp)} kWp`} />
        <Metric label="Annual production" value={`${numberFormat.format(preview.annual_solar_production_kwh)} kWh`} />
        <Metric label="PPA tariff" value={`${billCurrency} ${tariffFormat.format(preview.ppa_tariff_per_kwh)}`} />
        <Metric label="Grid Y1" value={`${billCurrency} ${moneyFormat.format(preview.scenario_grid_replacement.annual_savings_year_1)}`} />
        <Metric label="Grid + diesel Y1" value={`${billCurrency} ${moneyFormat.format(preview.scenario_grid_diesel.annual_savings_year_1)}`} />
        <Metric label="Binding constraint" value={preview.pv_recommendation.binding_constraint.replaceAll("_", " ")} />
      </section>

      <section className="scenarioPanel" aria-label="Scenario comparison">
        <div className="sectionHeader">
          <h3>Scenario comparison</h3>
          <span>{scenarios.length} modeled</span>
        </div>
        <div className="scenarioGrid">
          {scenarios.map((scenario) => (
            <ScenarioCard key={scenario.name} scenario={scenario} billCurrency={billCurrency} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ScenarioCard({ scenario, billCurrency }: { scenario: ScenarioResult; billCurrency: string }) {
  const rows = [
    ["Year 1 monthly savings", `${billCurrency} ${moneyFormat.format(scenario.monthly_savings_year_1)}`],
    ["Year 1 annual savings", `${billCurrency} ${moneyFormat.format(scenario.annual_savings_year_1)}`],
    ["Cumulative savings", `${billCurrency} ${moneyFormat.format(scenario.cumulative_savings)}`],
    ["Solar used in year 1", `${numberFormat.format(scenario.year_1_solar_used_kwh)} kWh`],
    ["Baseline cost", `${billCurrency} ${tariffFormat.format(scenario.current_cost_per_kwh_year_1)}/kWh`],
    ["PPA tariff", `${billCurrency} ${tariffFormat.format(scenario.ppa_tariff_per_kwh)}/kWh`],
  ];

  return (
    <article className="scenarioCard" aria-label={scenario.name}>
      <div className="scenarioHeader">
        <strong>{scenario.name}</strong>
        <span>{scenario.yearly_savings.length} years</span>
      </div>
      <dl className="scenarioRows">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
