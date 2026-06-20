# Aspan Proposal Engine

Aspan Proposal Engine is a first-version internal tool for creating editable solar/PPA PowerPoint proposals from utility bills, client background documents, approved Aspan facts, and deterministic solar economics.

The current app uses:

- FastAPI for extraction, calculations, proposal generation, and Supabase persistence
- Next.js/React for the main workspace
- Supabase for proposal history, uploaded documents, extracted values, and generated PPTX files
- Python core modules for all business logic
- Streamlit as a local fallback UI
- n8n as an optional document-to-proposal automation path

## Architecture

The system has three operating layers:

1. Bill and client intelligence extracts structured values from utility bills, PDFs, PPTX files, screenshots, and images.
2. The deterministic solar economics engine calculates PV sizing, production, tariffs, and two savings scenarios.
3. The grounded proposal writer creates client-facing prose using approved facts and already calculated numbers.

LLMs are used only for extraction and narrative drafting. Python owns all financial and engineering calculations.

## Why Calculations Are Deterministic

Financial and engineering calculations live in `core/calc_engine.py` and are covered by pytest tests. The narrative model is not allowed to calculate, reinterpret, or improve numbers. This keeps the proposal auditable and makes the assumptions appendix defensible.

## Why V1 Does Not Use Full RAG

V1 intentionally avoids embeddings, chunking, vector databases, and retrieval ranking. The approved Markdown facts in `knowledge_base/` are small enough to inject directly into the narrative prompt. This prevents hallucinated Aspan-specific claims without overbuilding the first version.

## Environment Variables

Copy `.env.example` to `.env` and fill in the values you need:

```env
ANTHROPIC_API_KEY=your_api_key_here
ANTHROPIC_VISION_MODEL=claude-sonnet-4-6
ANTHROPIC_TEXT_MODEL=claude-sonnet-4-6

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your_secret_key
SUPABASE_DOCUMENT_BUCKET=aspan-documents
SUPABASE_PROPOSAL_BUCKET=aspan-proposals
```

Without `ANTHROPIC_API_KEY`, the app uses documented fallback extraction/narrative behavior. Without Supabase variables, the API still runs, but proposal history and file persistence are disabled.

## Run With Docker

The Docker setup runs the React UI and FastAPI API together, plus n8n as a second service.

```powershell
docker compose up --build
```

Open:

- React UI: `http://127.0.0.1:3000`
- FastAPI health: `http://127.0.0.1:8001/health`
- n8n editor: `http://127.0.0.1:5678`

The app container exposes ports 3000 and 8000 and mounts `cache/`, `logs/`, and `outputs/`. The n8n service stores its state in the `n8n_data` Docker volume and imports the Aspan workflow on its first start.

Supabase itself is not bundled into this app container. Use the hosted Supabase project configured in `.env`, then run [supabase/schema.sql](supabase/schema.sql) in the Supabase SQL editor.

## Supabase Setup

Run [supabase/schema.sql](supabase/schema.sql). It creates:

- `clients`
- `proposal_runs`
- `documents`
- `proposal_outputs`
- private Storage buckets `aspan-documents` and `aspan-proposals`

The backend uses the Supabase service key server-side. The browser never receives that secret.

Proposal runs are grouped by the `X-Proposal-Run-Id` header:

- `/extract-documents`, `/extract-bill-collection`, and `/extract-client-info` store source documents and extraction JSON.
- `/calculate-preview` stores reviewed bill/client data plus calculation results.
- `/generate-proposal` stores the generated PPTX output.
- `/proposal-runs` returns run history with documents, outputs, extracted values, and calculations.

## Local Development

Install Python dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Run FastAPI:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8001
```

Run React from a second terminal:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev -- --hostname 127.0.0.1 --port 3001
```

Open `http://127.0.0.1:3001`. The frontend calls FastAPI directly through `NEXT_PUBLIC_API_BASE_URL`, defaulting to `http://127.0.0.1:8001`.

## Main Workflow

1. Upload utility bills under `Utility bills`. Bill extraction starts immediately.
2. Upload client PDFs, PPTX files, screenshots, or images under `Client information`. Client extraction starts independently and may run alongside bill extraction.
3. Review and edit bill/client values. Low-confidence extracted fields are highlighted.
4. Click `Preview economics`.
5. Review Grid Replacement and Grid + Diesel scenarios.
6. Click `Generate PPTX`.
7. Use `Dashboard & History` to reopen saved runs, download source documents, inspect extracted values, download generated PPTX files, or load an old run back into the workspace.

