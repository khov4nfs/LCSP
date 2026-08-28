from __future__ import annotations

import json
from uuid import uuid4

import httpx
import pytest

from tools.common.capabilities.agentic_evidence.governance.authorization import ApiRbacToolAuthorizer
from tools.common.capabilities.agentic_evidence.governance.registry import AgenticToolValidationError
from tools.common.capabilities.platform.rbac_client import RbacClient


def response(decision: str, reason: str | None = None) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "ok": True,
            "data": {
                "decision": decision,
                "reason_code": reason,
                "correlationId": str(uuid4()),
            },
        },
    )


def test_technical_tool_authorizes_customer_role() -> None:
    seen_roles: list[list[str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        seen_roles.append(payload["required_roles"])
        assert request.headers["x-worker-api-key"] == "worker-secret"
        return response("ALLOW")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    authorizer = ApiRbacToolAuthorizer(
        rbac_client=RbacClient(
            "http://api.local",
            "worker-secret",
            client=client,
        ),
    )

    result = authorizer.authorize(
        tool_name="get_scan_coverage",
        user_id="user-1",
        correlationId=uuid4(),
    )

    assert seen_roles == [["CUSTOMER"]]
    assert result.role == "CUSTOMER"


def test_rbac_denial_is_safe_and_terminal() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda _request: response("DENY", "MEMBERSHIP_MISSING")
        )
    )
    authorizer = ApiRbacToolAuthorizer(
        rbac_client=RbacClient(
            "http://api.local",
            "worker-secret",
            client=client,
        ),
    )

    with pytest.raises(AgenticToolValidationError, match="AGENTIC_TOOL_RBAC_BLOCKED"):
        authorizer.authorize(
            tool_name="propose_gap_remediation",
            user_id="user-1",
            correlationId=uuid4(),
        )


def test_unregistered_rbac_role_fails_closed_without_network_call() -> None:
    called = False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return response("ALLOW")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    authorizer = ApiRbacToolAuthorizer(
        rbac_client=RbacClient(
            "http://api.local",
            "worker-secret",
            client=client,
        ),
    )

    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_RBAC_ROLE_UNREGISTERED",
    ):
        authorizer.authorize(
            tool_name="resume_waiting_runs",
            user_id="user-1",
            correlationId=uuid4(),
        )
    assert called is False


def test_rbac_network_failure_does_not_dispatch_as_allow() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    authorizer = ApiRbacToolAuthorizer(
        rbac_client=RbacClient(
            "http://api.local",
            "worker-secret",
            client=client,
        ),
    )

    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_RBAC_PREFLIGHT_FAILED",
    ):
        authorizer.authorize(
            tool_name="get_scan_coverage",
            user_id="user-1",
            correlationId=uuid4(),
        )
