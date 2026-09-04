import pytest
import httpx
from unittest.mock import patch, MagicMock
from pydantic import ValidationError

from tools.common.capabilities.platform.api_client import WorkerApiClient, WorkerCallbackError
from tools.common.capabilities.platform.callback_schemas import (
    ScanCallbackPayload,
    CallbackResponse,
    AIUsageFlowCallbackPayload,
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
                "tool_name": "semgrep_secret_detect",
                "summary": "Starting secret detection",
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
        tools_version={"scanner": "1.0.0"},
        config_hash={"scanner": "sha256:test"},
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


def test_scan_callback_preserves_secret_detection_tool_provenance(client):
    payload = ScanCallbackPayload(
        status="SUCCESS",
        scan_job_id="job123",
        tools_version={"semgrep_secret_detect": "1.173.0"},
        config_hash={"semgrep_secret_detect": "sha256:abc123"},
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
            "semgrep_secret_detect": "1.173.0"
        }
        assert serialized_payload["config_hash"] == {
            "semgrep_secret_detect": "sha256:abc123"
        }
        assert serialized_payload["evidence_payload"]["metadata"]["api_key"] == ""


def test_requeue_targeted_reanalysis_request_uses_internal_worker_endpoint(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"ok": True, "data": {"requeued": True}}
        mock_post.return_value = mock_resp

        assert client.requeue_targeted_reanalysis_request("request-1") is True

    assert mock_post.call_args.args[0] == (
        "http://testserver/internal/targeted-reanalysis/request-1/requeue"
    )


def test_technical_profile_callback_uses_evidence_endpoint(client):
    payload = TechnicalProfileCallbackPayload(
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        schema_version="1.0.0",
        provider_version="lcsp.technical-profile-worker.v1",
        profile_data={"evidence_quality": "high"},
        privacy_flags={"containsSourceCode": False, "secretsRedacted": True},
    )

    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "accepted": True,
            "technical_profile_id": "technical-profile-1",
        }
        mock_post.return_value = mock_resp

        response = client.post_technical_profile_callback(payload)

        url = mock_post.call_args.args[0]
        assert url == "http://testserver/internal/evidence/technical-profile-callback"
        assert response.technical_profile_id == "technical-profile-1"




def test_large_technical_profile_callback_uses_artifact_with_inline_fallback(
    client, monkeypatch
):
    monkeypatch.setenv("LCSP_PROFILE_CALLBACK_THRESHOLD", "1")
    monkeypatch.setenv("LCSP_PROFILE_CALLBACK_CHUNK_SIZE", "64")
    payload = TechnicalProfileCallbackPayload(
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        schema_version="2.0.0",
        provider_version="lcsp.technical-profile-worker.v2",
        profile_data={"evidence_quality": "high", "profile_data_ref": "/tmp/profile.json"},
        privacy_flags={"containsSourceCode": False, "secretsRedacted": True},
        scan_job_id="scan-job-1",
    )

    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "accepted": True,
            "technical_profile_id": "technical-profile-1",
        }
        mock_post.return_value = mock_resp

        client.post_technical_profile_callback(payload)

    sent_payload = mock_post.call_args.kwargs["json"]
    assert sent_payload["is_artifact_reference"] is True
    assert sent_payload["artifact_manifest"]["chunks"]
    assert sent_payload["profile_data"] == payload.profile_data

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