## FastAPI Endpoints

- `GET /health`
- `GET /proposal-runs`
- `GET /proposal-runs/{run_id}/documents/{document_id}/download`
- `GET /proposal-runs/{run_id}/proposal-outputs/{output_id}/download`
- `POST /proposal-runs`
- `POST /extract-documents`
- `POST /extract-bill`
- `POST /extract-bill-collection`
- `POST /extract-client-info`
- `POST /calculate-preview`
- `POST /generate-proposal`

## Tests And QA

Run tests:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

Run frontend typecheck:

```powershell
cd frontend
npm.cmd run typecheck
```

Run PPTX QA on a generated deck:

```powershell
.\.venv\Scripts\python.exe scripts\qa_pptx.py outputs\neskao_2026-06-20_proposal.pptx
```

The PPTX QA checks for TODO/TBD text, very thin slides, and missing chart/unit labels.

## n8n Workflow

Docker Compose starts the pinned n8n `2.26.8` image at `http://127.0.0.1:5678` and imports [automation/aspan_proposal_workflow.json](automation/aspan_proposal_workflow.json) on the first start. Create the local n8n owner account, open `Aspan Proposal Engine - Document Workflow`, and activate it. Override `N8N_IMAGE` in `.env` only after testing the workflow against the newer release.

The automation path:

1. Receives a utility bill document and a client-background document through the webhook.
2. Calls FastAPI `/extract-documents`, where bill and client extraction run in parallel.
3. Validates that the extracted client name, industry, and country are present.
4. Passes the extraction `X-Proposal-Run-Id` to `/generate-proposal` so History remains one run.
5. Returns the generated PPTX while Supabase stores the source documents, extracted values, and output.

The production webhook expects the binary multipart fields `bill_files` and `client_files`. After activating the workflow, test it from PowerShell:

```powershell
curl.exe -X POST "http://127.0.0.1:5678/webhook/aspan-proposal" `
  -F "bill_files=@test/Utility bills/2025.09.pdf" `
  -F "client_files=@test/Neskao business description.pdf" `
  --output aspan-n8n-proposal.pptx
```

This V1 webhook accepts one document per category. Use a multi-page PDF when several bill pages belong to the same automated request. The React workspace remains the review-first path for separate monthly bill files, low-confidence corrections, economics preview, and reopening history.

## Streamlit Fallback

Streamlit remains available for quick local debugging:

```powershell
.\.venv\Scripts\streamlit.exe run ui/app.py
```

The React UI is the main product surface.

## Folder Structure

```text
api/                  FastAPI wrapper
automation/           n8n workflow export
core/                 Models, config, extraction, calculations, grounding, narrative, PPTX, logging
frontend/             Next.js/React proposal workspace
knowledge_base/       Approved facts pack Markdown files
reference_materials/  Optional style references by metadata
scripts/              Container startup and QA helpers
supabase/             SQL schema for persistence
templates/            Editable PowerPoint template
outputs/              Generated PPTX files
cache/                NASA POWER and upload cache
logs/                 JSONL proposal run log
tests/                Pytest coverage
ui/                   Streamlit fallback app
```

## Assumptions And Limitations

- Utility bill and client extraction depend on Claude when `ANTHROPIC_API_KEY` is set.
- Missing or unreadable bill values fall back to documented low-confidence defaults.
- Missing roof area uses a conservative fallback in full proposal calculation.
- Missing grid capacity does not dominate PV sizing.
- NASA POWER failures fall back to `default_specific_yield_kwh_per_kwp`.
- Generated PowerPoint files use editable native shapes, text, tables, and charts.
- Human review is still required before sending a proposal to a client.

## V2 Roadmap

1. Full RAG over a large proposal library
2. User authentication and roles
3. CRM integration
4. Automated email sending
5. Approval workflow before sending proposals
6. Better country-specific tariff and diesel databases
7. More advanced PV simulation
8. Aspan-branded design system after receiving official templates
9. Multi-user deployment hardening
10. Cloud deployment
