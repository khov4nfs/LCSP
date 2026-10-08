import pytest
import httpx
from unittest.mock import patch, MagicMock
from pydantic import ValidationError

from tools.common.capabilities.platform.api_client import (
    WorkerApiClient,
    WorkerCallbackError,
)
from tools.common.capabilities.platform.callback_schemas import (
    ScanCallbackPayload,
    CallbackResponse,
    AIUsageFlowCallbackPayload,
    SettledUsagePayload,
    ConflictDetectionCallbackPayload,
    TechnicalProfileCallbackPayload,
)
from tools.common.capabilities.platform.correlation import set_correlationId


@pytest.fixture
def client():
    # Fast retry for tests by patching time.sleep
    with patch("tools.common.capabilities.platform.api_client.time.sleep"):
        yield WorkerApiClient(base_url="http://testserver", api_key="test-api-key")


@pytest.fixture
def dummy_payload():
    return ScanCallbackPayload(status="COMPLETED", findings=[])


def test_t01_successful_callback(client, dummy_payload):
    """T01: Successful callback parses response."""
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"success": True, "message": "OK"}
        mock_post.return_value = mock_resp

        response = client.post_scan_callback("job123", dummy_payload)

        assert isinstance(response, CallbackResponse)
        assert response.success is True
        assert response.message == "OK"
        mock_post.assert_called_once()
        assert mock_post.call_args.args[0] == (
            "http://testserver/internal/scan-jobs/job123/callback"
        )


def test_t02_5xx_response(client, dummy_payload):
    """T02: 5xx response is retried 3 times then raises WorkerCallbackError."""
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_post.return_value = mock_resp

        with pytest.raises(WorkerCallbackError) as exc_info:
            client.post_scan_callback("job123", dummy_payload)

        assert "server error 503" in str(exc_info.value)
        assert mock_post.call_count == 3


def test_post_settled_usage_sends_provider_reported_fields_without_reservation(client):
    payload = SettledUsagePayload(
        assessmentId="assessment-1",
        runId="run-1",
        invocationId="inv-1",
        agentRole="triage",
        provider="LLM7",
        model="future-model-v99",
        inputTokens="10",
        outputTokens="5",
        occurredAt="2026-01-01T00:00:00Z",
    )
    response = httpx.Response(200, json={"ok": True, "data": {"status": "ok"}})

    with patch(
        "tools.common.capabilities.platform.api_client.httpx.post",
        return_value=response,
    ) as mock_post:
        client.post_settled_usage(payload)

    body = mock_post.call_args.kwargs["json"]
    assert "reservationId" not in body
    assert body["inputTokens"] == "10"
    assert not any("price" in k.lower() or "charge" in k.lower() for k in body)
    with pytest.raises(ValidationError):
        SettledUsagePayload(**{**payload.model_dump(), "reservationId": "r"})


def test_t03_422_response(client, dummy_payload):
    """T03: 422 response is NOT retried, raises WorkerCallbackError immediately."""
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 422
        mock_post.return_value = mock_resp

        with pytest.raises(WorkerCallbackError) as exc_info:
            client.post_scan_callback("job123", dummy_payload)

        assert "client error 422" in str(exc_info.value)
        assert mock_post.call_count == 1


def test_t04_network_timeout(client, dummy_payload):
    """T04: Network timeout is retried 3 times."""
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_post.side_effect = httpx.TimeoutException("Timeout")

        with pytest.raises(WorkerCallbackError) as exc_info:
            client.post_scan_callback("job123", dummy_payload)

        assert "network request failed" in str(exc_info.value)
        assert mock_post.call_count == 3


def test_t05_t06_headers(client, dummy_payload):
    """T05 & T06: X-Worker-Api-Key and X-Correlation-Id are included in every request."""
    set_correlationId("test-cid-999")
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"success": True}
        mock_post.return_value = mock_resp

        client.post_scan_callback("job123", dummy_payload)

        _, kwargs = mock_post.call_args
        headers = kwargs.get("headers", {})
        assert headers.get("X-Worker-Api-Key") == "test-api-key"
        assert headers.get("X-Correlation-Id") == "test-cid-999"


