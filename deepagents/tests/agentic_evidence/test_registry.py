from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from tools.common.capabilities.agentic_evidence.governance.catalog import (
    llm_callable_tool_specs,
)
from tools.common.capabilities.agentic_evidence.governance.registry import (
    AgenticToolRequest,
    AgenticToolValidationError,
    build_engineering_rule_agentic_registry,
)


EXPECTED_TOOLS = {
    "resume_waiting_runs",
    "propose_gap_remediation",
    "get_gap_evidence_trace",
    "get_reconciliation_context",
    "get_artifact_chain",
}
NON_MODEL_TOOLS = {"resume_waiting_runs"}
MODEL_TOOLS = EXPECTED_TOOLS - NON_MODEL_TOOLS


def valid_input_for(tool_name: str) -> dict:
    if tool_name == "propose_gap_remediation":
        return {
            "rowRef": "gap-row:abcdef",
            "templateId": "remediation:collect-evidence",
        }
    if tool_name == "get_gap_evidence_trace":
        return {"rowRef": "gap-row:abcdef"}
    if tool_name == "get_reconciliation_context":
        return {"maxResults": 10}
    if tool_name == "get_artifact_chain":
        return {"anchor": {"assessmentId": "assessment:abcdefgh"}}
    if tool_name == "resume_waiting_runs":
        return {
            "activationRecordRef": "corpus-approval:abc123",
            "corpusVersionRef": "corpus-version:abc123",
            "maxRuns": 10,
            "idempotencyKey": str(uuid4()),
        }
    return {}


def request_for(
    tool_name: str,
    *,
    max_items: int = 8,
    max_depth: int = 1,
    idempotency_key: str | None = None,
    artifact_versions: dict[str, str] | None = None,
    input_payload: dict | None = None,
) -> AgenticToolRequest:
    return AgenticToolRequest.model_validate(
        {
            "toolName": tool_name,
            "requestId": str(uuid4()),
            "assessmentId": str(uuid4()),
            "workflowRunId": str(uuid4()),
            "artifactVersions": artifact_versions or {"baselineId": "artifact-1"},
            "correlationId": str(uuid4()),
            "scope": {},
            "budget": {
                "maxItems": max_items,
                "maxDepth": max_depth,
                "maxBytes": 16_384,
                "maxDurationMs": 1_000,
            },
            "input": (
                input_payload
                if input_payload is not None
                else valid_input_for(tool_name)
            ),
            "idempotencyKey": idempotency_key,
        }
    )


def test_engineering_rule_inventory_is_minimal_and_unique() -> None:
    registry = build_engineering_rule_agentic_registry()
    assert set(registry.names()) == EXPECTED_TOOLS
    assert len(registry.names()) == len(EXPECTED_TOOLS)


def test_only_non_repository_domain_tools_are_model_callable() -> None:
    registry = build_engineering_rule_agentic_registry()
    specs = llm_callable_tool_specs()
    model_names = {spec.name for spec in specs}

    assert model_names == MODEL_TOOLS
    assert set(registry.model_callable_names()) == MODEL_TOOLS
    assert len(specs) == 4
    assert all(spec.input_schema["additionalProperties"] is False for spec in specs)
    retired_repo_tools = {
        "get_scan_coverage",
        "search_evidence",
        "trace_static_flow",
        "inspect_data_path",
        "inspect_decision_path",
        "inspect_human_review_path",
        "get_symbol_context",
        "find_provider_invocations",
    }
    assert set(registry.names()).isdisjoint(retired_repo_tools)


def test_unknown_tool_fails_closed() -> None:
    registry = build_engineering_rule_agentic_registry()
    with pytest.raises(AgenticToolValidationError, match="UNREGISTERED_AGENTIC_TOOL"):
        registry.validate(request_for("read_repository_source"))


def test_budget_cannot_exceed_tool_capability() -> None:
    registry = build_engineering_rule_agentic_registry()
    request = request_for("get_gap_evidence_trace", max_items=9)
    # Capability max_items is 8.
    with pytest.raises(AgenticToolValidationError, match="AGENTIC_TOOL_BUDGET_EXCEEDED"):
        registry.validate(request)


def test_tool_specific_json_schema_is_enforced_before_dispatch() -> None:
    registry = build_engineering_rule_agentic_registry()
    invalid = request_for(
        "get_gap_evidence_trace",
        input_payload={"rowRef": "not-a-gap-row"},
    )
    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_INPUT_SCHEMA_INVALID",
    ):
        registry.validate(invalid)

    extra = request_for(
        "get_gap_evidence_trace",
        input_payload={"rowRef": "gap-row:abcdef", "rawQuery": "anything"},
    )
    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_INPUT_SCHEMA_INVALID",
    ):
        registry.validate(extra)


def test_mutation_requires_idempotency_key() -> None:
    registry = build_engineering_rule_agentic_registry()
    request = request_for("resume_waiting_runs")
    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_IDEMPOTENCY_KEY_REQUIRED",
    ):
        registry.validate(request)


def test_system_and_orchestrator_tools_are_never_model_callable() -> None:
    registry = build_engineering_rule_agentic_registry()
    # Retry/reanalysis is an API-driven ruleScope rerun, never a registered agentic tool.
    assert "request_targeted_reanalysis" not in registry.names()
    for request in (
        request_for("resume_waiting_runs", idempotency_key="request-87654321"),
    ):
        with pytest.raises(
            AgenticToolValidationError,
            match="AGENTIC_TOOL_NOT_MODEL_CALLABLE",
        ):
            registry.validate_model_request(request)


def test_read_tool_rejects_mutation_idempotency_key() -> None:
    registry = build_engineering_rule_agentic_registry()
    request = request_for(
        "get_gap_evidence_trace",
        idempotency_key="request-12345",
    )
    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_READ_IDEMPOTENCY_KEY_NOT_ALLOWED",
    ):
        registry.validate(request)


@pytest.mark.parametrize(
    "unsafe_input",
    [
        {"raw_source": "const secret = true"},
        {"nested": {"prompt": "system prompt"}},
        {"path": "/var/lib/workspace/source.ts"},
        {"path": "../../secret"},
        {"endpoint": "https://example.invalid/arbitrary"},
    ],
)
def test_unsafe_agent_input_is_rejected(unsafe_input: dict) -> None:
    with pytest.raises(ValidationError):
        request_for("get_gap_evidence_trace", input_payload=unsafe_input)


def test_dispatch_requires_bound_handler_and_checks_output() -> None:
    registry = build_engineering_rule_agentic_registry()
    request = request_for("get_gap_evidence_trace")
    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_HANDLER_NOT_BOUND",
    ):
        registry.invoke_model_tool(request)

    registry.register_handler(
        "get_gap_evidence_trace",
        lambda _: {"status": "READY", "result": {"items": []}},
    )
    assert registry.invoke_model_tool(request)["status"] == "READY"


def test_dispatch_blocks_forbidden_output_fields() -> None:
    registry = build_engineering_rule_agentic_registry()
    request = request_for("get_gap_evidence_trace")
    registry.register_handler(
        "get_gap_evidence_trace",
        lambda _: {"status": "READY", "result": {"raw_source": "secret"}},
    )
    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_UNSAFE_OUTPUT",
    ):
        registry.invoke_model_tool(request)
