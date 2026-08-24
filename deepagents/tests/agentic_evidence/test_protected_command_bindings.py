from __future__ import annotations

import inspect
from unittest.mock import MagicMock
from uuid import uuid4

from tools.common.agentic_evidence import tool_entrypoints
from tools.common.agentic_evidence.dispatcher import (
    PROTECTED_COMMAND_BINDINGS,
    ToolRuntimeTarget,
    runtime_binding,
)
from tools.common.agentic_evidence.registry import AgenticToolRequest
from tools.common.agentic_evidence.tool_entrypoints import AgenticToolExecutionContext


EXPECTED_PROTECTED_COMMANDS = {
    "reconcile_profile_to_verified_profile": "ReconcileProfileToVerifiedProfileCommand",
    "submit_classification_for_independent_review": "SubmitClassificationReviewCommand",
    "resolve_independent_classification_review": "ResolveClassificationReviewCommand",
}


def _request(tool_name: str) -> AgenticToolRequest:
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
                "maxItems": 1,
                "maxDepth": 1,
                "maxBytes": 16_384,
                "maxDurationMs": 1_000,
            },
            "input": {},
            "idempotencyKey": "request-12345678",
        }
    )


def test_protected_commands_have_exact_named_static_entrypoints() -> None:
    names = {binding.tool_name for binding in PROTECTED_COMMAND_BINDINGS}
    assert names == set(EXPECTED_PROTECTED_COMMANDS)

    source = inspect.getsource(tool_entrypoints)
    for binding in PROTECTED_COMMAND_BINDINGS:
        assert binding.runtime_target == ToolRuntimeTarget.NEST_COMMAND
        assert binding.entrypoint.__name__ == binding.tool_name
        assert getattr(tool_entrypoints, binding.tool_name) is binding.entrypoint
        assert f"def {binding.tool_name}(" in source
        assert binding.downstream_target == EXPECTED_PROTECTED_COMMANDS[binding.tool_name]


def test_runtime_binding_resolves_protected_command_without_guessing() -> None:
    binding = runtime_binding("resolve_independent_classification_review")

    assert binding.runtime_target == ToolRuntimeTarget.NEST_COMMAND
    assert binding.entrypoint.__name__ == "resolve_independent_classification_review"
    assert binding.downstream_target == "ResolveClassificationReviewCommand"


def test_protected_entrypoint_propagates_pinned_policy_metadata() -> None:
    api_client = MagicMock()
    api_client.dispatch_agentic_tool.return_value = {"status": "READY"}
    context = AgenticToolExecutionContext(
        api_client=api_client,
        user_id="user-1",
        organization_id="org-1",
        policy_id="policy-1",
        policy_version="version-7",
    )
    request = _request("submit_classification_for_independent_review")

    response = tool_entrypoints.submit_classification_for_independent_review(
        request,
        context,
    )

    assert response == {"status": "READY"}
    payload = api_client.dispatch_agentic_tool.call_args.args[0]
    assert payload["tool_name"] == "submit_classification_for_independent_review"
    assert payload["policy_id"] == "policy-1"
    assert payload["policy_version"] == "version-7"