def test_create_targeted_reanalysis_request_uses_internal_api_endpoint(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.json.return_value = {"ok": True, "data": {"state": "QUEUED"}}
        mock_post.return_value = mock_resp

        response = client.create_targeted_reanalysis_request(
            {"assessmentId": "assessment-1"}
        )

        assert response["state"] == "QUEUED"
        assert mock_post.call_args.args[0] == (
            "http://testserver/internal/scan-jobs/targeted-reanalysis"
        )


def test_interview_private_context_uses_internal_worker_endpoint(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"ok": True, "data": {"status": "CURRENT"}}
        mock_get.return_value = mock_resp

        response = client.get_interview_private_context(
            "assessment-1",
            3,
            source_version="snapshot-1:abc",
            pge_version="ter-1:v1",
        )

        assert response["status"] == "CURRENT"
        assert mock_get.call_args.args[0] == (
            "http://testserver/internal/assessment-interviews/assessment-1/private-context/3"
        )
        assert mock_get.call_args.kwargs["params"] == {
            "source_version": "snapshot-1:abc",
            "pge_version": "ter-1:v1",
        }


def test_interview_agent_decision_uses_internal_worker_endpoint(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"ok": True, "data": {"outcome": "CONTEXT_READY"}}
        mock_post.return_value = mock_resp

        response = client.post_interview_agent_decision(
            "assessment-1",
            {"expectedContextRevision": 3, "outcome": "CONTEXT_READY"},
        )

        assert response["outcome"] == "CONTEXT_READY"
        assert mock_post.call_args.args[0] == (
            "http://testserver/internal/assessment-interviews/assessment-1/agent-decisions"
        )
        assert mock_post.call_args.kwargs["json"] == {
            "expectedContextRevision": 3,
            "outcome": "CONTEXT_READY",
        }


def test_interview_agent_decision_preserves_context_authority(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.json.return_value = {"ok": True, "data": {"outcome": "CONTEXT_READY"}}
        mock_post.return_value = mock_resp

        response = client.post_interview_agent_decision(
            "assessment-1",
            {
                "expectedContextRevision": 3,
                "outcome": "CONTEXT_READY",
                "contextAuthority": "CONFIRMED",
                "confirmedContext": {"system_purpose": "recommendation"},
            },
        )

        assert response["outcome"] == "CONTEXT_READY"
        assert mock_post.call_args.kwargs["json"]["contextAuthority"] == "CONFIRMED"
        assert mock_post.call_args.kwargs["json"]["confirmedContext"] == {
            "system_purpose": "recommendation"
        }


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


def test_recover_legal_rules_from_active_corpus_uses_internal_worker_endpoint(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "ok": True,
            "data": {"id": "catalog-1", "ruleCount": 3},
        }
        mock_post.return_value = mock_resp

        response = client.recover_legal_rules_from_active_corpus(
            {"idempotencyKey": "recover-legal-rules-1"}
        )

        assert response["id"] == "catalog-1"
        assert response["ruleCount"] == 3
        assert mock_post.call_args.args[0] == (
            "http://testserver/internal/legal-rule-catalog/rules/recover-from-active-corpus"
        )


def test_profile_already_exists_is_an_idempotent_callback_result(client):
    payload = TechnicalProfileCallbackPayload(
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        schema_version="1.0.0",
        provider_version="lcsp.technical-profile-worker.v1",
        profile_data={},
        privacy_flags={"containsSourceCode": False, "secretsRedacted": True},
    )

    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 409
        mock_resp.json.return_value = {"problem": {"code": "PROFILE_ALREADY_EXISTS"}}
        mock_post.return_value = mock_resp

        response = client.post_technical_profile_callback(payload)

    assert response.accepted is True
    assert response.status == "duplicate"
    assert mock_post.call_count == 1


def test_get_accepted_technical_evidence_report_rejects_non_accepted(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "ter-1", "status": "rejected"}
        mock_get.return_value = mock_resp

        with pytest.raises(WorkerCallbackError, match="not accepted"):
            client.get_accepted_technical_evidence_report("ter-1")


def test_ai_usage_flow_callback_uses_internal_ai_usage_flow_endpoint(client):
    payload = AIUsageFlowCallbackPayload(
        technical_profile_id="tp-1",
        assessment_id="assessment-1",
        schema_version="1.0.0",
        provider_version="lcsp.ai-usage-flow-worker.v1",
        claims=[],
        unknown_usages=[],
        privacy_flags={"containsSourceCode": False, "secretsRedacted": True},
    )

    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"accepted": True}
        mock_post.return_value = mock_resp

        client.post_ai_usage_flow_callback(payload)

        url = mock_post.call_args.args[0]
        assert url == "http://testserver/internal/ai-usage-flow/callback"


def test_get_accepted_technical_profile_rejects_non_accepted(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "tp-1", "status": "rejected"}
        mock_get.return_value = mock_resp

        with pytest.raises(WorkerCallbackError, match="not accepted"):
            client.get_accepted_technical_profile("tp-1")


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


def test_reconciliation_conflict_callback_uses_internal_endpoint(client):
    payload = ConflictDetectionCallbackPayload(
        ai_usage_flow_id="auf-1",
        assessment_id="assessment-1",
        schema_version="1.0.0",
        provider_version="lcsp.conflict-detection-worker.v1",
        conflicts=[],
        privacy_flags={"containsSourceCode": False, "secretsRedacted": True},
    )

    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "accepted": True,
            "conflict_count": 0,
            "correlationId": "correlation-1",
        }
        mock_post.return_value = mock_resp

        response = client.post_reconciliation_conflict_callback(payload)

        url = mock_post.call_args.args[0]
        assert url == "http://testserver/internal/reconciliation/conflict-callback"
        assert response.conflict_count == 0


def test_get_accepted_ai_usage_flow_rejects_non_ready_status(client):
    with patch("tools.common.capabilities.platform.api_client.httpx.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "auf-1", "status": "draft"}
        mock_get.return_value = mock_resp

        with pytest.raises(WorkerCallbackError, match="not accepted"):
            client.get_accepted_ai_usage_flow("auf-1")


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
