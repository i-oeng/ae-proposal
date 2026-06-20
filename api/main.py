from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
import shutil
import tempfile
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Header, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from core.calc_engine import calculate_proposal
from core.client_extraction import extract_client_info
from core.config_loader import load_config
from core.extraction import extract_bill_collection
from core.models import (
    BillData,
    BillExtractionResult,
    CalcResult,
    ClientInfoDraft,
    DocumentExtractionResult,
    ProposalRequest,
)
from core.pipeline import generate_proposal_artifacts
from core.supabase_store import (
    get_supabase_store,
    safe_create_run,
    safe_download_stored_file,
    safe_insert_client,
    safe_list_proposal_runs,
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
    expose_headers=["X-Proposal-Run-Id", "Content-Disposition"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/proposal-runs")
def proposal_runs_endpoint(limit: int = 25) -> dict[str, list[dict]]:
    store = get_supabase_store()
    normalized_limit = min(max(limit, 1), 100)
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(safe_list_proposal_runs, store, normalized_limit)
    try:
        return {"runs": future.result(timeout=4)}
    except FuturesTimeoutError:
        future.cancel()
        return {"runs": []}
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def _download_history_file(table: str, run_id: str, file_id: str) -> Response:
    store = get_supabase_store()
    if store is None:
        raise HTTPException(status_code=503, detail="Supabase persistence is not configured.")

    stored_file = safe_download_stored_file(store, table, run_id, file_id)
    if stored_file is None:
        raise HTTPException(status_code=404, detail="Stored file was not found.")

    content, file_name, content_type = stored_file
    fallback_name = "".join(character if character.isalnum() or character in "._-" else "_" for character in file_name)
    fallback_name = fallback_name or "download"
    return Response(
        content=content,
        media_type=content_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{fallback_name}"; filename*=UTF-8\'\'{quote(file_name)}'
            )
        },
    )


@app.get("/proposal-runs/{run_id}/documents/{document_id}/download")
def proposal_run_document_download_endpoint(run_id: str, document_id: str) -> Response:
    return _download_history_file("documents", run_id, document_id)


@app.get("/proposal-runs/{run_id}/proposal-outputs/{output_id}/download")
def proposal_run_output_download_endpoint(run_id: str, output_id: str) -> Response:
    return _download_history_file("proposal_outputs", run_id, output_id)


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


def _save_optional_uploads(files: list[UploadFile] | None, temp_dir: str, subdirectory: str) -> list[str]:
    if not files:
        return []

    target_dir = Path(temp_dir) / subdirectory
    target_dir.mkdir(parents=True, exist_ok=True)
    saved_paths: list[str] = []
    used_names: dict[str, int] = {}

    for file in files:
        if not file.filename:
            continue
        original_name = Path(file.filename).name
        count = used_names.get(original_name, 0)
        used_names[original_name] = count + 1
        safe_name = original_name
        if count:
            path = Path(original_name)
            safe_name = f"{path.stem}-{count}{path.suffix}"
        target = target_dir / safe_name
        with target.open("wb") as handle:
            shutil.copyfileobj(file.file, handle)
        saved_paths.append(str(target))

    return saved_paths


def _set_run_header(response: Response, run_id: str | None) -> None:
    if run_id:
        response.headers["X-Proposal-Run-Id"] = run_id


@app.post("/proposal-runs")
def create_proposal_run_endpoint(response: Response) -> dict[str, str | None]:
    run_id = safe_create_run(get_supabase_store())
    _set_run_header(response, run_id)
    return {"run_id": run_id}


def _bill_extractions_by_file(result: BillExtractionResult) -> dict[str, BillData]:
    return {
        bill.source_file: bill
        for bill in result.bills
        if bill.source_file
    }


@app.post("/extract-bill", response_model=BillData)
def extract_bill_endpoint(
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
def extract_bill_collection_endpoint(
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
def extract_client_info_endpoint(
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


@app.post("/extract-documents", response_model=DocumentExtractionResult)
def extract_documents_endpoint(
    response: Response,
    bill_files: list[UploadFile] | None = File(default=None),
    client_files: list[UploadFile] | None = File(default=None),
    x_proposal_run_id: str | None = Header(default=None, alias="X-Proposal-Run-Id"),
):
    config = load_config()
    store = get_supabase_store()
    run_id = safe_create_run(store, x_proposal_run_id)
    _set_run_header(response, run_id)

    with tempfile.TemporaryDirectory() as temp_dir:
        bill_paths = _save_optional_uploads(bill_files, temp_dir, "utility_bills")
        client_paths = _save_optional_uploads(client_files, temp_dir, "client_information")
        if not bill_paths and not client_paths:
            raise HTTPException(status_code=400, detail="Upload utility bills or client information files.")

        with ThreadPoolExecutor(max_workers=2) as executor:
            bill_future = executor.submit(extract_bill_collection, bill_paths, config) if bill_paths else None
            client_future = executor.submit(extract_client_info, client_paths, config) if client_paths else None
            bill_result = bill_future.result() if bill_future else None
            client_draft = client_future.result() if client_future else None

        warnings: list[str] = []

        if bill_result is not None:
            safe_store_documents(store, run_id, bill_paths, "utility_bill", _bill_extractions_by_file(bill_result))
            warnings.extend(bill_result.warnings)

        if client_draft is not None:
            extraction_by_file = {Path(path).name: client_draft for path in client_paths}
            safe_store_documents(store, run_id, client_paths, "client_information", extraction_by_file)

        safe_update_run(
            store,
            run_id,
            bill=bill_result,
            client=client_draft,
            warnings=warnings if warnings else None,
        )
        return DocumentExtractionResult(bill=bill_result, client=client_draft, warnings=warnings)


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
