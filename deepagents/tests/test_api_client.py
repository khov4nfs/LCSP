import pytest
import httpx
from unittest.mock import patch, MagicMock
from pydantic import ValidationError

from tools.common.capabilities.platform.api_client import (
    WorkerApiClient,
    WorkerCallbackError,
)
from tools.common.capabilities.platform.callback_schemas import (
    SettledUsagePayload,
)
from tools.common.capabilities.platform.correlation import set_correlationId


@pytest.fixture
def client():
    # Fast retry for tests by patching time.sleep
    with patch("tools.common.capabilities.platform.api_client.time.sleep"):
        yield WorkerApiClient(base_url="http://testserver", api_key="test-api-key")


@pytest.fixture
def dummy_payload():
    return SettledUsagePayload(assessmentId="assessment-1", runId="run-1", invocationId="inv-1", agentRole="ASSESSMENT_ROOT", provider="APX", model="test-model", inputTokens="10", outputTokens="5", occurredAt="2026-01-01T00:00:00Z")


def test_t01_successful_callback(client, dummy_payload):
    """T01: Successful callback parses response."""
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"ok": True, "data": {"accepted": True}}
        mock_post.return_value = mock_resp

        response = client.post_settled_usage(dummy_payload)

        assert response.accepted is True
        mock_post.assert_called_once()
        assert mock_post.call_args.args[0] == (
            "http://testserver/internal/billing/usage"
        )


def test_t02_5xx_response(client, dummy_payload):
    """T02: 5xx response is retried 3 times then raises WorkerCallbackError."""
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_post.return_value = mock_resp

        with pytest.raises(WorkerCallbackError) as exc_info:
            client.post_settled_usage(dummy_payload)

        assert "server error 503" in str(exc_info.value)
        assert mock_post.call_count == 3


