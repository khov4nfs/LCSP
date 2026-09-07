from __future__ import annotations

from unittest.mock import Mock, MagicMock
from types import SimpleNamespace
from uuid import uuid4

from orchestration.context import LCSPRunContext
from tools.common import runtime_envelope
from tools.common.runtime_envelope import (
    dispatch_agentic_tool,
    TrustedAgenticToolRequest,
    set_agentic_tool_api_client,
)
from tools.common.search_program_graph import code as search_program_graph_code


def test_remote_cqrs_tool_posts_direct_agentic_tool_contract(monkeypatch) -> None:
    response = Mock(status_code=200)
    response.json.return_value = {"ok": True, "data": {"gapEvidence": []}}
    post = Mock(return_value=response)
    monkeypatch.setenv("NESTJS_API_BASE_URL", "http://api.test/")
    monkeypatch.setenv("WORKER_API_KEY", "worker-key")
    monkeypatch.setattr(runtime_envelope.httpx, "post", post)

    asmt_id = str(uuid4())
    wf_id = str(uuid4())
    req = TrustedAgenticToolRequest(
        assessment_id=asmt_id,
        user_id="user-1",
        workflow_run_id=wf_id,
        correlation_id=str(uuid4()),
        artifact_versions={"gapRowRef": "gap:test-row-1"},
        input={"rowRef": "gap:test-row-1"},
    )
    result = dispatch_agentic_tool("get_gap_evidence_trace", req)
    assert result == {"gapEvidence": []}
    assert post.called
    _, kwargs = post.call_args
    assert kwargs["headers"]["X-Worker-Api-Key"] == "worker-key"
    assert kwargs["json"]["tool_name"] == "get_gap_evidence_trace"


def test_python_local_tool_executes_locally_without_http_post(monkeypatch) -> None:
    post = Mock()
    monkeypatch.setenv("NESTJS_API_BASE_URL", "http://api.test/")
    monkeypatch.setenv("WORKER_API_KEY", "worker-key")
    monkeypatch.setattr(runtime_envelope.httpx, "post", post)

    asmt_id = str(uuid4())
    wf_id = str(uuid4())
    mock_api = MagicMock()
    mock_api.get_accepted_technical_evidence_report.return_value = {
        "assessmentId": asmt_id,
        "snapshotId": "snap-1",
        "status": "ACCEPTED",
        "evidence_payload": {
            "evidence_graph": {
                "graph_id": "graph:1",
                "schema_version": "2.0.0",
                "snapshot_id": "snap-1",
                "commit_sha": "abc1234",
                "node_count": 0,
                "edge_count": 0,
                "nodes": [],
                "edges": [],
                "source_anchors": [],
                "indexes": {},
                "unresolved_frontiers": [],
                "coverage_state": "SUFFICIENT",
                "coverage_notes": [],
                "provenance": {"producer": "scanner"},
                "evidence_refs": [],
                "graph_hash": "sha256:test",
            }
        },
    }
    mock_api.rbac_client.check.return_value = "allow"
    set_agentic_tool_api_client(mock_api)

    runtime = SimpleNamespace(
        context=LCSPRunContext(
            assessment_id=asmt_id,
            user_id="user-1",
            workflow_run_id=wf_id,
            artifact_versions={"technicalEvidenceReportId": "report-1", "repositorySnapshotId": "snap-1"},
        )
    )
    result = search_program_graph_code.search_program_graph.func(
        runtime=runtime,
        maxResults=10,
    )
    assert "nodes" in result
    assert not post.called
    set_agentic_tool_api_client(None)
