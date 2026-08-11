import pytest
import httpx
from unittest.mock import patch, MagicMock
from pydantic import ValidationError

from lcsp_workers.platform.api_client import WorkerApiClient, WorkerCallbackError
from lcsp_workers.platform.callback_schemas import (
    ScanCallbackPayload,
    CallbackResponse,
    AIUsageFlowCallbackPayload,
    ConflictDetectionCallbackPayload,
    LegalRuleMatchCallbackPayload,
    TechnicalProfileCallbackPayload,
    VerifiedProfileCallbackPayload,
)
from lcsp_workers.platform.correlation import set_correlation_id

@pytest.fixture
def client():
    # Fast retry for tests by patching time.sleep
    with patch("lcsp_workers.platform.api_client.time.sleep"):
        yield WorkerApiClient(base_url="http://testserver", api_key="test-api-key")

@pytest.fixture
def dummy_payload():
    return ScanCallbackPayload(status="COMPLETED", findings=[])

def test_t01_successful_callback(client, dummy_payload):
    """T01: Successful callback parses response."""
    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
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
    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_post.return_value = mock_resp
        
        with pytest.raises(WorkerCallbackError) as exc_info:
            client.post_scan_callback("job123", dummy_payload)
            
        assert "server error 503" in str(exc_info.value)
        assert mock_post.call_count == 3

def test_t03_422_response(client, dummy_payload):
    """T03: 422 response is NOT retried, raises WorkerCallbackError immediately."""
    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 422
        mock_post.return_value = mock_resp
        
        with pytest.raises(WorkerCallbackError) as exc_info:
            client.post_scan_callback("job123", dummy_payload)
            
        assert "client error 422" in str(exc_info.value)
        assert mock_post.call_count == 1

def test_t04_network_timeout(client, dummy_payload):
    """T04: Network timeout is retried 3 times."""
    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
        mock_post.side_effect = httpx.TimeoutException("Timeout")
        
        with pytest.raises(WorkerCallbackError) as exc_info:
            client.post_scan_callback("job123", dummy_payload)
            
        assert "network request failed" in str(exc_info.value)
        assert mock_post.call_count == 3

def test_t05_t06_headers(client, dummy_payload):
    """T05 & T06: X-Worker-Api-Key and X-Correlation-Id are included in every request."""
    set_correlation_id("test-cid-999")
    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"success": True}
        mock_post.return_value = mock_resp
        
        client.post_scan_callback("job123", dummy_payload)
        
        _, kwargs = mock_post.call_args
        headers = kwargs.get("headers", {})
        assert headers.get("X-Worker-Api-Key") == "test-api-key"
        assert headers.get("X-Correlation-Id") == "test-cid-999"

def test_t07_raw_source_code_rejected():
    """T07: Raw source code or extra fields are rejected by Pydantic 'forbid' config."""
    with pytest.raises(ValidationError):
        ScanCallbackPayload(
            status="COMPLETED",
            findings=[],
            raw_source_code="print('hello')",  # Not allowed
        )


def test_callback_payload_is_redacted_before_serialization(client):
    """MW-pyp-003: callback payloads are redacted before httpx serialization."""
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

    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
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
                "description": "saw Bearer [REDACTED]",
                "metadata": {"api_key": "[REDACTED]"},
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

    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"success": True}
        mock_post.return_value = mock_resp

        client.post_scan_callback("job123", payload)

        _, kwargs = mock_post.call_args
        assert kwargs["json"]["privacy_flags"] == payload.privacy_flags


def test_requeue_targeted_reanalysis_request_uses_internal_worker_endpoint(client):
    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
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

    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
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


def test_profile_already_exists_is_an_idempotent_callback_result(client):
    payload = TechnicalProfileCallbackPayload(
        evidence_report_id="ter-1",
        assessment_id="assessment-1",
        schema_version="1.0.0",
        provider_version="lcsp.technical-profile-worker.v1",
        profile_data={},
        privacy_flags={"containsSourceCode": False, "secretsRedacted": True},
    )

    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 409
        mock_resp.json.return_value = {"problem": {"code": "PROFILE_ALREADY_EXISTS"}}
        mock_post.return_value = mock_resp

        response = client.post_technical_profile_callback(payload)

    assert response.accepted is True
    assert response.status == "duplicate"
    assert mock_post.call_count == 1


def test_get_accepted_technical_evidence_report_rejects_non_accepted(client):
    with patch("lcsp_workers.platform.api_client.httpx.get") as mock_get:
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

    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"accepted": True}
        mock_post.return_value = mock_resp

        client.post_ai_usage_flow_callback(payload)

        url = mock_post.call_args.args[0]
        assert url == "http://testserver/internal/ai-usage-flow/callback"


