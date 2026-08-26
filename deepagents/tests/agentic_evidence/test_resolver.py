from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from tools.common.capabilities.agentic_evidence import (
    AgenticInvocationContext,
    AgenticToolResolver,
    AgenticToolValidationError,
    build_engineering_rule_agentic_registry,
)
from tools.common.capabilities.agentic_evidence.governance.authorization import AgenticAuthorizationResult


class AllowAuthorizer:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def authorize(
        self,
        *,
        tool_name: str,
        user_id: str,
        organization_id: str,
        correlationId: UUID,
    ) -> AgenticAuthorizationResult:
        assert user_id == "user-1"
        assert organization_id == "org-1"
        assert isinstance(correlationId, UUID)
        self.calls.append(tool_name)
        return AgenticAuthorizationResult(role="CUSTOMER")


def context() -> AgenticInvocationContext:
    return AgenticInvocationContext(
        assessment_id=uuid4(),
        workflow_run_id=uuid4(),
        correlationId=uuid4(),
        user_id="user-1",
        organization_id="org-1",
        artifact_versions={"technicalEvidenceReportId": "ter-1"},
        scope={"pathPrefixes": ["apps/api/"]},
    )


def test_resolver_exposes_exact_model_callable_catalog() -> None:
    registry = build_engineering_rule_agentic_registry()
    resolver = AgenticToolResolver(registry, AllowAuthorizer(), max_tool_calls=4)
    names = {item.name for item in resolver.as_langchain_tools(context=context())}

    assert "resume_waiting_runs" not in names
    assert "request_targeted_reanalysis" not in names
    assert "get_scan_coverage" in names
    assert "search_evidence" in names
    assert len(names) == 17


def test_resolver_dispatches_validated_authorized_read_call() -> None:
    registry = build_engineering_rule_agentic_registry()
    registry.register_handler(
        "get_scan_coverage",
        lambda request: {
            "status": "READY",
            "result": {"maxResults": request.input["maxResults"]},
        },
    )
    authorizer = AllowAuthorizer()
    resolver = AgenticToolResolver(registry, authorizer, max_tool_calls=2)

    native_tool = next(item for item in resolver.as_langchain_tools(context=context()) if item.name == "get_scan_coverage")
    result = native_tool.invoke({"maxResults": 25})

    assert authorizer.calls == ["get_scan_coverage"]
    assert result["result"]["maxResults"] == 25


def test_resolver_rejects_schema_invalid_call_before_rbac_or_handler() -> None:
    registry = build_engineering_rule_agentic_registry()
    called = False

    def handler(_request):
        nonlocal called
        called = True
        return {"status": "READY"}

    registry.register_handler("get_scan_coverage", handler)
    authorizer = AllowAuthorizer()
    resolver = AgenticToolResolver(registry, authorizer, max_tool_calls=2)

    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_INPUT_SCHEMA_INVALID",
    ):
        next(item for item in resolver.as_langchain_tools(context=context()) if item.name == "get_scan_coverage").invoke({"maxResults": 101})
    assert authorizer.calls == []
    assert called is False


def test_resolver_rejects_non_model_tool_before_rbac_even_if_registered() -> None:
    registry = build_engineering_rule_agentic_registry()
    registry.register_handler(
        "request_targeted_reanalysis",
        lambda _request: {"status": "READY"},
    )
    authorizer = AllowAuthorizer()
    resolver = AgenticToolResolver(registry, authorizer, max_tool_calls=2)

    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_NOT_MODEL_CALLABLE",
    ):
        resolver._invoke_capability("request_targeted_reanalysis", resolver._registry.capability("request_targeted_reanalysis"), {}, context())
    assert authorizer.calls == []


def test_resolver_exposes_tool_call_budget_for_langchain_middleware() -> None:
    registry = build_engineering_rule_agentic_registry()
    authorizer = AllowAuthorizer()
    resolver = AgenticToolResolver(registry, authorizer, max_tool_calls=1)
    assert resolver.max_tool_calls == 1
    assert authorizer.calls == []
