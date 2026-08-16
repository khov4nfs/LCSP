from __future__ import annotations
from unittest.mock import MagicMock
from uuid import uuid4
from lcsp_workers.agentic_evidence.registry import AgenticToolRequest, build_sprint6_agentic_registry
from lcsp_workers.agentic_evidence.runtime_binding import bind_runtime_handlers


def _graph(): return {"graph_id": "graph:1", "schema_version": "2.0.0", "snapshot_id": "snap", "commit_sha": "sha", "node_count": 0, "edge_count": 0, "nodes": [], "edges": [], "source_anchors": [], "indexes": {}, "unresolved_frontiers": [], "coverage_state": "SUFFICIENT", "coverage_notes": [], "provenance": {}, "evidence_refs": [], "graph_hash": "sha256:test"}
def _request(tool_name: str):
    registry = build_sprint6_agentic_registry(); cap = registry.capability(tool_name)
    return AgenticToolRequest.model_validate({"toolName": tool_name, "requestId": str(uuid4()), "assessmentId": str(uuid4()), "workflowRunId": str(uuid4()), "artifactVersions": {"technicalEvidenceReportId": "ter-1"}, "correlationId": str(uuid4()), "scope": {}, "budget": {"maxItems": min(10, cap.max_items), "maxDepth": min(1, cap.max_depth), "maxBytes": min(16384, cap.max_bytes), "maxDurationMs": min(1000, cap.max_duration_ms)}, "input": {"maxResults": 10}})

def test_runtime_registry_binds_python_local_model_tools() -> None:
    registry = build_sprint6_agentic_registry(); api = MagicMock(); api.get_accepted_technical_evidence_report.return_value = {"evidence_payload": {"evidence_graph": _graph()}}
    bind_runtime_handlers(registry, api_client=api, user_id="user-1", organization_id="org-1")
    response = registry.invoke_model_tool(_request("get_scan_coverage"))
    assert response["coverageState"] == "SUFFICIENT"
    api.dispatch_agentic_tool.assert_not_called()
    api.get_accepted_technical_evidence_report.assert_called_once_with("ter-1")

def test_runtime_registry_still_dispatches_cqrs_tools_to_nest() -> None:
    registry = build_sprint6_agentic_registry(); api = MagicMock(); api.dispatch_agentic_tool.return_value = {"status": "READY"}
    bind_runtime_handlers(registry, api_client=api, user_id="user-1", organization_id="org-1")
    request = _request("get_artifact_chain"); request.input.clear(); request.input.update({"anchor": {"assessmentId": "assessment:abcdefgh"}})
    assert registry.invoke_model_tool(request) == {"status": "READY"}
    assert api.dispatch_agentic_tool.call_count == 1