def test_get_accepted_technical_profile_rejects_non_accepted(client):
    with patch("lcsp_workers.platform.api_client.httpx.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "tp-1", "status": "rejected"}
        mock_get.return_value = mock_resp

        with pytest.raises(WorkerCallbackError, match="not accepted"):
            client.get_accepted_technical_profile("tp-1")


def test_get_wizard_profile_returns_none_for_404(client):
    with patch("lcsp_workers.platform.api_client.httpx.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        mock_get.return_value = mock_resp

        assert client.get_wizard_profile_for_assessment("assessment-1") is None


def test_reconciliation_conflict_callback_uses_internal_endpoint(client):
    payload = ConflictDetectionCallbackPayload(
        ai_usage_flow_id="auf-1",
        assessment_id="assessment-1",
        schema_version="1.0.0",
        provider_version="lcsp.conflict-detection-worker.v1",
        conflicts=[],
        privacy_flags={"containsSourceCode": False, "secretsRedacted": True},
    )

    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "accepted": True,
            "conflict_count": 0,
            "correlation_id": "correlation-1",
        }
        mock_post.return_value = mock_resp

        response = client.post_reconciliation_conflict_callback(payload)

        url = mock_post.call_args.args[0]
        assert url == "http://testserver/internal/reconciliation/conflict-callback"
        assert response.conflict_count == 0


def test_verified_profile_callback_uses_reconciliation_endpoint(client):
    payload = VerifiedProfileCallbackPayload(
        ai_usage_flow_id="auf-1",
        assessment_id="assessment-1",
        schema_version="1.0.0",
        provider_version="lcsp.verified-profile-worker.v1",
        profile_data={"verified_claims": []},
        gates_passed_at={"conflicts_resolved": "2026-07-25T09:30:00Z"},
    )

    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"accepted": True}
        mock_post.return_value = mock_resp

        client.post_verified_profile_callback(payload)

        url = mock_post.call_args.args[0]
        assert url == (
            "http://testserver/internal/reconciliation/verified-profile-callback"
        )


def test_verified_profile_pending_conflicts_error_preserves_error_code(client):
    payload = VerifiedProfileCallbackPayload(
        ai_usage_flow_id="auf-1",
        assessment_id="assessment-1",
        schema_version="1.0.0",
        provider_version="lcsp.verified-profile-worker.v1",
        profile_data={"verified_claims": []},
        gates_passed_at={"conflicts_resolved": "2026-07-25T09:30:00Z"},
    )

    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 409
        mock_resp.json.return_value = {"error_code": "PENDING_CONFLICTS_EXIST"}
        mock_post.return_value = mock_resp

        with pytest.raises(WorkerCallbackError, match="PENDING_CONFLICTS_EXIST"):
            client.post_verified_profile_callback(payload)


def test_legal_rule_match_callback_uses_classification_endpoint(client):
    payload = LegalRuleMatchCallbackPayload(
        verified_profile_id="vp-1",
        assessment_id="assessment-1",
        corpus_version_id="corpus-v1",
        legal_rule_catalog_version_id="catalog-v1",
        matches=[],
    )

    with patch("lcsp_workers.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"accepted": True}
        mock_post.return_value = mock_resp

        client.post_legal_rule_match_callback(payload)

        url = mock_post.call_args.args[0]
        assert url == "http://testserver/internal/classification/legal-rule-match-callback"


def test_get_verified_profile_reconciliation_context_uses_internal_endpoint(client):
    with patch("lcsp_workers.platform.api_client.httpx.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"ai_usage_flow": {"id": "auf-1"}}
        mock_get.return_value = mock_resp

        data = client.get_verified_profile_reconciliation_context(
            "assessment-1", "auf-1"
        )

        assert data == {"ai_usage_flow": {"id": "auf-1"}}
        url = mock_get.call_args.args[0]
        assert url == (
            "http://testserver/internal/reconciliation/"
            "verified-profile-context/assessment-1?ai_usage_flow_id=auf-1"
        )


def test_get_accepted_ai_usage_flow_rejects_non_ready_status(client):
    with patch("lcsp_workers.platform.api_client.httpx.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"id": "auf-1", "status": "draft"}
        mock_get.return_value = mock_resp

        with pytest.raises(WorkerCallbackError, match="not accepted"):
            client.get_accepted_ai_usage_flow("auf-1")
