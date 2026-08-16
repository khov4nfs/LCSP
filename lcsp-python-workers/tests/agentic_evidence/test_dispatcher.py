from __future__ import annotations
from unittest.mock import MagicMock
from uuid import uuid4
from lcsp_workers.agentic_evidence.catalog import AGENTIC_TOOL_SPECS
from lcsp_workers.agentic_evidence.dispatcher import AgenticToolDispatcher, PROGRAM_GRAPH_TOOL_BINDINGS, SPRINT6_AGENTIC_TOOL_BINDINGS, ToolRuntimeTarget
from lcsp_workers.agentic_evidence.registry import AgenticToolRequest
from lcsp_workers.agentic_evidence.tool_entrypoints import AgenticToolExecutionContext


def _graph():
    return {"graph_id": "graph:1", "schema_version": "2.0.0", "snapshot_id": "snap", "commit_sha": "sha", "node_count": 1, "edge_count": 0, "nodes": [{"node_id": "node-1", "node_type": "FILE", "label": "app.py", "source": {"file_path": "app.py"}, "attributes": {}, "semantic_types": [], "evidence_refs": []}], "edges": [], "source_anchors": [], "indexes": {"FILE": ["node-1"]}, "unresolved_frontiers": [], "coverage_state": "SUFFICIENT", "coverage_notes": [], "provenance": {}, "evidence_refs": [], "graph_hash": "sha256:test"}

def _request(tool_name: str):
    return AgenticToolRequest.model_validate({"toolName": tool_name, "requestId": str(uuid4()), "assessmentId": str(uuid4()), "workflowRunId": str(uuid4()), "artifactVersions": {"technicalEvidenceReportId": "ter-1"}, "correlationId": str(uuid4()), "scope": {}, "budget": {"maxItems": 10, "maxDepth": 1, "maxBytes": 16384, "maxDurationMs": 1000}, "input": {"maxResults": 10}})

def test_every_canonical_tool_has_exact_named_runtime_binding() -> None:
    assert {b.tool_name for b in SPRINT6_AGENTIC_TOOL_BINDINGS} == {s.name for s in AGENTIC_TOOL_SPECS}
    assert len({b.tool_name for b in SPRINT6_AGENTIC_TOOL_BINDINGS}) == len(SPRINT6_AGENTIC_TOOL_BINDINGS)
    for binding in SPRINT6_AGENTIC_TOOL_BINDINGS: assert binding.entrypoint.__name__ == binding.tool_name

def test_technical_investigation_tools_are_python_local() -> None:
    assert PROGRAM_GRAPH_TOOL_BINDINGS
    assert all(b.runtime_target == ToolRuntimeTarget.PYTHON_LOCAL for b in PROGRAM_GRAPH_TOOL_BINDINGS)

def test_dispatcher_queries_program_graph_without_nest_analysis_handler() -> None:
    api = MagicMock(); api.get_accepted_technical_evidence_report.return_value = {"evidence_payload": {"evidence_graph": _graph()}}
    dispatcher = AgenticToolDispatcher(AgenticToolExecutionContext(api, "user-1", "org-1"))
    response = dispatcher.dispatch(_request("get_scan_coverage"))
    assert response["coverageState"] == "SUFFICIENT"
    api.get_accepted_technical_evidence_report.assert_called_once_with("ter-1")
    api.dispatch_agentic_tool.assert_not_called()

def test_cqrs_discovery_tool_still_crosses_nest_boundary() -> None:
    api = MagicMock(); api.dispatch_agentic_tool.return_value = {"status": "READY"}
    dispatcher = AgenticToolDispatcher(AgenticToolExecutionContext(api, "user-1", "org-1"))
    request = _request("get_artifact_chain"); request.input.clear()
    assert dispatcher.dispatch(request) == {"status": "READY"}
    assert api.dispatch_agentic_tool.call_args.args[0]["tool_name"] == "get_artifact_chain"

def test_bound_handler_keeps_canonical_name() -> None:
    dispatcher = AgenticToolDispatcher(AgenticToolExecutionContext(MagicMock(), "user-1", "org-1"))
    assert dispatcher.bound_handler("search_evidence").__name__ == "search_evidence"