def test_scan_runtime_event_posts_best_effort_metadata(client):
    """Runtime progress uses the worker-auth internal endpoint and sanitized payload."""
    set_correlationId("runtime-cid-1")
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_post.return_value = mock_resp

        client.post_scan_runtime_event(
            "job123",
            {
                "event_type": "TOOL_STARTED",
                "run_status": "RUNNING",
                "stage": "SCAN",
                "tool_name": "repository-analysis",
                "summary": "Starting repository analysis",
                "input_summary": {"api_key": "secret-token"},
            },
        )

        mock_post.assert_called_once()
        assert mock_post.call_args.args[0] == (
            "http://testserver/internal/scan-jobs/job123/runtime-events"
        )
        _, kwargs = mock_post.call_args
        assert kwargs["headers"]["X-Worker-Api-Key"] == "test-api-key"
        assert kwargs["headers"]["X-Correlation-Id"] == "runtime-cid-1"
        assert kwargs["timeout"] == 3.0
        assert kwargs["json"]["input_summary"]["api_key"] == ""


def test_scan_runtime_event_preserves_safe_runtime_message_metadata(client):
    """Runtime activity keeps contract message keys/params while redacting secrets."""
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_post.return_value = mock_resp

        client.post_scan_runtime_event(
            "job123",
            {
                "event_type": "TOOL_COMPLETED",
                "run_status": "WAITING",
                "stage": "TECHNICAL_EVIDENCE",
                "tool_name": "engineering_rule_plan:eng-1",
                "summary": "ENGINEERING_RULE_PLANNER_DECISION",
                "output_summary": {
                    "messageKey": "ENGINEERING_RULE_PLANNER_DECISION",
                    "reasonCode": "SOURCE_SCOPE_MATCH",
                    "messageParams": {
                        "decision": "SELECT",
                        "engineeringRuleId": "eng-1",
                        "reasonCode": "SOURCE_SCOPE_MATCH",
                    },
                    "api_key": "secret-token",
                },
            },
        )

        _, kwargs = mock_post.call_args
        summary = kwargs["json"]["output_summary"]
        assert summary["messageKey"] == "ENGINEERING_RULE_PLANNER_DECISION"
        assert summary["reasonCode"] == "SOURCE_SCOPE_MATCH"
        assert summary["messageParams"] == {
            "decision": "SELECT",
            "engineeringRuleId": "eng-1",
            "reasonCode": "SOURCE_SCOPE_MATCH",
        }
        assert summary["api_key"] == ""


def test_scan_runtime_event_failure_does_not_fail_scan(client):
    """Runtime progress is best-effort and never raises into scan execution."""
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_post.side_effect = httpx.TimeoutException("runtime timeout")

        client.post_scan_runtime_event(
            "job123",
            {
                "event_type": "TOOL_STARTED",
                "run_status": "RUNNING",
                "stage": "SCAN",
                "summary": "Starting",
            },
        )

        mock_post.assert_called_once()


def test_agent_stream_network_failure_opens_short_best_effort_backoff(client, monkeypatch):
    """A dead API must not create one ConnectError per streamed token/tool event."""
    from tools.common.capabilities.platform import api_client as api_client_module

    clock = {"now": 100.0}
    monkeypatch.setattr(api_client_module.time, "monotonic", lambda: clock["now"])
    payload = {
        "assessment_id": "assessment-1",
        "run_id": "run-1",
        "event_type": "MODEL_REQUEST",
        "client_sequence": 1,
    }

    with patch(
        "tools.common.capabilities.platform.api_client.httpx.post",
        side_effect=httpx.ConnectError("api unavailable"),
    ) as mock_post:
        client.post_agent_stream_event(payload)
        client.post_agent_stream_event({**payload, "client_sequence": 2})
        assert mock_post.call_count == 1

        clock["now"] += api_client_module._AGENT_STREAM_NETWORK_BACKOFF_SECONDS + 0.01
        client.post_agent_stream_event({**payload, "client_sequence": 3})
        assert mock_post.call_count == 2


