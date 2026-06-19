from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from core.calc_engine import calculate_proposal
from core.client_extraction import extract_client_info
from core.config_loader import load_config
from core.extraction import extract_bill_collection, extract_multiple_bills
from core.models import BillData, BillExtractionResult, CalcResult, ClientInfoDraft, ProposalRequest
from core.pipeline import generate_proposal_artifacts

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


@app.post("/extract-bill", response_model=BillData)
async def extract_bill_endpoint(files: list[UploadFile] = File(...)):
    config = load_config()
    with tempfile.TemporaryDirectory() as temp_dir:
        saved_paths = _save_uploads(files, temp_dir)
        bill = extract_multiple_bills(saved_paths, config)
    return bill


@app.post("/extract-bill-collection", response_model=BillExtractionResult)
async def extract_bill_collection_endpoint(files: list[UploadFile] = File(...)):
    config = load_config()
    with tempfile.TemporaryDirectory() as temp_dir:
        saved_paths = _save_uploads(files, temp_dir)
        result = extract_bill_collection(saved_paths, config)
    return result


@app.post("/extract-client-info", response_model=ClientInfoDraft)
async def extract_client_info_endpoint(files: list[UploadFile] = File(...)):
    config = load_config()
    with tempfile.TemporaryDirectory() as temp_dir:
        saved_paths = _save_uploads(files, temp_dir)
        draft = extract_client_info(saved_paths, config)
    return draft


@app.post("/calculate-preview", response_model=CalcResult)
def calculate_preview_endpoint(request: ProposalRequest):
    config = load_config()
    try:
        return calculate_proposal(request.bill, request.client, config)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Calculation failed: {exc}") from exc


@app.post("/generate-proposal")
def generate_proposal_endpoint(request: ProposalRequest):
    config = load_config()
    try:
        response = generate_proposal_artifacts(request.bill, request.client, config)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Proposal generation failed: {exc}") from exc

    path = Path(response.output_pptx_path)
    if not path.exists():
        raise HTTPException(status_code=500, detail="Proposal file was not created.")
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=path.name,
    )
