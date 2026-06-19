"use client";

import {
  AlertCircle,
  Building2,
  Calculator,
  CheckCircle2,
  Download,
  FileText,
  History,
  LayoutDashboard,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

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

type DocumentExtractionResult = {
  bill: BillExtractionResult | null;
  client: ClientInfoDraft | null;
  warnings: string[];
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

type HistoryRun = {
  id: string;
  status?: string | null;
  created_at?: string | null;
  client_json?: Partial<ClientInfoDraft> | null;
  bill_json?: unknown;
  calc_json?: unknown;
  warnings?: string[] | null;
  clients?: HistoryClient | null;
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

async function uploadDocumentSet(
  billFiles: File[],
  clientFiles: File[],
  runId: string | null,
): Promise<ApiResult<DocumentExtractionResult>> {
  const formData = new FormData();
  billFiles.forEach((file) => formData.append("bill_files", file));
  clientFiles.forEach((file) => formData.append("client_files", file));
  const response = await fetch("/api/extract-documents", {
    method: "POST",
    headers: apiHeaders(runId),
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return {
    data: (await response.json()) as DocumentExtractionResult,
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

function intakeSummary(billFiles: File[], clientFiles: File[]): string {
  const parts = [];
  if (billFiles.length) {
    parts.push(`${billFiles.length} bill${billFiles.length === 1 ? "" : "s"}`);
  }
  if (clientFiles.length) {
    parts.push(`${clientFiles.length} client file${clientFiles.length === 1 ? "" : "s"}`);
  }
  return parts.length ? parts.join(" + ") : "No files selected";
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

export default function ProposalWorkspace() {
  const [billFiles, setBillFiles] = useState<File[]>([]);
  const [clientFiles, setClientFiles] = useState<File[]>([]);
  const [billForm, setBillForm] = useState<BillForm>(emptyBillForm);
  const [clientForm, setClientForm] = useState<ClientForm>(emptyClientForm);
  const [monthlyBills, setMonthlyBills] = useState<BillData[]>([]);
  const [preview, setPreview] = useState<CalcResult | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"all" | "preview" | "proposal" | null>(null);
  const [proposalRunId, setProposalRunId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("workspace");
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [resetKey, setResetKey] = useState(0);

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
      const response = await fetch("/api/proposal-runs?limit=25");
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

  function resetWorkspace() {
    setBillFiles([]);
    setClientFiles([]);
    setBillForm(emptyBillForm);
    setClientForm(emptyClientForm);
    setMonthlyBills([]);
    setPreview(null);
    setStatus(null);
    setBusy(null);
    setProposalRunId(null);
    setResetKey((value) => value + 1);
  }

  function onBillFiles(event: ChangeEvent<HTMLInputElement>) {
    setBillFiles(Array.from(event.target.files || []));
    setPreview(null);
  }

  function onClientFiles(event: ChangeEvent<HTMLInputElement>) {
    setClientFiles(Array.from(event.target.files || []));
    setPreview(null);
  }

  async function extractAllDocuments() {
    if (billFiles.length === 0 && clientFiles.length === 0) {
      setStatus({ tone: "warn", text: "Select utility bills or client documents first." });
      return;
    }
    setBusy("all");
    setStatus(null);
    try {
      const result = await uploadDocumentSet(billFiles, clientFiles, proposalRunId);
      if (result.runId) {
        setProposalRunId(result.runId);
      }
      if (result.data.bill) {
        setBillForm(billToForm(result.data.bill.combined_bill));
        setMonthlyBills(result.data.bill.bills);
      }
      if (result.data.client) {
        setClientForm(clientToForm(result.data.client));
      }

      setPreview(null);
      setStatus({
        tone: result.data.warnings.length ? "warn" : "ok",
        text: result.data.warnings[0] || "Document extraction complete.",
      });
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : "Document extraction failed." });
    } finally {
      setBusy(null);
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
      const response = await fetch("/api/calculate-preview", {
        method: "POST",
        headers: apiHeaders(proposalRunId, true),
        body: JSON.stringify(buildPayload()),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const nextRunId = response.headers.get("x-proposal-run-id");
      if (nextRunId) {
        setProposalRunId(nextRunId);
      }
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
      const response = await fetch("/api/generate-proposal", {
        method: "POST",
        headers: apiHeaders(proposalRunId, true),
        body: JSON.stringify(buildPayload()),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const nextRunId = response.headers.get("x-proposal-run-id");
      if (nextRunId) {
        setProposalRunId(nextRunId);
      }
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
              />
              <UploadPanel
                icon={<Building2 aria-hidden="true" />}
                title="Client information"
                fileLabel={fileLabel(clientFiles)}
                inputKey={`client-${resetKey}`}
                accept=".pdf,.pptx,image/*"
                multiple
                onFiles={onClientFiles}
              />
            </section>

            <section className="commandStrip extractionStrip" aria-label="Combined extraction controls">
              <button
                className="primaryButton"
                type="button"
                onClick={extractAllDocuments}
                disabled={busy === "all" || (billFiles.length === 0 && clientFiles.length === 0)}
                title="Extract selected utility and client documents"
              >
                {busy === "all" ? <Loader2 className="spin" aria-hidden="true" /> : <UploadCloud aria-hidden="true" />}
                Extract documents
              </button>
              <span className="requirementState">{intakeSummary(billFiles, clientFiles)}</span>
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
          />
        )}
      </section>
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
}: {
  runs: HistoryRun[];
  loading: boolean;
  currentRunId: string | null;
  monthlyBills: BillData[];
  preview: CalcResult | null;
  canPreview: boolean;
}) {
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
        <Metric label="Saved runs" value={String(runs.length)} />
        <Metric label="History" value={loading ? "Loading" : "Live"} />
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
          <div className="tableScroller">
            <table className="historyTable">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Run ID</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{historyClientName(run)}</td>
                    <td>{historyCountry(run)}</td>
                    <td>
                      <span className={run.status === "generated" ? "statusPill generated" : "statusPill"}>
                        {run.status || "draft"}
                      </span>
                    </td>
                    <td>{formatRunDate(run.created_at)}</td>
                    <td>
                      <code>{run.id.slice(0, 8)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
}: {
  icon: React.ReactNode;
  title: string;
  fileLabel: string;
  inputKey: string;
  accept: string;
  multiple: boolean;
  onFiles: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="uploadPanel">
      <div className="panelTitle">
        <span className="panelIcon">{icon}</span>
        <h3>{title}</h3>
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
