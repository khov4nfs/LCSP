from __future__ import annotations

from types import SimpleNamespace

import pytest

from orchestration.context import LCSPRunContext
from tools.common.runtime_envelope import (
    AgenticToolInvocationError,
    AgenticToolRequest,
    trusted_agentic_tool_request,
)


def test_runtime_context_supplies_trusted_identity() -> None:
    runtime = SimpleNamespace(
        context=LCSPRunContext(
            assessment_id="assessment-trusted",
            user_id="user-trusted",
            workflow_run_id="run-trusted",
            correlation_id="correlation-trusted",
            artifact_versions={"technicalEvidenceReportId": "report-trusted"},
        )
    )

    request = trusted_agentic_tool_request(
        {
            "input": {"subjectRef": "symbol:1"},
            "correlation_id": "model-supplied",
        },
        runtime,
    )

    assert request.assessment_id == "assessment-trusted"
    assert request.user_id == "user-trusted"
    assert request.workflow_run_id == "run-trusted"
    assert request.correlation_id == "correlation-trusted"
    assert request.artifact_versions == {"technicalEvidenceReportId": "report-trusted"}


def test_agentic_tool_request_no_longer_requires_model_authored_user_id() -> None:
    schema = AgenticToolRequest.model_json_schema()
    properties = schema.get("properties", {})

    assert "user_id" not in schema.get("required", [])
    assert "assessment_id" not in schema.get("required", [])
    assert "assessment_id" not in properties
    assert "user_id" not in properties
    assert "workflow_run_id" not in properties
    assert "artifact_versions" not in properties


def test_runtime_envelope_fails_closed_without_trusted_or_legacy_identity() -> None:
    with pytest.raises(AgenticToolInvocationError, match="ToolRuntime context"):
        trusted_agentic_tool_request({"input": {}}, None)


def test_tool_node_injects_runtime_without_exposing_or_rejecting_it(monkeypatch) -> None:
    from langchain_core.messages import AIMessage
    from langgraph.graph import END, START, MessagesState, StateGraph
    from langgraph.prebuilt import ToolNode
    from tools.common.search_program_graph import code

    captured = []
    monkeypatch.setattr(code, "dispatch_agentic_tool", lambda name, request: captured.append(request) or {"nodes": []})
    context = LCSPRunContext(
        assessment_id="assessment-trusted", user_id="user-trusted",
        workflow_run_id="run-trusted",
        artifact_versions={"technicalEvidenceReportId": "report-trusted"},
    )
    graph = StateGraph(MessagesState, context_schema=LCSPRunContext)
    graph.add_node("tools", ToolNode([code.search_program_graph], handle_tool_errors=False))
    graph.add_edge(START, "tools")
    graph.add_edge("tools", END)
    result = graph.compile().invoke({"messages": [AIMessage(content="", tool_calls=[{
        "name": "search_program_graph", "args": {"query": "training", "maxResults": 7},
        "id": "search-1", "type": "tool_call",
    }])]}, context=context)
    assert result["messages"][-1].status == "success"
    assert captured[0].assessment_id == "assessment-trusted"
    assert captured[0].user_id == "user-trusted"
    assert captured[0].input["maxResults"] == 7
    assert "runtime" not in captured[0].input
    assert "runtime" not in code.search_program_graph.tool_call_schema.model_json_schema()["properties"]


@pytest.mark.parametrize("field", ["runtime", "assessment_id", "user_id", "artifact_versions"])
def test_model_input_cannot_forge_injected_runtime_or_identity(field) -> None:
    from pydantic import ValidationError
    from tools.common.search_program_graph.code import SearchProgramGraphRequest

    for schema in (AgenticToolRequest, SearchProgramGraphRequest):
        with pytest.raises(ValidationError, match="Extra inputs"):
            schema.model_validate({field: {"user_id": "attacker"}})
