from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from core.calc_engine import calculate_proposal
from core.client_extraction import extract_client_info
from core.config_loader import load_config
from core.extraction import extract_bill_collection
from core.models import BillData, BillExtractionResult, CalcResult, ClientInfoDraft, ProposalRequest
from core.pipeline import generate_proposal_artifacts
from core.supabase_store import (
    get_supabase_store,
    safe_create_run,
    safe_insert_client,
    safe_store_documents,
    safe_store_proposal_output,
    safe_update_run,
)

app = FastAPI(title="Proposal Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Proposal-Run-Id"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _save_uploads(files: list[UploadFile], temp_dir: str) -> list[str]:
    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one file.")

    saved_paths: list[str] = []
    for file in files:
        if not file.filename:
            continue
        target = Path(temp_dir) / Path(file.filename).name
        with target.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)
        saved_paths.append(str(target))

    if not saved_paths:
        raise HTTPException(status_code=400, detail="Uploaded files were empty or unnamed.")
    return saved_paths


def _set_run_header(response: Response, run_id: str | None) -> None:
    if run_id:
        response.headers["X-Proposal-Run-Id"] = run_id


def _bill_extractions_by_file(result: BillExtractionResult) -> dict[str, BillData]:
    return {
        bill.source_file: bill
        for bill in result.bills
        if bill.source_file
    }


@app.post("/extract-bill", response_model=BillData)
async def extract_bill_endpoint(
    response: Response,
    files: list[UploadFile] = File(...),
    x_proposal_run_id: str | None = Header(default=None, alias="X-Proposal-Run-Id"),
):
    config = load_config()
    store = get_supabase_store()
    run_id = safe_create_run(store, x_proposal_run_id)
    _set_run_header(response, run_id)

    with tempfile.TemporaryDirectory() as temp_dir:
        saved_paths = _save_uploads(files, temp_dir)
        result = extract_bill_collection(saved_paths, config)
        bill = result.combined_bill
        safe_store_documents(store, run_id, saved_paths, "utility_bill", _bill_extractions_by_file(result))
        safe_update_run(store, run_id, bill=result, warnings=result.warnings)
    return bill


@app.post("/extract-bill-collection", response_model=BillExtractionResult)
async def extract_bill_collection_endpoint(
    response: Response,
    files: list[UploadFile] = File(...),
    x_proposal_run_id: str | None = Header(default=None, alias="X-Proposal-Run-Id"),
):
    config = load_config()
    store = get_supabase_store()
    run_id = safe_create_run(store, x_proposal_run_id)
    _set_run_header(response, run_id)

    with tempfile.TemporaryDirectory() as temp_dir:
        saved_paths = _save_uploads(files, temp_dir)
        result = extract_bill_collection(saved_paths, config)
        safe_store_documents(store, run_id, saved_paths, "utility_bill", _bill_extractions_by_file(result))
        safe_update_run(store, run_id, bill=result, warnings=result.warnings)
    return result


@app.post("/extract-client-info", response_model=ClientInfoDraft)
async def extract_client_info_endpoint(
    response: Response,
    files: list[UploadFile] = File(...),
    x_proposal_run_id: str | None = Header(default=None, alias="X-Proposal-Run-Id"),
):
    config = load_config()
    store = get_supabase_store()
    run_id = safe_create_run(store, x_proposal_run_id)
    _set_run_header(response, run_id)

    with tempfile.TemporaryDirectory() as temp_dir:
        saved_paths = _save_uploads(files, temp_dir)
        draft = extract_client_info(saved_paths, config)
        extraction_by_file = {Path(path).name: draft for path in saved_paths}
        safe_store_documents(store, run_id, saved_paths, "client_information", extraction_by_file)
        safe_update_run(store, run_id, client=draft)
    return draft


@app.post("/calculate-preview", response_model=CalcResult)
def calculate_preview_endpoint(
    request: ProposalRequest,
    response: Response,
    x_proposal_run_id: str | None = Header(default=None, alias="X-Proposal-Run-Id"),
):
    config = load_config()
    store = get_supabase_store()
    run_id = safe_create_run(store, x_proposal_run_id)
    _set_run_header(response, run_id)

    try:
        calc = calculate_proposal(request.bill, request.client, config)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Calculation failed: {exc}") from exc
    safe_update_run(
        store,
        run_id,
        bill=request.bill,
        client=request.client,
        calc=calc,
        warnings=calc.warnings,
    )
    return calc


@app.post("/generate-proposal")
def generate_proposal_endpoint(
    request: ProposalRequest,
    x_proposal_run_id: str | None = Header(default=None, alias="X-Proposal-Run-Id"),
):
    config = load_config()
    store = get_supabase_store()
    run_id = safe_create_run(store, x_proposal_run_id)

    try:
        proposal_response = generate_proposal_artifacts(request.bill, request.client, config)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Proposal generation failed: {exc}") from exc

    path = Path(proposal_response.output_pptx_path)
    if not path.exists():
        raise HTTPException(status_code=500, detail="Proposal file was not created.")
    client_id = safe_insert_client(store, request.client)
    safe_update_run(
        store,
        run_id,
        client_id=client_id,
        status="generated",
        bill=request.bill,
        client=request.client,
        response=proposal_response,
    )
    safe_store_proposal_output(store, run_id, path)
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=path.name,
        headers={"X-Proposal-Run-Id": run_id} if run_id else None,
    )
