# Aspan Proposal Engine

## Project Overview

Aspan Proposal Engine is a first-version internal tool for producing editable solar/PPA PowerPoint proposals from utility bills, client information, approved Aspan facts, and deterministic solar economics.

The main UI is a Next.js/React workspace backed by FastAPI. Streamlit remains available as a fast fallback demo. The rest of the pipeline stays the same: core Python engine, thin FastAPI wrapper, and n8n orchestration that calls FastAPI.

## Architecture

The project has three operating layers:

1. Bill Intelligence extracts structured bill fields from uploaded PDF or image bills.
2. The deterministic solar economics engine calculates PV sizing, production, tariffs, and savings.
3. The grounded proposal writer creates client-facing prose using only approved facts and already calculated numbers.

LLMs are used only for extraction and narrative. Python owns all financial and engineering calculations. The React app, Streamlit app, and FastAPI API all call the same core modules.

## Why Calculations Are Deterministic

Financial and engineering calculations are implemented in `core/calc_engine.py` and covered by pytest tests. Claude is never allowed to calculate, modify, estimate, or improve the numbers. This keeps the proposal auditable and makes the assumptions appendix defensible for CFO review.

## Why Not Use Full RAG

V1 intentionally avoids embeddings, chunking, vector databases, and retrieval ranking. The approved Markdown facts in `knowledge_base/` are small enough to inject directly into the narrative prompt. This prevents hallucinated Aspan-specific claims while avoiding unnecessary RAG complexity. Full RAG is a v2 feature once there is a larger proposal library.

## Setup Instructions

Use the provided virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Copy `.env.example` to `.env` and add your Anthropic key if you want live Claude extraction and narrative.
The app automatically loads `.env` from the project root for Streamlit, FastAPI, and scripts.

## Environment Variables

```env
ANTHROPIC_API_KEY=your_api_key_here
ANTHROPIC_VISION_MODEL=claude-sonnet-4-6
ANTHROPIC_TEXT_MODEL=claude-sonnet-4-6

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your_secret_key
SUPABASE_DOCUMENT_BUCKET=aspan-documents
SUPABASE_PROPOSAL_BUCKET=aspan-proposals
```

Without `ANTHROPIC_API_KEY`, the system uses fallback bill extraction and deterministic fallback narrative so the demo still runs.
Without Supabase variables, the API runs locally without persistence.

## Supabase Setup

Run [supabase/schema.sql](supabase/schema.sql) in the Supabase SQL editor. It creates:

- `clients`
- `proposal_runs`
- `documents`
- `proposal_outputs`
- private Storage buckets `aspan-documents` and `aspan-proposals`

The FastAPI backend uses `SUPABASE_SECRET_KEY` and writes to Supabase server-side only. The React app never receives the secret key. Proposal work is grouped by the `X-Proposal-Run-Id` response/request header:

- Bill extraction uploads source bills, saves extracted bill JSON, and updates `proposal_runs.bill_json`.
- Client extraction uploads client files, saves extracted client JSON, and updates `proposal_runs.client_json`.
- Calculation preview updates `proposal_runs.calc_json`.
- Proposal generation inserts a client row, uploads the generated PPTX, and creates a `proposal_outputs` record.

## Run Tests

```powershell
.\.venv\Scripts\python.exe -m pytest
```

The highest-priority tests are in `tests/test_calc_engine.py`.

## Run FastAPI

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app --port 8000
```

On Windows, prefer the no-reload command above for demos. `--reload` is useful during development, but its watcher can print noisy multiprocessing tracebacks when the process is interrupted.

Endpoints:

- `GET /health`
- `POST /extract-bill`
- `POST /extract-bill-collection`
- `POST /extract-client-info`
- `POST /calculate-preview`
- `POST /generate-proposal`

## Run React UI

From a second terminal:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:3000`. The frontend proxies `/api/*` to FastAPI at `http://127.0.0.1:8000` by default. To point it somewhere else, set `NEXT_PUBLIC_API_BASE_URL` before starting Next.js.

The React workspace supports:

- Utility bill PDFs and images, including French CIE-style monthly bills
- Client PDFs, PPTX files, and images
- Editable review fields before calculations
- Deterministic calculation preview
- PPTX generation and download

## Run Streamlit UI

```powershell
.\.venv\Scripts\streamlit.exe run ui/app.py
```

The Streamlit app has two extraction tabs:

- Utility Bills accepts bill PDFs, screenshots, and images, then extracts consumption, cost, tariff, period, confidence, and notes.
- French CIE-style monthly bills preserve time-of-use rows such as `Nuit`, `Pointe`, and `Jour`, plus active energy charge, penalties, taxes/fees, fixed or demand charges, and tariff basis.
- Client Information accepts PDFs, PPTX files, screenshots, and images, then extracts client name, industry, country, business description, diesel generator status, grid capacity, roof area, assumptions, confidence, and notes.

Both tabs populate editable review fields. Calculations and proposal generation remain disabled until the required reviewed fields are present.

## n8n Workflow

Import `automation/aspan_proposal_workflow.json` into n8n. The workflow:

1. Receives a webhook request with a bill file and client JSON.
2. Calls FastAPI `POST /extract-bill`.
3. Calls FastAPI `POST /generate-proposal`.
4. Returns the generated PPTX file.

n8n does not run Python business logic.

## Generate A Sample Proposal

```powershell
.\.venv\Scripts\python.exe scripts/generate_sample.py
```

The script uses dummy confirmed bill data and writes an editable PowerPoint into `outputs/`.

## Folder Structure

```text
api/                  FastAPI wrapper
automation/           n8n workflow export
core/                 Models, config, extraction, calculations, grounding, narrative, PPTX, logging
frontend/             Next.js/React proposal workspace
knowledge_base/       Approved facts pack Markdown files
reference_materials/  Optional style references by metadata
supabase/             SQL schema for persistence
templates/            Placeholder PowerPoint template
outputs/              Generated PPTX files
cache/                NASA POWER and upload cache
logs/                 JSONL proposal run log
tests/                Pytest coverage for core assumptions and calculations
ui/                   Streamlit demo app
```

## Assumptions And Limitations

- Utility bill and client information extraction depend on Claude when `ANTHROPIC_API_KEY` is set.
- PPTX client materials are converted to slide text locally before Claude extracts structured client information.
- Missing or unreadable bill values fall back to documented low-confidence defaults.
- Missing roof area uses a conservative fallback in full proposal calculation.
- Missing grid capacity does not dominate PV sizing.
- NASA POWER failures fall back to `default_specific_yield_kwh_per_kwp`.
- The generated PowerPoint uses editable native shapes, text, tables, and charts.
- The placeholder template includes TODO metadata until official brand assets are provided.

## Future Improvements

1. Full RAG over a large library of past proposals
2. User authentication
3. CRM integration
4. Automated email sending
5. Multi-user proposal history dashboard
6. Better country-specific tariff and diesel databases
7. More advanced PV simulation
8. Aspan-branded design system after receiving official templates
9. Approval workflow before sending proposals
10. Cloud deployment
