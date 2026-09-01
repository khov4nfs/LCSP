from __future__ import annotations

from types import SimpleNamespace

import pytest

from orchestration.context import LCSPRunContext
from tools.common.runtime_envelope import (
    AgenticToolInvocationError,
    AgenticToolRequest,
    trusted_agentic_tool_request,
)


def test_runtime_context_supplies_trusted_identity() -> None:
    runtime = SimpleNamespace(
        context=LCSPRunContext(
            assessment_id="assessment-trusted",
            user_id="user-trusted",
            workflow_run_id="run-trusted",
            artifact_versions={"technicalEvidenceReportId": "report-trusted"},
        )
    )

    request = trusted_agentic_tool_request(
        {
            "input": {"subjectRef": "symbol:1"},
        },
        runtime,
    )

    assert request.assessment_id == "assessment-trusted"
    assert request.user_id == "user-trusted"
    assert request.workflow_run_id == "run-trusted"
    assert request.artifact_versions == {"technicalEvidenceReportId": "report-trusted"}


def test_agentic_tool_request_no_longer_requires_model_authored_user_id() -> None:
    schema = AgenticToolRequest.model_json_schema()
    properties = schema.get("properties", {})

    assert "user_id" not in schema.get("required", [])
    assert "assessment_id" not in schema.get("required", [])
    assert "assessment_id" not in properties
    assert "user_id" not in properties
    assert "workflow_run_id" not in properties
    assert "artifact_versions" not in properties


def test_runtime_envelope_fails_closed_without_trusted_or_legacy_identity() -> None:
    with pytest.raises(AgenticToolInvocationError, match="ToolRuntime context"):
        trusted_agentic_tool_request({"input": {}}, None)
