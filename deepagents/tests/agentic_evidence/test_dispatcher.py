from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

from tools.common.capabilities.agentic_evidence.dispatch.dispatcher import (
    ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS,
    AgenticToolDispatcher,
    ToolRuntimeTarget,
)
from tools.common.capabilities.agentic_evidence.entrypoints.tool_entrypoints import (
    AgenticToolExecutionContext,
)
from tools.common.capabilities.agentic_evidence.governance.catalog import (
    AGENTIC_TOOL_SPECS,
)
from tools.common.capabilities.agentic_evidence.governance.registry import (
    AgenticToolRequest,
)


def _request(tool_name: str, input_payload: dict) -> AgenticToolRequest:
    return AgenticToolRequest.model_validate(
        {
            "toolName": tool_name,
            "requestId": str(uuid4()),
            "assessmentId": str(uuid4()),
            "workflowRunId": str(uuid4()),
            "artifactVersions": {"baselineId": "artifact-1"},
            "correlationId": str(uuid4()),
            "scope": {},
            "budget": {
                "maxItems": 8,
                "maxDepth": 1,
                "maxBytes": 16384,
                "maxDurationMs": 1000,
            },
            "input": input_payload,
        }
    )


def test_every_canonical_tool_has_exact_named_runtime_binding() -> None:
    assert {b.tool_name for b in ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS} == {
        s.name for s in AGENTIC_TOOL_SPECS
    }
    assert len({b.tool_name for b in ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS}) == len(
        ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS
    )
    for binding in ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS:
        assert binding.entrypoint.__name__ == binding.tool_name


def test_repository_graph_tools_are_not_agentic_runtime_bindings() -> None:
    names = {binding.tool_name for binding in ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS}
    assert {
        "search_evidence",
        "get_scan_coverage",
        "trace_static_flow",
        "inspect_data_path",
        "inspect_decision_path",
        "inspect_human_review_path",
    }.isdisjoint(names)


def test_gap_remediation_is_the_only_python_local_model_capability() -> None:
    python_local = {
        binding.tool_name
        for binding in ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS
        if binding.runtime_target == ToolRuntimeTarget.PYTHON_LOCAL
    }
    assert python_local == {"propose_gap_remediation"}


def test_cqrs_discovery_tool_still_crosses_nest_boundary() -> None:
    api = MagicMock()
    api.dispatch_agentic_tool.return_value = {"status": "READY"}
    dispatcher = AgenticToolDispatcher(
        AgenticToolExecutionContext(api, "user-1", "org-1")
    )
    request = _request(
        "get_artifact_chain",
        {"anchor": {"assessmentId": "assessment:abcdefgh"}},
    )
    assert dispatcher.dispatch(request) == {"status": "READY"}
    assert api.dispatch_agentic_tool.call_args.args[0]["tool_name"] == "get_artifact_chain"


def test_bound_handler_keeps_canonical_name() -> None:
    dispatcher = AgenticToolDispatcher(
        AgenticToolExecutionContext(MagicMock(), "user-1", "org-1")
    )
    assert (
        dispatcher.bound_handler("get_gap_evidence_trace").__name__
        == "get_gap_evidence_trace"
    )
