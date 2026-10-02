from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

from tools.common.capabilities.agentic_evidence.dispatch.runtime_binding import (
    bind_runtime_handlers,
)
from tools.common.capabilities.agentic_evidence.governance.registry import (
    AgenticToolRequest,
    build_engineering_rule_agentic_registry,
)


def _request(tool_name: str, input_payload: dict) -> AgenticToolRequest:
    registry = build_engineering_rule_agentic_registry()
    cap = registry.capability(tool_name)
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
                "maxItems": min(8, cap.max_items),
                "maxDepth": min(1, cap.max_depth),
                "maxBytes": min(16384, cap.max_bytes),
                "maxDurationMs": min(1000, cap.max_duration_ms),
            },
            "input": input_payload,
        }
    )


def test_runtime_registry_binds_python_local_gap_remediation() -> None:
    registry = build_engineering_rule_agentic_registry()
    api = MagicMock()
    api.dispatch_agentic_tool.return_value = {
        "coverageState": "READY",
        "result": {"resolverType": "COLLECT_EVIDENCE", "layers": []},
        "evidenceRefs": [],
        "limitations": [],
    }
    bind_runtime_handlers(registry, api_client=api, user_id="user-1")

    response = registry.invoke_model_tool(
        _request(
            "propose_gap_remediation",
            {
                "rowRef": "gap-row:abcdef",
                "templateId": "remediation:collect-evidence",
            },
        )
    )

    assert response["status"] == "READY"
    assert response["toolName"] == "propose_gap_remediation"
    assert api.dispatch_agentic_tool.call_args.args[0]["tool_name"] == "get_gap_evidence_trace"


def test_runtime_registry_still_dispatches_cqrs_tools_to_nest() -> None:
    registry = build_engineering_rule_agentic_registry()
    api = MagicMock()
    api.dispatch_agentic_tool.return_value = {"status": "READY"}
    bind_runtime_handlers(registry, api_client=api, user_id="user-1")

    request = _request(
        "get_artifact_chain",
        {"anchor": {"assessmentId": "assessment:abcdefgh"}},
    )
    assert registry.invoke_model_tool(request) == {"status": "READY"}
    assert api.dispatch_agentic_tool.call_count == 1