def test_post_settled_usage_sends_provider_reported_fields_without_reservation(client):
    payload = SettledUsagePayload(
        assessmentId="assessment-1",
        runId="run-1",
        invocationId="inv-1",
        agentRole="ASSESSMENT_ROOT",
        provider="APX",
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
            client.post_settled_usage(dummy_payload)

        assert "client error 422" in str(exc_info.value)
        assert mock_post.call_count == 1


def test_t04_network_timeout(client, dummy_payload):
    """T04: Network timeout is retried 3 times."""
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_post.side_effect = httpx.TimeoutException("Timeout")

        with pytest.raises(WorkerCallbackError) as exc_info:
            client.post_settled_usage(dummy_payload)

        assert "network request failed" in str(exc_info.value)
        assert mock_post.call_count == 3


def test_t05_t06_headers(client, dummy_payload):
    """T05 & T06: X-Worker-Api-Key and X-Correlation-Id are included in every request."""
    set_correlationId("test-cid-999")
    with patch("tools.common.capabilities.platform.api_client.httpx.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"ok": True, "data": {"accepted": True}}
        mock_post.return_value = mock_resp

        client.post_settled_usage(dummy_payload)

        _, kwargs = mock_post.call_args
        headers = kwargs.get("headers", {})
        assert headers.get("X-Worker-Api-Key") == "test-api-key"
        assert headers.get("X-Correlation-Id") == "test-cid-999"


@pytest.mark.parametrize("method,args", [
    ("ingest_validated_legal_source_draft", ({},)),
    ("register_validated_retrieval_index", ("legal_source-1", {})),
    ("activate_validated_legal_source_version", ("legal_source-1", {})),
    ("claim_rule_set_preparation", ("preparation-1",)),
    ("validate_compliance_rule_set", ("preparation-1", {})),
    ("submit_compliance_rule_set", ("preparation-1", "submit-1", {})),
    ("fail_rule_set_preparation", ("preparation-1", "SOURCE_VERSION_UNAVAILABLE")),
])
def test_legal_callbacks_do_not_present_native_run_as_assessment_turn(client, method, args):
    from orchestration.runtime_control import active_runtime_run_id

    token = active_runtime_run_id.set("native-server-run-1")
    try:
        def respond(url, **kwargs):
            # The real assessment fence rejects an unrelated native run before legal claim.
            if "x-lcsp-runtime-run-id" in kwargs["headers"]:
                return httpx.Response(409, json={"ok": False, "problem": {
                    "code": "RUNTIME_CONTROL_TARGET_STALE",
                }})
            assert kwargs["headers"]["X-Worker-Api-Key"] == "test-api-key"
            return httpx.Response(200, json={"ok": True, "data": {"accepted": True}})

        with patch("tools.common.capabilities.platform.api_client.httpx.post", side_effect=respond) as post:
            assert getattr(client, method)(*args) == {"accepted": True}
            post.assert_called_once()
    finally:
        active_runtime_run_id.reset(token)


def test_legal_callback_still_rejects_a_cancelled_execution(client):
    from threading import Event
    from orchestration.agent_stream import active_agent_stream_cancel, AgentStreamInterrupted

    cancel = Event()
    cancel.set()
    token = active_agent_stream_cancel.set(cancel)
    try:
        with patch("tools.common.capabilities.platform.api_client.httpx.post") as post:
            with pytest.raises(AgentStreamInterrupted):
                client.claim_rule_set_preparation("preparation-1")
            post.assert_not_called()
    finally:
        active_agent_stream_cancel.reset(token)


@pytest.mark.parametrize("method,args", [
    ("validate_compliance_rule_set", ("preparation-1", {})),
    ("submit_compliance_rule_set", ("preparation-1", "submit-1", {})),
])
def test_legal_packet_shape_error_returns_only_schema_paths(client, method, args):
    fields = "packet.contextRelations.0.relationId,packet.contextRelations.0.toLegalRequirementId"
    response = httpx.Response(400, json={"ok": False, "problem": {
        "code": "COMPLIANCE_RULE_SET_SUBMIT_REQUEST_INVALID",
        "meta": {"issues": fields, "input": "PRIVATE_PACKET_VALUE"},
    }})
    with patch("tools.common.capabilities.platform.api_client.httpx.post", return_value=response) as post:
        with pytest.raises(WorkerCallbackError) as caught:
            getattr(client, method)(*args)
    assert str(caught.value).endswith("Invalid fields: " + fields)
    assert "PRIVATE_PACKET_VALUE" not in str(caught.value)
    assert caught.value.status_code == 400
    post.assert_called_once()


@pytest.mark.parametrize("issues", ["private-input", "packet.credential=PRIVATE", "packet." + "x" * 4000,
                                  ",".join(["packet.legalRequirements"] * 21), None, ["packet"]])
def test_legal_packet_shape_error_rejects_unbounded_or_non_path_metadata(client, issues):
    response = httpx.Response(400, json={"ok": False, "problem": {
        "code": "COMPLIANCE_RULE_SET_SUBMIT_REQUEST_INVALID", "meta": {"issues": issues},
    }})
    with patch("tools.common.capabilities.platform.api_client.httpx.post", return_value=response):
        with pytest.raises(WorkerCallbackError) as caught:
            client.validate_compliance_rule_set("preparation-1", {})
    assert "Invalid fields:" not in str(caught.value)


@pytest.mark.parametrize("method,args", [
    ("validate_compliance_rule_set", ("preparation-1", {})),
    ("submit_compliance_rule_set", ("preparation-1", "submit-1", {})),
])
def test_legal_packet_shape_error_adds_the_structural_requirement(client, method, args):
    field = "packet.legalRequirements.0.coverage.nonAssessableReason"
    requirement = "COVERED_BY_ASSESSMENT_RULES requires nonAssessableReason to be null"
    response = httpx.Response(400, json={"ok": False, "problem": {
        "code": "COMPLIANCE_RULE_SET_SUBMIT_REQUEST_INVALID",
        "meta": {"issues": field, "requirements": requirement},
    }})
    with patch("tools.common.capabilities.platform.api_client.httpx.post", return_value=response):
        with pytest.raises(WorkerCallbackError) as caught:
            getattr(client, method)(*args)
    assert str(caught.value).endswith(f"Invalid fields: {field} Requirements: {requirement}")


@pytest.mark.parametrize("requirements", ["line one\nline two", "contains \"quotes\" and {braces}", "x" * 801, 7, ["a"], ""])
def test_legal_packet_shape_error_drops_unbounded_or_non_text_requirements(client, requirements):
    field = "packet.legalRequirements.0.coverage.nonAssessableReason"
    response = httpx.Response(400, json={"ok": False, "problem": {
        "code": "COMPLIANCE_RULE_SET_SUBMIT_REQUEST_INVALID",
        "meta": {"issues": field, "requirements": requirements},
    }})
    with patch("tools.common.capabilities.platform.api_client.httpx.post", return_value=response):
        with pytest.raises(WorkerCallbackError) as caught:
            client.validate_compliance_rule_set("preparation-1", {})
    assert str(caught.value).endswith("Invalid fields: " + field)
    assert "Requirements:" not in str(caught.value)


def test_agent_stream_presents_canonical_lease_without_a_native_turn_fence(client):
    payload = {"data": {"runtimeRunId": "native-server-run-1"}}
    with patch("tools.common.capabilities.platform.api_client.httpx.post",
               return_value=httpx.Response(202)) as post:
        client.post_agent_stream_event(payload, lease_token="canonical-lease-1")
    headers = post.call_args.kwargs["headers"]
    assert headers["x-assessment-lease"] == "canonical-lease-1"
    assert "x-lcsp-runtime-run-id" not in headers








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
        "http://testserver/internal/legal-sources/source-snapshots"
    )
    assert mock_get.call_args.kwargs["params"] == {
        "snapshot_ref": "snapshot:LAW-TEST:abcd1234ef56"
    }
