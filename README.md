# Aspan Proposal Engine

Aspan Proposal Engine converts utility bills and client background documents into a reviewed, editable solar PPA proposal. The main application combines a Next.js workspace, a FastAPI backend, deterministic Python calculations, Anthropic document extraction and narrative generation, Supabase persistence, native PowerPoint generation, and an optional n8n automation workflow.

The system keeps AI interpretation separate from engineering and financial calculations. Anthropic extracts document values and drafts proposal prose. Python validates inputs, sizes the PV system, calculates both commercial scenarios, checks generated numbers, and builds the final PowerPoint.

## Contents

- [Capabilities](#capabilities)
- [Architecture](#architecture)
- [Quick Start With Docker](#quick-start-with-docker)
- [Supabase Setup](#supabase-setup)
- [Environment Configuration](#environment-configuration)
- [Using the Application](#using-the-application)
- [Calculation Method](#calculation-method)
- [Extraction and Generation](#extraction-and-generation)
- [Persistence and History](#persistence-and-history)
- [n8n Automation](#n8n-automation)
- [Local Development](#local-development)
- [Testing and PowerPoint QA](#testing-and-powerpoint-qa)
- [Operations](#operations)
- [Troubleshooting](#troubleshooting)
- [Security and Limitations](#security-and-limitations)
- [Project Structure](#project-structure)

## Capabilities

- Extracts monthly consumption, invoice cost, tariff data, billing periods, penalties, taxes, and time-of-use values from utility bills.
- Handles English, French, Russian, and Kazakh utility documents, including scanned bills and images.
- Extracts client information from PDFs, PPTX files, screenshots, images, site reports, and commercial documents.
- Combines several monthly bills into one representative bill while preserving each monthly result.
- Keeps confidence scores, assumptions, warnings, and extraction notes available for human review.
- Calculates PV sizing from consumption, daytime demand, roof area, and grid capacity.
- Estimates solar production from NASA POWER irradiance data when coordinates are available.
- Calculates Grid Replacement and Grid + Diesel savings scenarios.
- Produces an editable 11-slide PowerPoint with native text, shapes, and charts.
- Stores proposal runs, source documents, extracted values, calculations, and generated files in Supabase.
- Reopens a previous run in the workspace for correction, recalculation, and regeneration.
- Supports an optional n8n webhook for automated document-to-proposal processing.

## Architecture

```text
Browser
  |
  v
Next.js / React workspace
  |
  | same-origin /api proxy
  v
FastAPI application
  |-- document staging and validation
  |-- Anthropic extraction
  |-- Pydantic schema validation
  |-- deterministic calculation engine
  |-- grounded narrative generation
  |-- native PowerPoint builder
  |-- background Supabase persistence
  |
  +--> Supabase PostgreSQL and Storage
  +--> NASA POWER, with local response cache

n8n can call the same FastAPI application for unattended workflows.
```

### Responsibility Boundaries

| Layer | Responsibility |
| --- | --- |
| Next.js and React | Uploads, review forms, confidence warnings, economics display, proposal downloads, and History |
| FastAPI | Request validation, orchestration, file responses, and background persistence |
| Anthropic | Multimodal extraction and proposal narrative drafting |
| Pydantic | Strict validation of extracted and generated JSON |
| Calculation engine | PV sizing, production, tariffs, savings, degradation, and escalation |
| PowerPoint builder | Editable slide layout, charts, units, assumptions, and review notes |
| Supabase | Run history, JSON snapshots, source documents, and generated proposals |
| n8n | Optional webhook orchestration |

## Quick Start With Docker

Docker is the recommended way to run the complete solution.

### Prerequisites

- Docker Desktop with Docker Compose
- An Anthropic API key for real extraction and narrative generation
- A hosted Supabase project if you need History and file persistence
- At least 4 GB of free memory for the application and n8n containers

### 1. Configure the Environment

From PowerShell in the project root:

```powershell
Copy-Item .env.example .env
```

Open `.env` and set at least:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_VISION_MODEL=claude-sonnet-4-6
ANTHROPIC_TEXT_MODEL=claude-sonnet-4-6
```

Add the Supabase values after completing [Supabase Setup](#supabase-setup):

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your_server_side_secret_or_service_role_key
SUPABASE_DOCUMENT_BUCKET=aspan-documents
SUPABASE_PROPOSAL_BUCKET=aspan-proposals
```

Do not commit `.env`. The frontend does not need the Supabase secret or Anthropic key.

For a guided Windows setup, add the credentials to `.env` after the script creates it:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

On macOS or Linux:

```bash
sh scripts/setup.sh
```

Both scripts verify Docker, create `.env` when missing, build the containers, wait for API health, and print the application URLs. The app can start without external credentials, but real extraction requires Anthropic and History requires Supabase.

### 2. Start the Stack

```powershell
docker compose up -d --build
```

Skip this command when the setup script has already started the stack.

Docker starts:

| Service | Address | Purpose |
| --- | --- | --- |
| React workspace | `http://127.0.0.1:3000` | Main application |
| FastAPI | `http://127.0.0.1:8001` | Backend and health check |
| FastAPI documentation | `http://127.0.0.1:8001/docs` | Interactive API reference |
| n8n | `http://127.0.0.1:5678` | Optional automation editor |

Port `8001` on the host maps to port `8000` inside the application container. Change the host port with `ASPAN_API_PORT` if another process already uses `8001`.

### 3. Verify Startup

```powershell
docker compose ps
Invoke-RestMethod http://127.0.0.1:8001/health
```

The health response should be:

```json
{"status":"ok"}
```

The `app` service should report `healthy`. The first build takes longer because Docker installs Python and Node dependencies. Later builds reuse cached layers.

### 4. Open the Application

Open `http://127.0.0.1:3000` and follow the workflow in [Using the Application](#using-the-application).

### 5. Stop or Restart

```powershell
# Stop containers and keep persistent volumes
docker compose down

# Start them again
docker compose up -d

# Restart only the application
docker compose restart app
```

The bind-mounted `cache/`, `logs/`, and `outputs/` directories remain on the host. The named `n8n_data` volume preserves the n8n account and workflow state.

## Supabase Setup

Supabase is optional for calculation and proposal generation. It is required for Dashboard and History, document storage, generated-file storage, and loading previous runs into the workspace.

### 1. Create a Project

Create a hosted Supabase project and wait for database provisioning to finish.

### 2. Run the Schema

1. Open the Supabase SQL Editor.
2. Create a new query.
3. Paste the complete contents of [`supabase/schema.sql`](supabase/schema.sql).
4. Run the query once.

The schema creates:

- `clients`
- `proposal_runs`
- `documents`
- `proposal_outputs`
- private Storage bucket `aspan-documents`
- private Storage bucket `aspan-proposals`
- indexes for proposal-run relationships
- Row Level Security on application tables

The script uses `if not exists` and conflict-safe bucket creation, so rerunning it does not recreate existing objects.

### 3. Configure Server Credentials

Copy the project URL and a server-side secret or service-role key into `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your_server_side_key
```

The FastAPI service uses this key. Never expose it through a `NEXT_PUBLIC_` variable or place it in `frontend/.env.local`.

### 4. Restart the Application

```powershell
docker compose up -d --force-recreate app
```

Generate one proposal, then open Dashboard and History. The run should contain its reviewed inputs, calculation snapshot, uploaded documents, and generated PPTX.

### Storage Behavior

The backend uploads source files and generated presentations to private buckets. Database rows store bucket names and object paths. History downloads pass through FastAPI, so the browser does not receive the server-side Supabase credential.

If you change the bucket names in `.env`, create matching private buckets or update `supabase/schema.sql` before running it.

## Environment Configuration

`.env.example` contains every runtime setting used by Docker Compose and the backend.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | For AI processing | none | Server-side Anthropic credential |
| `ANTHROPIC_VISION_MODEL` | No | `claude-sonnet-4-6` | Bill and client-document extraction model |
| `ANTHROPIC_TEXT_MODEL` | No | `claude-sonnet-4-6` | Proposal narrative model |
| `SUPABASE_URL` | For persistence | none | Hosted Supabase project URL |
| `SUPABASE_SECRET_KEY` | For persistence | none | Server-side Supabase secret or service-role key |
| `SUPABASE_DOCUMENT_BUCKET` | No | `aspan-documents` | Source-document bucket |
| `SUPABASE_PROPOSAL_BUCKET` | No | `aspan-proposals` | Generated-presentation bucket |
| `ASPAN_API_PORT` | No | `8001` | FastAPI host port in Docker |
| `EXTRACTION_CACHE_DIR` | No | `cache/extractions` | Content-addressed model-output cache |
| `BILL_EXTRACTION_MAX_WORKERS` | No | `3` | Maximum concurrent monthly bill extractions |
| `NARRATIVE_MAX_ATTEMPTS` | No | `1` | Application-level narrative attempts |
| `ANTHROPIC_SDK_MAX_RETRIES` | No | `1` | SDK retries for transient Anthropic errors |
| `PREWARM_PROPOSAL_NARRATIVE` | No | `true` | Prepares narrative after economics calculation |
| `N8N_PORT` | No | `5678` | n8n host port |
| `N8N_IMAGE` | No | `docker.n8n.io/n8nio/n8n:2.26.8` | Tested n8n image |
| `N8N_EDITOR_BASE_URL` | No | `http://127.0.0.1:5678` | n8n editor URL |
| `N8N_WEBHOOK_URL` | No | `http://127.0.0.1:5678/` | Base URL used for webhook registration |
| `GENERIC_TIMEZONE` | No | `UTC` | n8n and container timezone |

### Behavior Without External Services

- Without `ANTHROPIC_API_KEY`, extraction returns low-confidence fallback data and the narrative uses deterministic fallback text. Review all fallback values before client use.
- Without Supabase configuration, extraction, calculation, and generation still work. History and cloud file persistence remain unavailable.
- Without NASA POWER access, the calculation engine uses the configured specific-yield fallback and adds a warning.

## Using the Application

### 1. Extract Utility Bills

Upload one or more monthly bills in the Utility Bills section and select **Extract bills**.

For each bill, the extractor attempts to identify:

- monthly active consumption in kWh
- total amount due
- currency
- billing-period start and end
- weighted or direct energy tariff
- time-of-use periods
- active-energy charges
- penalties
- taxes and fees
- fixed or demand charges
- field-level confidence
- extraction notes

The application processes monthly bills concurrently and preserves their input order. It calculates representative combined values for the economics model while keeping individual monthly records available for review.

### 2. Extract Client Information

Upload client reports, business descriptions, technical assessments, presentations, screenshots, or images and select **Extract client info**.

The extractor returns:

- client name
- industry
- country and city
- coordinates
- business description
- diesel-generator presence
- grid connection capacity
- available roof area
- optional daytime-fraction override
- optional PPA-tariff override
- optional diesel-price override
- confidence and extraction notes

For documents with embedded PDF or PPTX text, the backend extracts text locally before calling the model. It uses multimodal document input for scans and images.

### 3. Review Extracted Values

Review every required value before calculation. Low-confidence fields and extraction notes identify uncertainty. The forms remain editable because site reports, invoices, and older commercial documents can conflict.

The **Daytime fraction** field is an optional override. Leave it empty to use the configured industry value:

| Industry | Daytime fraction |
| --- | --- |
| Manufacturing | `0.75` |
| Cold storage | `0.85` |
| Food processing | `0.75` |
| Retail | `0.65` |
| Hospitality | `0.60` |
| Default | `0.70` |

A value of `0.75` means the model treats 75% of monthly consumption as occurring during solar-producing hours.

### 4. Calculate Economics

Select **Calculate Economics** after reviewing bill and client values. The result shows:

- recommended PV capacity in kWp
- binding sizing constraint
- annual solar production in kWh
- PPA tariff per kWh
- Grid Replacement savings
- Grid + Diesel savings
- first-year and cumulative values
- warnings and assumptions

This step also prepares the proposal narrative in a background worker when `PREWARM_PROPOSAL_NARRATIVE=true`. Reviewing the economics gives that worker time to finish before proposal generation.

### 5. Generate the Proposal

Select **Generate Proposal** to download the editable PPTX. The presentation includes:

1. Cover and headline commercial values
2. Executive summary
3. Current energy situation
4. Proposed solar solution
5. PPA model explanation
6. Grid Replacement analysis
7. Grid + Diesel analysis
8. Scenario comparison chart
9. Market context and proposal basis
10. Delivery plan and next steps
11. Assumptions appendix

The PowerPoint builder enables text wrapping, bounds long client descriptions, uses readable body sizes, splits dense assumptions into columns, and labels chart units.

### 6. Use Dashboard and History

Dashboard and History lists persisted proposal runs. Open a run to:

- inspect extracted bill and client values
- review calculation results and warnings
- download original source documents
- download generated proposals
- load the run into the current workspace
- edit, recalculate, and regenerate the proposal

## Calculation Method

All engineering and financial calculations live in `core/calc_engine.py`. The language model does not calculate proposal values.

### Daytime Consumption

```text
daytime monthly consumption = monthly kWh x daytime fraction
annual daytime consumption = daytime monthly consumption x 12
```

The engine uses the reviewed override when present. Otherwise, it reads the industry fraction from `config.yaml`.

### PV Sizing

The engine calculates available sizing constraints:

```text
consumption-limited kWp = annual daytime kWh / specific yield
roof-limited kWp = available roof area x kWp per m2
grid-limited kWp = grid capacity kVA x permitted solar fraction
```

The minimum available constraint becomes the recommendation. Consumption always participates. Missing roof or grid values trigger documented fallback or exclusion behavior and produce warnings.

### Solar Production

When coordinates and NASA POWER are available:

```text
annual production = recommended kWp x annual irradiance x performance ratio
```

The engine caches NASA POWER responses by rounded coordinates. If NASA POWER fails, it uses:

```text
annual production = recommended kWp x default specific yield
```

### PPA Tariff

The engine chooses the tariff in this order:

1. Reviewed client override
2. Configured fixed default
3. Grid tariff reduced by the configured PPA discount

### Grid Replacement Scenario

The engine limits solar use to the lower of annual production and annual daytime consumption. Each year applies panel degradation to solar output and tariff escalation to the grid tariff.

```text
yearly savings = degraded solar used x (escalated grid tariff - PPA tariff)
```

### Grid + Diesel Scenario

```text
diesel cost per kWh = diesel price per liter / diesel kWh per liter
blended baseline = 50% grid cost + 50% diesel cost
yearly savings = degraded solar used x (escalated blended baseline - PPA tariff)
```

The 50/50 baseline is a V1 assumption. Confirm it against operating records before client use.

### Main Calculation Configuration

Edit `config.yaml` to change calculation assumptions:

| Setting | Current value | Meaning |
| --- | ---: | --- |
| `analysis_horizon_years` | `15` | Financial analysis period |
| `kwp_per_m2` | `0.15` | Roof-area conversion factor |
| `grid_capacity_solar_fraction` | `0.70` | Maximum solar capacity relative to grid kVA |
| `daytime_fraction_default` | `0.70` | Fallback daytime load share |
| `default_specific_yield_kwh_per_kwp` | `1450` | Production fallback |
| `performance_ratio` | `0.80` | Irradiance-to-production adjustment |
| `panel_degradation_rate` | `0.005` | Annual production degradation |
| `tariff_escalation_rate` | `0.03` | Annual baseline-cost escalation |
| `ppa_discount_to_grid_tariff` | `0.15` | PPA discount when no fixed tariff is configured |
| `diesel_kwh_per_liter` | `3.5` | Generator conversion assumption |

Restart the app after changing `config.yaml`. Treat all configuration values as assumptions that require commercial and engineering approval.

## Extraction and Generation

### Bill Extraction

The bill prompt includes French utility terminology and CIE-style time-of-use structures. It distinguishes active energy from reactive energy, penalties, taxes, and fixed charges. It calculates a weighted active-energy tariff when period consumption and unit prices are available.

Each bill passes through this sequence:

1. Compute a content hash from the uploaded bytes and model name.
2. Return a validated cache entry when available.
3. Send the document to Anthropic when the cache misses.
4. Parse the JSON object.
5. Validate it as `BillData` with Pydantic.
6. Store the validated result in the extraction cache.
7. Aggregate monthly records into `BillExtractionResult`.

### Client Extraction

The client extractor processes embedded text from PDFs and presentations locally. It sends image-only material as multimodal content. Its prompt prefers technical reports over marketing summaries when sources conflict.

### Narrative Grounding

The proposal writer receives:

- reviewed bill data
- reviewed client data
- deterministic calculation results
- approved facts from `knowledge_base/`
- an optional style reference
- the required output schema

The prompt prohibits arithmetic, unsupported terms, and invented Aspan claims. After generation, the backend compares numbers in the prose against authorized input and calculation values. It removes sentences containing unauthorized figures.

### Caching and Concurrency

- Bill extraction uses up to `BILL_EXTRACTION_MAX_WORKERS` concurrent workers.
- Client-document preprocessing runs concurrently for multiple files.
- Anthropic requests share one connection pool.
- Extraction cache keys include file content, cache version, and model.
- Narrative cache keys include the complete grounded payload and text model.
- Identical files and unchanged proposals reuse validated results.
- Narrative prewarming starts after economics calculation.
- A single-flight lock prevents duplicate narrative requests for the same payload.

Delete only the relevant files under `cache/extractions/` when you intentionally need to invalidate local model output. Cache-version changes in code invalidate old entries without manual deletion.

## Persistence and History

One proposal run groups the complete workflow. The frontend creates a run identifier before extraction and sends it through subsequent operations.

| Table | Stored data |
| --- | --- |
| `clients` | Client identity and background |
| `proposal_runs` | Bill JSON, client JSON, calculation JSON, status, and warnings |
| `documents` | Source-document metadata, Storage path, type, and extraction JSON |
| `proposal_outputs` | Generated PowerPoint metadata and Storage path |

Supabase writes run in a background executor so cloud persistence does not block extraction and generation responses. A brief delay can occur before a completed run appears in History.

Local operation also writes:

- generated files to `outputs/`
- proposal JSONL records to `logs/proposal_runs.jsonl`
- extraction and NASA POWER caches to `cache/`
- temporary staged uploads under `cache/pending_uploads/`

## n8n Automation

Docker Compose starts the tested n8n image and imports `automation/aspan_proposal_workflow.json` during the first startup of a new n8n volume.

### First-Time Setup

1. Open `http://127.0.0.1:5678`.
2. Create the local n8n owner account.
3. Open **Aspan Proposal Engine - Document Workflow**.
4. Review the nodes and activate the workflow.

The workflow:

1. Receives a bill document and a client document.
2. Sends both categories to FastAPI for parallel extraction.
3. Validates the required client fields.
4. Generates the proposal with the same run identifier.
5. Returns the PPTX while Supabase stores the run.

Test the active webhook from PowerShell:

```powershell
curl.exe -X POST "http://127.0.0.1:5678/webhook/aspan-proposal" `
  -F "bill_files=@test/Utility bills/2025.09.pdf" `
  -F "client_files=@test/Neskao business description.pdf" `
  --output aspan-n8n-proposal.pptx
```

The V1 workflow accepts one multipart document per category. Use the React workspace when you need several monthly bills, several client documents, field review, manual corrections, economics inspection, or History restoration.

If the workflow file changes after n8n has already initialized its volume, import the updated JSON through the n8n editor. The startup script does not overwrite an existing imported workflow.

## Local Development

Use local development when changing Python or frontend code without rebuilding Docker.

### Prerequisites

- Python 3.12
- Node.js 22 and npm
- PowerShell on Windows, or equivalent commands on Linux/macOS

### Python Setup

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Create `.env` as described in [Environment Configuration](#environment-configuration).

### Frontend Setup

```powershell
cd frontend
npm.cmd install
Copy-Item .env.example .env.local
cd ..
```

`frontend/.env.local` should contain:

```env
API_INTERNAL_BASE_URL=http://127.0.0.1:8001
```

### Start FastAPI

Terminal 1:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8001
```

### Start Next.js

Terminal 2:

```powershell
cd frontend
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000`.

Next.js sends browser requests through its same-origin `/api` route handler and forwards them to `API_INTERNAL_BASE_URL`. This avoids browser CORS and multipart rewrite problems.

### Streamlit Debug UI

The older Streamlit surface remains available for backend debugging:

```powershell
.\.venv\Scripts\streamlit.exe run ui/app.py
```

Use the React workspace for the supported application workflow.

## Testing and PowerPoint QA

### Backend Tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q --basetemp=.pytest-tmp
```

The explicit temporary directory avoids common Windows permission failures in the global temporary directory.

### Frontend Type Check

```powershell
cd frontend
npm.cmd run typecheck
```

Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1` through its execution policy.

### Production Frontend Build

```powershell
cd frontend
npm.cmd run build
```

### PowerPoint QA

```powershell
.\.venv\Scripts\python.exe scripts\qa_pptx.py outputs\your_generated_proposal.pptx
```

The QA script checks:

- slide count and minimum text density
- absence of `TODO` and `TBD`
- presence of native PowerPoint charts
- chart titles and savings units

The PowerPoint-builder tests also require wrapping on long text frames. For final delivery, render or open the deck and inspect every slide because XML checks cannot detect every PowerPoint layout difference.

## Operations

### Common Docker Commands

```powershell
# Start all services
docker compose up -d

# Rebuild after source changes
docker compose up -d --build app

# Show service state and mapped ports
docker compose ps

# Follow application logs
docker compose logs -f app

# Follow n8n logs
docker compose logs -f n8n

# Restart one service
docker compose restart app

# Stop the stack
docker compose down
```

### Persistent Paths

| Path or volume | Purpose |
| --- | --- |
| `cache/` | Extraction cache, NASA POWER cache, and staged uploads |
| `outputs/` | Locally generated PPTX files |
| `logs/` | JSONL proposal audit log |
| `n8n_data` | n8n account, settings, credentials, and workflows |

`docker compose down` keeps these values. Removing the `n8n_data` volume erases the local n8n instance state.

### Updating the Application

After pulling or editing source code:

```powershell
docker compose build app
docker compose up -d app
docker compose ps
```

The application health check waits for FastAPI before n8n starts.

## Troubleshooting

### Port Already in Use

Symptoms include `WinError 10048` or `EADDRINUSE`.

Check the listening process:

```powershell
Get-NetTCPConnection -LocalPort 3000,8001,5678 -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess,State
```

Change the API or n8n host port in `.env`:

```env
ASPAN_API_PORT=8002
N8N_PORT=5679
```

Port `3000` is currently fixed in `docker-compose.yml`. Stop the process using it or change the frontend port mapping and editor URL together.

### `ANTHROPIC_API_KEY not set`

Confirm `.env` exists in the project root and contains a value without accidental placeholder text. Recreate the app after changing environment values:

```powershell
docker compose up -d --force-recreate app
```

Do not place the key only in `frontend/.env.local`; FastAPI requires it.

### Extraction Returns Internal Server Error

Check application logs:

```powershell
docker compose logs --tail 150 app
```

Common causes:

- invalid or unavailable Anthropic model name
- expired or rate-limited Anthropic key
- unsupported or corrupt document
- document larger than the model request limit
- container started before `.env` was updated

Retry one document at a time to isolate a corrupt file. Cached successful documents do not require another model call.

### Method Not Allowed

Use the React application at port `3000` and confirm the app container is current:

```powershell
docker compose up -d --build app
```

The Next.js route handler supports the upload methods used by the workspace. A stale frontend image or a request sent to the wrong path can return `405 Method Not Allowed`.

### History Is Empty

1. Confirm `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env`.
2. Run `supabase/schema.sql` in the correct Supabase project.
3. Confirm both Storage buckets exist and remain private.
4. Generate a new proposal.
5. Wait briefly for background persistence and refresh History.
6. Inspect `docker compose logs app` for Supabase errors.

### Generated File Is Missing From History

Local PPTX generation can succeed while Supabase upload fails. Confirm that the file exists under `outputs/`, then check the proposal bucket, server credentials, bucket name, and logs.

### PowerPoint Text Overlap or Overflow

Regenerate the proposal with the current application image:

```powershell
docker compose up -d --build app
```

Previously generated files do not change when the builder is updated. Run PPTX QA and inspect the regenerated deck in PowerPoint. Long text now wraps, client descriptions are bounded, delivery columns remain independent, and assumptions use a two-column layout.

### Slow Extraction

- The first extraction requires an Anthropic model call.
- Uploading unchanged documents reuses the content cache.
- Several bills run concurrently up to `BILL_EXTRACTION_MAX_WORKERS`.
- Lower that value when rate limits cause retries; raise it cautiously when the account supports more concurrency.
- Scanned pages take longer than embedded-text PDFs.

### Slow Proposal Generation

Calculate economics before generating the proposal. Narrative prewarming begins during the review step. An unchanged payload reuses the narrative cache. Fresh Sonnet generation remains dependent on model latency.

### Windows Pytest Permission Error

Use:

```powershell
.\.venv\Scripts\python.exe -m pytest -q --basetemp=.pytest-tmp
```

### PowerShell Blocks npm

Run `npm.cmd` instead of `npm`:

```powershell
npm.cmd run typecheck
```

## Security and Limitations

### Security Rules

- Keep `.env` out of version control.
- Keep Anthropic and Supabase server credentials in FastAPI only.
- Never add server secrets to `NEXT_PUBLIC_*` variables.
- Keep Supabase document and proposal buckets private.
- Rotate credentials if terminal output, screenshots, or recordings expose them.
- Review uploaded documents according to client confidentiality requirements.

### Current Limitations

- Human review remains mandatory before client delivery.
- Extraction accuracy depends on scan quality, language, document structure, and model availability.
- The Grid + Diesel scenario uses a fixed 50/50 blended baseline in V1.
- Missing roof area uses a conservative configured fallback.
- Missing grid capacity is excluded from the minimum sizing constraints.
- Country default coordinates can replace missing site coordinates.
- NASA POWER uses a cached 2022 monthly irradiance request for preliminary production estimates.
- The approved knowledge base is injected directly; V1 does not use vector retrieval or a large proposal library.
- n8n accepts one bill field and one client-document field per automated request.
- The application has no user authentication or multi-tenant authorization layer.
- Generated proposals require final engineering, legal, and commercial approval.

## Project Structure

```text
api/                  FastAPI application and orchestration
automation/           n8n workflow export and startup script
core/                 Models, extraction, calculations, narrative, PPTX, and persistence
frontend/             Next.js and React workspace
knowledge_base/       Approved Aspan, country, and industry facts
reference_materials/  Optional proposal style references
scripts/              Container startup, sample generation, and PPTX QA
supabase/             Database and Storage schema
templates/            Editable PowerPoint template
tests/                Backend, calculation, workflow, cache, narrative, and PPTX tests
ui/                   Streamlit debugging surface
cache/                Local extraction and NASA POWER caches
logs/                 JSONL proposal audit log
outputs/              Generated PowerPoint files
config.yaml           Engineering and financial assumptions
docker-compose.yml    Application and n8n services
Dockerfile            Production application image
```

## Sample Output

Generated proposals appear under `outputs/`. Keep final sample proposals outside the repository, for example in the delivery folder shared with reviewers. Regenerate the sample after calculation, narrative, or PowerPoint-builder changes so it reflects the current code.

Create a deterministic sample with:

```powershell
.\.venv\Scripts\python.exe scripts\generate_sample.py
```

Run PowerPoint QA on the resulting file before using it as a submission artifact.
