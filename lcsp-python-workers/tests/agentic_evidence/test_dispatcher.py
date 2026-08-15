from __future__ import annotations

import inspect
from unittest.mock import MagicMock
from uuid import uuid4

from lcsp_workers.agentic_evidence import tool_entrypoints
from lcsp_workers.agentic_evidence.catalog import AGENTIC_TOOL_SPECS
from lcsp_workers.agentic_evidence.dispatcher import (
    AgenticToolDispatcher,
    SPRINT6_AGENTIC_TOOL_BINDINGS,
)
from lcsp_workers.agentic_evidence.registry import AgenticToolRequest
from lcsp_workers.agentic_evidence.tool_entrypoints import AgenticToolExecutionContext


def _request_for(tool_name: str) -> AgenticToolRequest:
    return AgenticToolRequest.model_validate(
        {
            "toolName": tool_name,
            "requestId": str(uuid4()),
            "assessmentId": str(uuid4()),
            "workflowRunId": str(uuid4()),
            "artifactVersions": {"technicalEvidenceReportId": "ter-1"},
            "correlationId": str(uuid4()),
            "scope": {},
            "budget": {
                "maxItems": 10,
                "maxDepth": 1,
                "maxBytes": 16_384,
                "maxDurationMs": 1_000,
            },
            "input": {"maxResults": 10},
        }
    )


def test_every_canonical_tool_has_exact_named_runtime_binding() -> None:
    catalog_names = {spec.name for spec in AGENTIC_TOOL_SPECS}
    binding_names = {binding.tool_name for binding in SPRINT6_AGENTIC_TOOL_BINDINGS}

    assert binding_names == catalog_names
    assert len(binding_names) == len(SPRINT6_AGENTIC_TOOL_BINDINGS)
    for binding in SPRINT6_AGENTIC_TOOL_BINDINGS:
        assert binding.entrypoint.__name__ == binding.tool_name
        assert getattr(tool_entrypoints, binding.tool_name) is binding.entrypoint


def test_canonical_entrypoints_are_real_static_functions() -> None:
    source = inspect.getsource(tool_entrypoints)
    for spec in AGENTIC_TOOL_SPECS:
        assert f"def {spec.name}(" in source


def test_dispatcher_routes_canonical_name_through_internal_api() -> None:
    api_client = MagicMock()
    api_client.dispatch_agentic_tool.return_value = {"status": "READY"}
    dispatcher = AgenticToolDispatcher(
        AgenticToolExecutionContext(
            api_client=api_client,
            user_id="user-1",
            organization_id="org-1",
        )
    )
    request = _request_for("get_scan_coverage")

    response = dispatcher.dispatch(request)

    assert response == {"status": "READY"}
    payload = api_client.dispatch_agentic_tool.call_args.args[0]
    assert payload["tool_name"] == "get_scan_coverage"
    assert payload["organization_id"] == "org-1"
    assert payload["user_id"] == "user-1"


def test_bound_handler_keeps_canonical_function_name() -> None:
    dispatcher = AgenticToolDispatcher(
        AgenticToolExecutionContext(
            api_client=MagicMock(),
            user_id="user-1",
            organization_id="org-1",
        )
    )

    handler = dispatcher.bound_handler("search_evidence")

    assert handler.__name__ == "search_evidence"