def test_agent_stream_rejection_keeps_safe_event_identity_in_warning(client, monkeypatch):
    """Rejected stream events log bounded identity instead of dumping the payload."""
    from tools.common.capabilities.platform import api_client as api_client_module

    fake_logger = MagicMock()
    monkeypatch.setattr(api_client_module, "logger", fake_logger)
    response = MagicMock()
    response.status_code = 400
    response.json.return_value = {
        "ok": False,
        "problem": {"code": "BAD_REQUEST"},
    }
    payload = {
        "assessment_id": "assessment-1",
        "run_id": "run-1",
        "event_type": "MODEL_REQUEST",
        "client_sequence": 7,
        "text": "must not be logged",
    }

    with patch(
        "tools.common.capabilities.platform.api_client.httpx.post",
        return_value=response,
    ):
        client.post_agent_stream_event(payload)

    fake_logger.warning.assert_called_once_with(
        "AGENT_STREAM_EVENT_REJECTED",
        status_code=400,
        error_code="BAD_REQUEST",
        event_type="MODEL_REQUEST",
        run_id="run-1",
        client_sequence=7,
    )


def test_t07_raw_source_code_rejected():
    """T07: Raw source code or extra fields are rejected by Pydantic 'forbid' config."""
    with pytest.raises(ValidationError):
        ScanCallbackPayload(
            status="COMPLETED",
            findings=[],
            raw_source_code="print('hello')",  # Not allowed
        )


def test_callback_payload_strips_raw_source_and_secret_values(client):
    """MW-pyp-003: callback payloads strip raw source and secrets before serialization."""
    payload = ScanCallbackPayload(
        status="COMPLETED",
        findings=[
            {
                "finding_type": "SAFE",
                "description": "saw Bearer abc.def-ghi_123",
                "metadata": {"api_key": "secret-key-value"},
            },
            {
                "finding_type": "RAW_CODE",
                "snippet": "function run() {\n  return token;\n}",
            },
        ],
    )

    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"success": True}
        mock_post.return_value = mock_resp

        client.post_scan_callback("job123", payload)

        _, kwargs = mock_post.call_args
        serialized_payload = kwargs["json"]
        assert serialized_payload["findings"] == [
            {
                "finding_type": "SAFE",
                "description": "saw Bearer",
                "metadata": {"api_key": ""},
            }
        ]


def test_scan_callback_preserves_boolean_privacy_flags(client):
    payload = ScanCallbackPayload(
        status="PARTIAL",
        scan_job_id="job123",
        tools_version={"deepagents": "0.7.17", "repository-analysis": "1.0.0"},
        config_hash={"repository-analysis": "sha256:test"},
        evidence_payload={"coverage_notes": []},
        privacy_flags={
            "containsSourceCode": False,
            "secretsRedacted": True,
            "sourceStrippedFromFindings": True,
        },
    )

    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"success": True}
        mock_post.return_value = mock_resp

        client.post_scan_callback("job123", payload)

        _, kwargs = mock_post.call_args
        assert kwargs["json"]["privacy_flags"] == payload.privacy_flags


def test_scan_callback_preserves_repository_analysis_tool_provenance(client):
    payload = ScanCallbackPayload(
        status="SUCCESS",
        scan_job_id="job123",
        tools_version={"repository-analysis": "1.0.0"},
        config_hash={"repository-analysis": "sha256:abc123"},
        evidence_payload={"metadata": {"api_key": "secret-key-value"}},
        privacy_flags={"containsSourceCode": False, "secretsRedacted": True},
    )

    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"success": True}
        mock_post.return_value = mock_resp

        client.post_scan_callback("job123", payload)

        _, kwargs = mock_post.call_args
        serialized_payload = kwargs["json"]
        assert serialized_payload["tools_version"] == {
            "repository-analysis": "1.0.0"
        }
        assert serialized_payload["config_hash"] == {
            "repository-analysis": "sha256:abc123"
        }
        assert serialized_payload["evidence_payload"]["metadata"]["api_key"] == ""


