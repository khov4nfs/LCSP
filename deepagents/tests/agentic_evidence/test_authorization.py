from __future__ import annotations

import json
from uuid import uuid4

import httpx
import pytest

from tools.common.capabilities.agentic_evidence.governance.authorization import ApiPbacToolAuthorizer
from tools.common.capabilities.agentic_evidence.governance.registry import AgenticToolValidationError
from tools.common.capabilities.platform.pbac_client import PbacClient


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


def test_technical_tool_accepts_redacted_read_when_full_read_is_denied() -> None:
    seen_actions: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        seen_actions.append(payload["action"])
        assert request.headers["x-worker-api-key"] == "worker-secret"
        if payload["action"] == "evidence:read":
            return response("DENY", "ACTION_NOT_GRANTED")
        return response("ALLOW")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    authorizer = ApiPbacToolAuthorizer(
        pbac_client=PbacClient(
            "http://api.local",
            "worker-secret",
            client=client,
        ),
    )

    result = authorizer.authorize(
        tool_name="get_scan_coverage",
        user_id="user-1",
        organization_id="org-1",
        correlationId=uuid4(),
    )

    assert seen_actions == ["evidence:read", "evidence:read:redacted"]
    assert result.action == "evidence:read:redacted"


def test_pbac_denial_is_safe_and_terminal() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda _request: response("DENY", "MEMBERSHIP_MISSING")
        )
    )
    authorizer = ApiPbacToolAuthorizer(
        pbac_client=PbacClient(
            "http://api.local",
            "worker-secret",
            client=client,
        ),
    )

    with pytest.raises(AgenticToolValidationError, match="AGENTIC_TOOL_PBAC_BLOCKED"):
        authorizer.authorize(
            tool_name="propose_gap_remediation",
            user_id="user-1",
            organization_id="org-1",
            correlationId=uuid4(),
        )


def test_unregistered_pbac_action_fails_closed_without_network_call() -> None:
    called = False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return response("ALLOW")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    authorizer = ApiPbacToolAuthorizer(
        pbac_client=PbacClient(
            "http://api.local",
            "worker-secret",
            client=client,
        ),
    )

    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_PBAC_ACTION_UNREGISTERED",
    ):
        authorizer.authorize(
            tool_name="resume_waiting_runs",
            user_id="user-1",
            organization_id="org-1",
            correlationId=uuid4(),
        )
    assert called is False


def test_pbac_network_failure_does_not_dispatch_as_allow() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    authorizer = ApiPbacToolAuthorizer(
        pbac_client=PbacClient(
            "http://api.local",
            "worker-secret",
            client=client,
        ),
    )

    with pytest.raises(
        AgenticToolValidationError,
        match="AGENTIC_TOOL_PBAC_PREFLIGHT_FAILED",
    ):
        authorizer.authorize(
            tool_name="get_scan_coverage",
            user_id="user-1",
            organization_id="org-1",
            correlationId=uuid4(),
        )
