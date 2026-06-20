from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ROOT / "automation" / "aspan_proposal_workflow.json"


def _workflow() -> dict:
    return json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))


def _node(workflow: dict, name: str) -> dict:
    return next(node for node in workflow["nodes"] if node["name"] == name)


def test_n8n_workflow_uses_full_document_extraction_contract() -> None:
    workflow = _workflow()
    webhook = _node(workflow, "Proposal Webhook")
    extraction = _node(workflow, "Extract Bill and Client Documents")

    assert workflow["id"]
    assert webhook["parameters"]["responseMode"] == "responseNode"
    assert "/extract-documents" in extraction["parameters"]["url"]

    form_parameters = extraction["parameters"]["bodyParameters"]["parameters"]
    binary_fields = {
        (parameter["name"], parameter["inputDataFieldName"])
        for parameter in form_parameters
        if parameter.get("parameterType") == "formBinaryData"
    }
    assert binary_fields == {
        ("bill_files", "bill_files"),
        ("client_files", "client_files"),
    }
    response_options = extraction["parameters"]["options"]["response"]["response"]
    assert response_options["fullResponse"] is True


def test_n8n_workflow_reuses_extraction_run_for_generation() -> None:
    workflow = _workflow()
    preparation = _node(workflow, "Validate and Prepare Proposal")
    generation = _node(workflow, "Generate Proposal PPTX")

    code = preparation["parameters"]["jsCode"]
    assert "combined_bill" in code
    assert "x-proposal-run-id" in code
    assert "client_name" in code

    assert "/generate-proposal" in generation["parameters"]["url"]
    headers = generation["parameters"]["headerParameters"]["parameters"]
    assert {
        (header["name"], header["value"])
        for header in headers
    } == {("X-Proposal-Run-Id", "={{ $json.proposal_run_id }}")}


def test_n8n_workflow_connections_reference_existing_nodes() -> None:
    workflow = _workflow()
    node_names = {node["name"] for node in workflow["nodes"]}

    assert set(workflow["connections"]) <= node_names
    for outputs in workflow["connections"].values():
        for branch in outputs.get("main", []):
            for connection in branch:
                assert connection["node"] in node_names

    assert "Return PPTX" in node_names
    assert workflow["active"] is False
