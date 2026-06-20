from __future__ import annotations

import logging
import mimetypes
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel

from core.models import BillData, BillExtractionResult, CalcResult, ClientInfo, ClientInfoDraft, ProposalResponse
from core.utils import load_local_env, safe_slug

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StoredObject:
    bucket: str
    path: str
    file_name: str


def _jsonable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    return value


def _safe_storage_name(file_path: str | Path) -> str:
    path = Path(file_path)
    stem = safe_slug(path.stem)
    suffix = path.suffix.lower()
    return f"{stem}{suffix}"


class SupabaseStore:
    def __init__(
        self,
        url: str,
        key: str,
        document_bucket: str,
        proposal_bucket: str,
    ) -> None:
        from supabase import create_client

        self.client = create_client(url, key)
        self.document_bucket = document_bucket
        self.proposal_bucket = proposal_bucket

    def create_proposal_run(self, status: str = "draft") -> str:
        result = self.client.table("proposal_runs").insert({"status": status}).execute()
        return result.data[0]["id"]

    def insert_client(self, client: ClientInfo) -> str:
        result = (
            self.client.table("clients")
            .insert(
                {
                    "client_name": client.client_name,
                    "industry": client.industry,
                    "country": client.country,
                    "city": client.city,
                    "business_description": client.business_description,
                }
            )
            .execute()
        )
        return result.data[0]["id"]

    def update_proposal_run(
        self,
        run_id: str,
        *,
        client_id: str | None = None,
        status: str | None = None,
        bill: BillData | BillExtractionResult | None = None,
        client: ClientInfo | ClientInfoDraft | None = None,
        calc: CalcResult | None = None,
        response: ProposalResponse | None = None,
        warnings: list[str] | None = None,
    ) -> None:
        payload: dict[str, Any] = {}
        if client_id is not None:
            payload["client_id"] = client_id
        if status is not None:
            payload["status"] = status
        if bill is not None:
            payload["bill_json"] = _jsonable(bill)
        if client is not None:
            payload["client_json"] = _jsonable(client)
        if calc is not None:
            payload["calc_json"] = _jsonable(calc)
        if response is not None:
            payload["calc_json"] = _jsonable(response.calc_result)
            payload["warnings"] = _jsonable(response.warnings)
        if warnings is not None:
            payload["warnings"] = _jsonable(warnings)
        if payload:
            self.client.table("proposal_runs").update(payload).eq("id", run_id).execute()

    def upload_document(self, run_id: str, kind: str, file_path: str | Path) -> StoredObject:
        path = Path(file_path)
        storage_path = f"{run_id}/documents/{safe_slug(kind)}/{uuid4().hex}-{_safe_storage_name(path)}"
        self._upload_file(self.document_bucket, storage_path, path)
        return StoredObject(bucket=self.document_bucket, path=storage_path, file_name=path.name)

    def upload_proposal(self, run_id: str, file_path: str | Path) -> StoredObject:
        path = Path(file_path)
        storage_path = f"{run_id}/proposals/{uuid4().hex}-{_safe_storage_name(path)}"
        self._upload_file(self.proposal_bucket, storage_path, path)
        return StoredObject(bucket=self.proposal_bucket, path=storage_path, file_name=path.name)

    def insert_document(
        self,
        run_id: str,
        kind: str,
        stored: StoredObject,
        extraction_json: Any | None = None,
    ) -> None:
        self.client.table("documents").insert(
            {
                "proposal_run_id": run_id,
                "kind": kind,
                "file_name": stored.file_name,
                "storage_bucket": stored.bucket,
                "storage_path": stored.path,
                "extraction_json": _jsonable(extraction_json),
            }
        ).execute()

    def insert_proposal_output(self, run_id: str, stored: StoredObject) -> None:
        self.client.table("proposal_outputs").insert(
            {
                "proposal_run_id": run_id,
                "storage_bucket": stored.bucket,
                "storage_path": stored.path,
                "file_name": stored.file_name,
            }
        ).execute()

    def list_proposal_runs(self, limit: int = 25) -> list[dict[str, Any]]:
        result = (
            self.client.table("proposal_runs")
            .select(
                "id,status,created_at,bill_json,client_json,calc_json,warnings,"
                "clients(client_name,industry,country,city)"
            )
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        runs = list(result.data or [])
        run_ids = [run["id"] for run in runs if run.get("id")]
        if not run_ids:
            return runs

        documents_result = (
            self.client.table("documents")
            .select("id,proposal_run_id,kind,file_name,storage_bucket,storage_path,extraction_json,created_at")
            .in_("proposal_run_id", run_ids)
            .order("created_at", desc=False)
            .execute()
        )
        outputs_result = (
            self.client.table("proposal_outputs")
            .select("id,proposal_run_id,storage_bucket,storage_path,file_name,created_at")
            .in_("proposal_run_id", run_ids)
            .order("created_at", desc=False)
            .execute()
        )

        documents_by_run: dict[str, list[dict[str, Any]]] = {run_id: [] for run_id in run_ids}
        for document in documents_result.data or []:
            documents_by_run.setdefault(document["proposal_run_id"], []).append(document)

        outputs_by_run: dict[str, list[dict[str, Any]]] = {run_id: [] for run_id in run_ids}
        for output in outputs_result.data or []:
            outputs_by_run.setdefault(output["proposal_run_id"], []).append(output)

        for run in runs:
            run_id = run.get("id")
            run["documents"] = documents_by_run.get(run_id, [])
            run["proposal_outputs"] = outputs_by_run.get(run_id, [])
        return runs

    def get_stored_file(self, table: str, run_id: str, file_id: str) -> dict[str, Any] | None:
        if table not in {"documents", "proposal_outputs"}:
            raise ValueError(f"Unsupported storage table: {table}")

        result = (
            self.client.table(table)
            .select("id,proposal_run_id,storage_bucket,storage_path,file_name")
            .eq("id", file_id)
            .eq("proposal_run_id", run_id)
            .limit(1)
            .execute()
        )
        rows = list(result.data or [])
        return rows[0] if rows else None

    def download_stored_file(self, table: str, run_id: str, file_id: str) -> tuple[bytes, str, str] | None:
        stored_file = self.get_stored_file(table, run_id, file_id)
        if not stored_file:
            return None

        raw_content = self.client.storage.from_(stored_file["storage_bucket"]).download(stored_file["storage_path"])
        if isinstance(raw_content, bytes):
            content = raw_content
        elif isinstance(raw_content, bytearray):
            content = bytes(raw_content)
        elif hasattr(raw_content, "content"):
            content = bytes(raw_content.content)
        elif hasattr(raw_content, "read"):
            content = bytes(raw_content.read())
        else:
            content = bytes(raw_content)

        file_name = str(stored_file["file_name"])
        content_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
        return content, file_name, content_type

    def _upload_file(self, bucket: str, storage_path: str, file_path: Path) -> None:
        content_type = mimetypes.guess_type(file_path.name)[0]
        file_options = {"content-type": content_type} if content_type else None
        self.client.storage.from_(bucket).upload(storage_path, file_path, file_options=file_options)


def get_supabase_store() -> SupabaseStore | None:
    load_local_env()
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    document_bucket = os.getenv("SUPABASE_DOCUMENT_BUCKET")
    proposal_bucket = os.getenv("SUPABASE_PROPOSAL_BUCKET")

    if not all([url, key, document_bucket, proposal_bucket]):
        return None

    try:
        return SupabaseStore(
            url=str(url),
            key=str(key),
            document_bucket=str(document_bucket),
            proposal_bucket=str(proposal_bucket),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Supabase disabled: %s", exc)
        return None


def safe_create_run(store: SupabaseStore | None, existing_run_id: str | None = None) -> str | None:
    if store is None:
        return None
    if existing_run_id:
        return existing_run_id
    try:
        return store.create_proposal_run()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not create Supabase proposal run: %s", exc)
        return None


def safe_update_run(store: SupabaseStore | None, run_id: str | None, **kwargs: Any) -> None:
    if store is None or run_id is None:
        return
    try:
        store.update_proposal_run(run_id, **kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not update Supabase proposal run %s: %s", run_id, exc)


def safe_insert_client(store: SupabaseStore | None, client: ClientInfo) -> str | None:
    if store is None:
        return None
    try:
        return store.insert_client(client)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not insert Supabase client %s: %s", client.client_name, exc)
        return None


def safe_store_documents(
    store: SupabaseStore | None,
    run_id: str | None,
    file_paths: list[str],
    kind: str,
    extractions_by_file: dict[str, Any] | None = None,
) -> None:
    if store is None or run_id is None:
        return

    for file_path in file_paths:
        try:
            stored = store.upload_document(run_id, kind, file_path)
            extraction_json = (extractions_by_file or {}).get(Path(file_path).name)
            store.insert_document(run_id, kind, stored, extraction_json)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not persist Supabase document %s: %s", file_path, exc)


def safe_store_proposal_output(
    store: SupabaseStore | None,
    run_id: str | None,
    file_path: str | Path,
) -> None:
    if store is None or run_id is None:
        return

    try:
        stored = store.upload_proposal(run_id, file_path)
        store.insert_proposal_output(run_id, stored)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not persist Supabase proposal output %s: %s", file_path, exc)


def safe_list_proposal_runs(store: SupabaseStore | None, limit: int = 25) -> list[dict[str, Any]]:
    if store is None:
        return []

    try:
        return store.list_proposal_runs(limit=limit)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not list Supabase proposal runs: %s", exc)
        return []


def safe_download_stored_file(
    store: SupabaseStore | None,
    table: str,
    run_id: str,
    file_id: str,
) -> tuple[bytes, str, str] | None:
    if store is None:
        return None

    try:
        return store.download_stored_file(table, run_id, file_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not download stored file %s/%s: %s", table, file_id, exc)
        return None
