from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from tools.common.capabilities.agentic_evidence import (
    AgenticInvocationContext,
    AgenticToolResolver,
    AgenticToolValidationError,
    build_engineering_rule_agentic_registry,
)
from tools.common.capabilities.agentic_evidence.governance.authorization import (
    AgenticAuthorizationResult,
)


class AllowAuthorizer:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def authorize(
        self,
        *,
        tool_name: str,
        user_id: str,
        correlationId: UUID,
    ) -> AgenticAuthorizationResult:
        assert user_id == "user-1"
        assert isinstance(correlationId, UUID)
        self.calls.append(tool_name)
        return AgenticAuthorizationResult(role="CUSTOMER")


def context() -> AgenticInvocationContext:
    return AgenticInvocationContext(
        assessment_id=uuid4(),
        workflow_run_id=uuid4(),
        correlationId=uuid4(),
        user_id="user-1",
        artifact_versions={"baselineId": "artifact-1", "technicalEvidenceReportId": "ter-1"},
        scope={},
    )


def test_resolver_exposes_only_surviving_model_callable_catalog() -> None:
    resolver = AgenticToolResolver(
        build_engineering_rule_agentic_registry(),
        AllowAuthorizer(),
        max_tool_calls=4,
    )
    names = {item.name for item in resolver.as_langchain_tools(context=context())}

    assert names == {
        "propose_gap_remediation",
        "get_gap_evidence_trace",
        "get_reconciliation_context",
        "get_artifact_chain",
    }


def test_resolver_dispatches_validated_authorized_read_call() -> None:
    registry = build_engineering_rule_agentic_registry()
    registry.register_handler(
        "get_gap_evidence_trace",
        lambda request: {
            "status": "READY",
            "result": {"rowRef": request.input["rowRef"]},
        },
    )
    authorizer = AllowAuthorizer()
    resolver = AgenticToolResolver(registry, authorizer, max_tool_calls=2)

    native_tool = next(
        item
        for item in resolver.as_langchain_tools(context=context())
        if item.name == "get_gap_evidence_trace"
    )
    result = native_tool.invoke({"rowRef": "gap-row:abcdef"})

    assert authorizer.calls == ["get_gap_evidence_trace"]
    assert result["result"]["rowRef"] == "gap-row:abcdef"


def test_resolver_rejects_schema_invalid_call_before_rbac_or_handler() -> None:
    registry = build_engineering_rule_agentic_registry()
    called = False

    def handler(_request):
        nonlocal called
        called = True
        return {"status": "READY"}

    registry.register_handler("get_gap_evidence_trace", handler)
    authorizer = AllowAuthorizer()
    resolver = AgenticToolResolver(registry, authorizer, max_tool_calls=2)
    tool = next(
        item
        for item in resolver.as_langchain_tools(context=context())
        if item.name == "get_gap_evidence_trace"
    )

    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_INPUT_SCHEMA_INVALID",
    ):
        tool.invoke({"rowRef": "invalid"})
    assert authorizer.calls == []
    assert called is False


def test_resolver_rejects_non_model_tool_before_rbac_even_if_registered() -> None:
    registry = build_engineering_rule_agentic_registry()
    registry.register_handler(
        "resume_waiting_runs",
        lambda _request: {"status": "READY"},
    )
    authorizer = AllowAuthorizer()
    resolver = AgenticToolResolver(registry, authorizer, max_tool_calls=2)

    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_NOT_MODEL_CALLABLE",
    ):
        resolver._invoke_capability(
            "resume_waiting_runs",
            resolver._registry.capability("resume_waiting_runs"),
            {},
            context(),
        )
    assert authorizer.calls == []


def test_resolver_exposes_tool_call_budget_for_langchain_middleware() -> None:
    resolver = AgenticToolResolver(
        build_engineering_rule_agentic_registry(),
        AllowAuthorizer(),
        max_tool_calls=1,
    )
    assert resolver.max_tool_calls == 1
