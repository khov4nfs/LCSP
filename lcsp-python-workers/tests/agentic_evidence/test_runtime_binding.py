from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

from lcsp_workers.agentic_evidence.registry import (
    AgenticToolRequest,
    build_sprint6_agentic_registry,
)
from lcsp_workers.agentic_evidence.runtime_binding import bind_runtime_handlers


def _request_for(tool_name: str, artifact_versions: dict[str, str]) -> AgenticToolRequest:
    registry = build_sprint6_agentic_registry()
    capability = registry.capability(tool_name)
    return AgenticToolRequest.model_validate(
        {
            "toolName": tool_name,
            "requestId": str(uuid4()),
            "assessmentId": str(uuid4()),
            "workflowRunId": str(uuid4()),
            "artifactVersions": artifact_versions,
            "correlationId": str(uuid4()),
            "scope": {"pathPrefixes": ["apps/api/"]},
            "budget": {
                "maxItems": min(10, capability.max_items),
                "maxDepth": min(1, capability.max_depth),
                "maxBytes": min(16_384, capability.max_bytes),
                "maxDurationMs": min(1_000, capability.max_duration_ms),
            },
            "input": {"maxResults": 10},
        }
    )


def test_bind_runtime_handlers_registers_all_model_callable_tools() -> None:
    registry = build_sprint6_agentic_registry()
    api_client = MagicMock()
    api_client.dispatch_agentic_tool.return_value = {"status": "READY"}

    bind_runtime_handlers(
        registry,
        api_client=api_client,
        user_id="user-1",
        organization_id="org-1",
    )

    request = _request_for(
        "get_scan_coverage",
        {"technicalEvidenceReportId": "ter-1"},
    )

    response = registry.invoke_model_tool(request)

    assert response == {"status": "READY"}
    assert api_client.dispatch_agentic_tool.call_count == 1


def test_bound_runtime_handler_dispatches_expected_worker_payload() -> None:
    registry = build_sprint6_agentic_registry()
    api_client = MagicMock()
    api_client.dispatch_agentic_tool.return_value = {"status": "READY"}

    bind_runtime_handlers(
        registry,
        api_client=api_client,
        user_id="user-1",
        organization_id="org-1",
    )

    request = _request_for(
        "get_scan_coverage",
        {"technicalEvidenceReportId": "ter-1"},
    )

    registry.invoke_model_tool(request)

    api_client.dispatch_agentic_tool.assert_called_once_with(
        {
            "tool_name": "get_scan_coverage",
            "request_id": str(request.request_id),
            "assessment_id": str(request.assessment_id),
            "workflow_run_id": str(request.workflow_run_id),
            "organization_id": "org-1",
            "user_id": "user-1",
            "artifact_versions": {"technicalEvidenceReportId": "ter-1"},
            "scope": {"pathPrefixes": ["apps/api/"]},
            "budget": {
                "maxItems": 10,
                "maxDepth": 1,
                "maxBytes": 16_384,
                "maxDurationMs": 1_000,
            },
            "input": {"maxResults": 10},
            "correlation_id": str(request.correlation_id),
        }
    )