def test_dispatch_agentic_tool_uses_internal_runtime_endpoint(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"ok": True, "data": {"status": "READY"}}
        mock_post.return_value = mock_resp

        response = client.dispatch_agentic_tool(
            {
                "tool_name": "get_scan_coverage",
                "assessment_id": "assessment-1",
                "user_id": "user-1",
                "artifact_versions": {"technicalEvidenceReportId": "report-1"},
                "input": {"maxResults": 10},
                "correlationId": "corr-1",
            }
        )

        assert response["status"] == "READY"
        assert mock_post.call_args.args[0] == (
            "http://testserver/internal/evidence/agentic-tools/dispatch"
        )


def test_resume_waiting_runs_uses_internal_legal_catalog_endpoint(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.json.return_value = {
            "ok": True,
            "data": {"resumedRunCount": 3},
        }
        mock_post.return_value = mock_resp

        response = client.resume_waiting_runs(
            "corpus-1",
            {"maxRuns": 10, "idempotencyKey": "resume_waiting_runs_0001"},
        )

        assert response["resumedRunCount"] == 3
        assert mock_post.call_args.args[0] == (
            "http://testserver/internal/legal-rule-catalog/corpus/corpus-1/resume-waiting-runs"
        )


def test_get_accepted_technical_evidence_report_rejects_non_accepted(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "ter-1", "status": "rejected"}
        mock_get.return_value = mock_resp

        with pytest.raises(WorkerCallbackError, match="not accepted"):
            client.get_accepted_technical_evidence_report("ter-1")


def test_get_official_source_snapshot_uses_query_params(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"snapshotRef": "snapshot:LAW-TEST:abcd1234ef56"}
        mock_get.return_value = mock_resp

        response = client.get_official_source_snapshot(
            snapshot_ref="snapshot:LAW-TEST:abcd1234ef56"
        )

    assert response["snapshotRef"] == "snapshot:LAW-TEST:abcd1234ef56"
    assert mock_get.call_args.args[0] == (
        "http://testserver/internal/legal-rule-catalog/source-snapshots"
    )
    assert mock_get.call_args.kwargs["params"] == {
        "snapshot_ref": "snapshot:LAW-TEST:abcd1234ef56"
    }


def test_callback_response_accepts_nested_result_envelope():
    # Test flat dictionary representation matching CallbackResponse
    flat_data = {
        "success": True,
        "accepted": True,
        "verifiedProfileId": "vp-123",
        "status": "SUCCESS"
    }
    resp1 = CallbackResponse(**flat_data)
    assert resp1.success is True
    assert resp1.accepted is True
    assert resp1.verified_profile_id == "vp-123"

    # Test nested "result" shape
    nested_data = {
        "success": True,
        "accepted": True,
        "result": {
            "verifiedProfileId": "vp-nested-999",
            "lifecycleStatus": "VERIFIED",
            "factEvidenceRefs": ["fact-1"],
            "sourceArtifactRefs": ["source-1"],
            "outboxEventRef": "outbox-1"
        }
    }
    resp2 = CallbackResponse(**nested_data)
    assert resp2.success is True
    assert resp2.accepted is True
    assert resp2.verified_profile_id == "vp-nested-999"
    # Ensure extra items in result did not raise ValidationError under model_config extra ignore
    assert resp2.model_dump().get("verified_profile_id") == "vp-nested-999"


def test_scan_claim_not_found_preserves_typed_error_code(client):
    response = httpx.Response(
        404,
        json={
            "ok": False,
            "problem": {"code": "SCAN_JOB_NOT_FOUND"},
        },
    )

    with patch(
        "tools.common.capabilities.platform.api_client.httpx.post",
        return_value=response,
    ) as post:
        with pytest.raises(WorkerCallbackError) as caught:
            client.claim_scan_job(
                "scan-deleted",
                {"boundary_name": "scan_requested", "timeout_seconds": 1800},
            )

    assert caught.value.status_code == 404
    assert caught.value.error_code == "SCAN_JOB_NOT_FOUND"
    assert caught.value.callback_client_error is True
    post.assert_called_once()
