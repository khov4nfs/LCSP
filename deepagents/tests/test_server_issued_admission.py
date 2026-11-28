"""WP8 Phase B: TDD RED tests for Server-Issued Admission & Worker Integration.

Verifies that all provider dispatches are governed by server-issued admission,
enforces solvency fail-closed checks, CAS IN_FLIGHT commitment before first byte,
separate physical retry invocations, no re-dispatch on recovered IN_FLIGHT admissions,
and localization governance.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from tools.common.capabilities.platform.api_client import WorkerCallbackError
from middleware.failure_policy import PaidAdmissionError
from middleware.usage_metering import UsageMeteringMiddleware, InFlightAdmissionRecoveryError
from orchestration import localization
from conftest import use_model_routes


@pytest.fixture(autouse=True)
def _setup_routes(monkeypatch):
    use_model_routes(
        monkeypatch,
        (
            {
                "routes": {
                    "primary": {
                        "provider": "anthropic",
                        "protocol": "anthropic",
                        "model": "claude-sonnet-4-6",
                        "options": {"context_window_tokens": 1000000, "max_output_tokens": 65536},
                    },
                },
                "roles": {"default": "primary"},
            }
        ),
    )


def _valid_model_request(provider="anthropic", model_name="claude-sonnet-4-6"):
    model = SimpleNamespace(
        provider=provider,
        protocol="anthropic",
        model_name=model_name,
        options={"max_output_tokens": 4096},
    )
    return SimpleNamespace(
        model=model,
        messages=[HumanMessage(content="Hello test")],
        tools=[],
        run_id="run-test-valid-1",
        logical_operation_id="op-test-valid-1",
        execution_lease_token="lease-test-valid-1",
        assessment_id="asm-test-valid-1",
    )


def _mock_response(text="answer"):
    return SimpleNamespace(
        content=text,
        usage_metadata={
            "input_tokens": 10,
            "output_tokens": 20,
            "total_tokens": 30,
            "input_token_details": {"cache_read": 0},
        },
        response_metadata={"id": "resp-test-1"},
    )


class MockWorkerApiClient:
    def __init__(self, timeline: list[str] | None = None):
        self.timeline = timeline if timeline is not None else []
        self.admission_requests = []
        self.consume_requests = []
        self.should_fail_admission = False
        self.admission_fail_status = 402
        self.admission_fail_code = "BILLING_PAYMENT_REQUIRED"
        self.should_fail_consume = False
        self.consume_fail_status = 422
        self.consume_fail_code = "BILLING_ADMISSION_CAPABILITY_MISMATCH"
        self.preset_admission_response = None

    def request_invocation_admission(self, payload: dict) -> dict:
        self.timeline.append("request_admission")
        self.admission_requests.append(dict(payload))
        if self.should_fail_admission:
            raise WorkerCallbackError(
                f"{self.admission_fail_code}: payment required",
                status_code=self.admission_fail_status,
                error_code=self.admission_fail_code,
            )
        if self.preset_admission_response is not None:
            return dict(self.preset_admission_response)
        now = datetime.now(timezone.utc)
        admitted_at = now.isoformat().replace("+00:00", "Z")
        expires_at = (now + timedelta(seconds=300)).isoformat().replace("+00:00", "Z")
        return {
            "admissionId": f"adm-{len(self.admission_requests)}",
            "invocationId": f"inv-{len(self.admission_requests)}",
            "admissionRequestId": payload.get("admissionRequestId", "req-1"),
            "fundingPrincipal": "CUSTOMER_WALLET",
            "state": "ADMITTED",
            "rolloutMode": "ADMISSION_REQUIRED",
            "debitMode": "OFF",
            "resolvedProvider": payload.get("requestedProvider", "anthropic"),
            "resolvedModel": payload.get("requestedModel", "claude-sonnet-4-6"),
            "maximumExposureMicrocredits": "5000000",
            "capabilityToken": "cap-token-" + "a" * 32,
            "admittedAt": admitted_at,
            "expiresAt": expires_at,
        }

    def consume_invocation_admission(self, payload: dict) -> dict:
        self.timeline.append("consume_admission")
        self.consume_requests.append(dict(payload))
        if self.should_fail_consume:
            raise WorkerCallbackError(
                f"{self.consume_fail_code}: consume CAS failed",
                status_code=self.consume_fail_status,
                error_code=self.consume_fail_code,
            )
        return {
            "admissionId": payload["admissionId"],
            "invocationId": payload["invocationId"],
            "state": "IN_FLIGHT",
            "consumedAt": "2026-11-26T12:00:01.000Z",
        }


def test_order_of_execution_admission_then_consume_then_provider(monkeypatch):
    """AC-B-01 & AC-B-05: Worker MUST call request_admission -> consume_admission -> provider handler."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    def mock_provider_handler(req):
        timeline.append("provider_dispatched")
        return _mock_response("ok")

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    # In Phase B, wrap_model_call must coordinate with WorkerApiClient to admit and consume
    middleware.wrap_model_call(req, mock_provider_handler)

    assert mock_client.admission_requests, (
        "wrap_model_call must request server admission before dispatching to provider"
    )
    assert mock_client.consume_requests, (
        "wrap_model_call must consume admission (CAS IN_FLIGHT) before provider dispatch"
    )
    # Strictly assert exact sequential order in a single shared timeline
    assert timeline == ["request_admission", "consume_admission", "provider_dispatched"], (
        f"Execution timeline must strictly be request -> consume -> provider, got: {timeline}"
    )
    # Assert token bounds are explicitly forwarded in admit payload
    admit_req = mock_client.admission_requests[0]
    assert admit_req.get("inputTokensUpperBound", 0) > 0, "admit_payload must include positive inputTokensUpperBound"
    assert admit_req.get("outputTokensUpperBound", 0) > 0, "admit_payload must include positive outputTokensUpperBound"


def test_insolvent_wallet_stops_execution_with_zero_provider_calls(monkeypatch):
    """AC-B-02: HTTP 402 PAYMENT_REQUIRED from API fails closed with ZERO provider calls dispatched."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    mock_client.should_fail_admission = True
    mock_client.admission_fail_status = 402
    mock_client.admission_fail_code = "BILLING_PAYMENT_REQUIRED"

    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    provider_dispatched_count = 0

    def mock_provider_handler(req):
        nonlocal provider_dispatched_count
        provider_dispatched_count += 1
        timeline.append("provider_dispatched")
        return _mock_response("illegal response")

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    # Must specifically raise WorkerCallbackError on 402 payment required (not generic Exception)
    with pytest.raises(WorkerCallbackError) as exc_info:
        middleware.wrap_model_call(req, mock_provider_handler)

    assert exc_info.value.status_code == 402
    assert exc_info.value.error_code == "BILLING_PAYMENT_REQUIRED"
    assert len(mock_client.admission_requests) == 1, (
        "wrap_model_call must have called request_invocation_admission"
    )
    assert provider_dispatched_count == 0, (
        "Zero provider calls may be dispatched when admission returns 402 PAYMENT_REQUIRED"
    )
    assert timeline == ["request_admission"], (
        f"Timeline must halt immediately after admission failure, got: {timeline}"
    )


def test_cas_consume_failure_prevents_provider_dispatch(monkeypatch):
    """AC-B-05: If CAS consume fails (e.g. 422 expired/mismatch), ZERO provider bytes may be sent."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    mock_client.should_fail_consume = True
    mock_client.consume_fail_status = 422
    mock_client.consume_fail_code = "BILLING_ADMISSION_CAPABILITY_MISMATCH"

    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    provider_dispatched_count = 0

    def mock_provider_handler(req):
        nonlocal provider_dispatched_count
        provider_dispatched_count += 1
        timeline.append("provider_dispatched")
        return _mock_response("illegal response")

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    # Must specifically raise WorkerCallbackError on 422 CAS failure
    with pytest.raises(WorkerCallbackError) as exc_info:
        middleware.wrap_model_call(req, mock_provider_handler)

    assert exc_info.value.status_code == 422
    assert exc_info.value.error_code == "BILLING_ADMISSION_CAPABILITY_MISMATCH"
    assert len(mock_client.admission_requests) == 1, (
        "wrap_model_call must have called request_invocation_admission"
    )
    assert len(mock_client.consume_requests) == 1, (
        "wrap_model_call must have called consume_invocation_admission"
    )
    assert provider_dispatched_count == 0, (
        "Zero provider calls may be dispatched if CAS consume fails"
    )
    assert timeline == ["request_admission", "consume_admission"], (
        f"Timeline must halt immediately after consume failure, got: {timeline}"
    )


def test_retry_and_fallback_issue_fresh_admission_with_incremented_ordinal(monkeypatch):
    """AC-B-06: Retries and fallbacks must obtain fresh admission with incremented attemptOrdinal."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    attempt_count = 0

    def mock_provider_handler(req):
        nonlocal attempt_count
        attempt_count += 1
        timeline.append("provider_dispatched")
        if attempt_count == 1:
            # First attempt fails with transient 503
            err = Exception("Transient provider 503")
            err.status_code = 503
            raise err
        response = _mock_response("retry success")
        # Why: Provider metadata is untrusted and can name the wrong paid physical attempt.
        # How: Forge the first attempt's ID and require middleware to replace it with the second server ID.
        # Invariant: The downstream evaluator must not bind a retry's verdict to a prior invocation.
        response.response_metadata["_lcsp_physical_invocation_id"] = "inv-1"
        return response

    from middleware.model_governance import ModelRetryMiddleware
    retry_middleware = ModelRetryMiddleware(max_retries=2)
    metering_middleware = UsageMeteringMiddleware()

    req = _valid_model_request()

    response = retry_middleware.wrap_model_call(
        req,
        lambda r: metering_middleware.wrap_model_call(r, mock_provider_handler),
    )

    assert response.response_metadata["_lcsp_physical_invocation_id"] == "inv-2"

    # Must have requested two distinct admissions with attemptOrdinal 1 and 2
    assert len(mock_client.admission_requests) >= 2, (
        "Each physical retry must request a fresh server admission"
    )
    assert mock_client.admission_requests[0]["attemptOrdinal"] == 1
    assert mock_client.admission_requests[1]["attemptOrdinal"] == 2
    assert (
        mock_client.admission_requests[0]["admissionRequestId"]
        != mock_client.admission_requests[1]["admissionRequestId"]
    ), "Retried physical attempt must have a distinct admissionRequestId"


def test_in_flight_admission_recovery_only_delivers_evidence_no_redispatch(monkeypatch):
    """Invariant: Replay returning an already IN_FLIGHT admission is for recovery/evidence only, NEVER re-dispatch!"""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    now = datetime.now(timezone.utc)
    mock_client.preset_admission_response = {
        "admissionId": "adm-in-flight-999",
        "invocationId": "inv-in-flight-999",
        "admissionRequestId": "req-replay-in-flight-1",
        "fundingPrincipal": "CUSTOMER_WALLET",
        "state": "IN_FLIGHT",  # Server returns existing admission which is already IN_FLIGHT
        "rolloutMode": "ADMISSION_REQUIRED",
        "debitMode": "OFF",
        "resolvedProvider": "anthropic",
        "resolvedModel": "claude-sonnet-4-6",
        "maximumExposureMicrocredits": "5000000",
        "capabilityToken": "cap-token-existing",
        "admittedAt": now.isoformat().replace("+00:00", "Z"),
        "expiresAt": (now + timedelta(seconds=300)).isoformat().replace("+00:00", "Z"),
    }
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    provider_dispatched_count = 0

    def mock_provider_handler(req):
        nonlocal provider_dispatched_count
        provider_dispatched_count += 1
        timeline.append("provider_dispatched")
        return _mock_response("illegal second provider dispatch")

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    # Pass directly through the actual worker execution entry point wrap_model_call
    # Must explicitly raise InFlightAdmissionRecoveryError without swallowing
    with pytest.raises(InFlightAdmissionRecoveryError) as exc_info:
        middleware.wrap_model_call(req, mock_provider_handler)

    assert exc_info.value.admission["invocationId"] == "inv-in-flight-999"
    assert len(mock_client.admission_requests) == 1, (
        "wrap_model_call must have checked admission before dispatching"
    )
    assert len(mock_client.consume_requests) == 0, (
        "Must NOT consume an admission that is already IN_FLIGHT"
    )
    assert provider_dispatched_count == 0, (
        "Replay of an IN_FLIGHT admission through wrap_model_call must NEVER dispatch a second provider invocation"
    )


def test_settled_admission_replay_never_consumes_or_redispatches(monkeypatch):
    # Why: A graph crash can replay the same logical step after the provider call was already settled.
    # How: Return the server's idempotent SETTLED admission for that step at the real middleware boundary.
    # Invariant: A terminal replay cannot consume again, invoke the provider, or create fresh exposure.
    client = MockWorkerApiClient()
    client.preset_admission_response = {
        **MockWorkerApiClient().request_invocation_admission({}),
        "state": "SETTLED",
    }
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: client,
    )
    provider_calls = []
    with pytest.raises(PaidAdmissionError, match="ADMISSION_NOT_DISPATCHABLE"):
        UsageMeteringMiddleware().wrap_model_call(
            _valid_model_request(),
            lambda _req: provider_calls.append("provider"),
        )
    assert len(client.admission_requests) == 1
    assert client.consume_requests == []
    assert provider_calls == []


def test_localization_is_governed_by_admission():
    """Invariant: localization.py must route through governed runnable, not raw unmediated model.ainvoke."""
    source = inspect.getsource(localization)

    # Must NOT call raw model.ainvoke or model.invoke directly without governance
    assert "model.ainvoke" not in source, (
        "localization.py must not call raw model.ainvoke directly; it must use governed runnable"
    )
    assert "model.invoke" not in source, (
        "localization.py must not call raw model.invoke directly; it must use governed runnable"
    )


def test_worker_fails_closed_when_execution_context_missing(monkeypatch):
    """HARDENING-5: Worker MUST fail closed with PaidAdmissionError and zero provider calls when execution context is missing.

    No dummy strings (such as 'op-{invocation_id}', 'run-{invocation_id}', 'lease-token-1') may be synthesized.
    """
    from middleware.failure_policy import PaidAdmissionError

    mock_client = MockWorkerApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    provider_dispatched_count = 0

    def mock_provider_handler(req):
        nonlocal provider_dispatched_count
        provider_dispatched_count += 1
        return _mock_response("illegal dispatch")

    middleware = UsageMeteringMiddleware()
    # Bare request without run_id, logical_op_id, or execution_lease_token
    model = SimpleNamespace(
        provider="anthropic",
        protocol="anthropic",
        model_name="claude-sonnet-4-6",
        options={"max_output_tokens": 4096},
    )
    req = SimpleNamespace(
        model=model,
        messages=[HumanMessage(content="Hello test")],
        tools=[],
    )

    # Must fail closed with PaidAdmissionError because runtime context is missing
    with pytest.raises(PaidAdmissionError, match="MISSING_EXECUTION_CONTEXT"):
        middleware.wrap_model_call(req, mock_provider_handler)

    assert provider_dispatched_count == 0, (
        "Provider must NEVER be called when execution context is missing"
    )
    assert len(mock_client.admission_requests) == 0, (
        "No admission request should be sent to server with fake synthetic context"
    )


def test_lost_response_retry_preserves_admission_request_id(monkeypatch):
    """ADR-028 & Root Cause 1: Lost-response retry MUST send the exact same admissionRequestId.

    If an admission request succeeds on the server but the response is lost in transit,
    the worker's retry of the same physical attempt must NOT generate a new random UUID
    in admissionRequestId; it must send the exact same admissionRequestId to trigger idempotent replay.
    """
    mock_client = MockWorkerApiClient()
    call_count = 0
    original_request = mock_client.request_invocation_admission

    def failing_first_request(payload):
        nonlocal call_count
        call_count += 1
        original_request(payload)
        if call_count == 1:
            raise WorkerCallbackError("Network timeout on response receipt", status_code=504)
        now = datetime.now(timezone.utc)
        return {
            "admissionId": "adm-replay-1",
            "invocationId": "inv-server-assigned-1",
            "admissionRequestId": payload["admissionRequestId"],
            "fundingPrincipal": "CUSTOMER_WALLET",
            "state": "ADMITTED",
            "rolloutMode": "ADMISSION_REQUIRED",
            "debitMode": "OFF",
            "resolvedProvider": "anthropic",
            "resolvedModel": "claude-sonnet-4-6",
            "maximumExposureMicrocredits": "5000000",
            "capabilityToken": "cap-token-" + "b" * 32,
            "admittedAt": now.isoformat().replace("+00:00", "Z"),
            "expiresAt": (now + timedelta(seconds=300)).isoformat().replace("+00:00", "Z"),
        }

    mock_client.request_invocation_admission = failing_first_request

    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    # First attempt: fails due to network timeout
    with pytest.raises(WorkerCallbackError, match="Network timeout"):
        middleware.wrap_model_call(req, lambda r: _mock_response("ok"))

    assert len(mock_client.admission_requests) == 1
    first_req_id = mock_client.admission_requests[0]["admissionRequestId"]

    # Second attempt: retrying the same logical attempt
    middleware.wrap_model_call(req, lambda r: _mock_response("ok"))

    assert len(mock_client.admission_requests) == 2
    second_req_id = mock_client.admission_requests[1]["admissionRequestId"]

    # Invariant: admissionRequestId MUST be identical across retries of the same attempt
    assert first_req_id == second_req_id, (
        f"admissionRequestId must be deterministic across retries: got {first_req_id} vs {second_req_id}"
    )


def test_input_tokens_upper_bound_uses_hard_route_limit_not_loose_estimate(monkeypatch):
    """ADR-028 & Root Cause 2: inputTokensUpperBound must be a verified hard ceiling (e.g. context_window_tokens).

    Loose byte estimations (e.g. 10 tokens from prompt) or ad-hoc 1000 fallbacks allow actual provider
    token usage to exceed the admitted exposure. The requested input bound must reflect the model's
    configured hard ceiling (context_window_tokens = 1,000,000).
    """
    mock_client = MockWorkerApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    middleware.wrap_model_call(req, lambda r: _mock_response("ok"))

    assert len(mock_client.admission_requests) == 1
    sent_input_bound = mock_client.admission_requests[0]["inputTokensUpperBound"]

    # Invariant: Must use the route's declared context_window_tokens (1,000,000), NOT estimated 10 or fallback 1000
    assert sent_input_bound == 1000000, (
        f"Expected inputTokensUpperBound to match context_window_tokens (1000000), but got {sent_input_bound}"
    )


def test_request_input_bound_cannot_understate_route_exposure(monkeypatch):
    """A request-local hint must not lower the provider route's admitted input ceiling."""
    mock_client = MockWorkerApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )
    request = _valid_model_request()
    # Why: A per-request token estimate is not a provider-enforced maximum; trusting it underprices exposure.
    # How: Inject a deliberately low hint and inspect the actual server admission payload.
    # Invariant: The route's hard context-window ceiling remains the source of the input bound.
    request.input_tokens_upper_bound = 1

    UsageMeteringMiddleware().wrap_model_call(request, lambda _: _mock_response("ok"))

    assert len(mock_client.admission_requests) == 1
    assert mock_client.admission_requests[0]["inputTokensUpperBound"] == 1_000_000


def test_input_bound_matches_provider_when_routes_share_model_name(monkeypatch):
    """A model name shared across providers must not borrow another route's context ceiling."""
    use_model_routes(
        monkeypatch,
        {
            "routes": {
                "first": {
                    "provider": "anthropic",
                    "protocol": "anthropic",
                    "model": "shared-model",
                    "options": {"context_window_tokens": 1_000_000, "max_output_tokens": 4_096},
                },
                "second": {
                    "provider": "google_genai",
                    "protocol": "google_genai",
                    "model": "shared-model",
                    "options": {"context_window_tokens": 2_000_000, "max_output_tokens": 4_096},
                },
            },
            "roles": {"default": "first", "other": "second"},
        },
    )
    mock_client = MockWorkerApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )
    request = _valid_model_request(provider="google_genai", model_name="shared-model")
    request.model.protocol = "google_genai"

    # Why: Route ordering must never reduce the exposure admitted for another provider.
    # How: Check the actual server payload for the second route's larger context ceiling.
    # Invariant: A shared model name alone cannot identify the model's financial authority.
    UsageMeteringMiddleware().wrap_model_call(request, lambda _: _mock_response("ok"))
    assert mock_client.admission_requests[0]["inputTokensUpperBound"] == 2_000_000


def test_request_model_settings_cannot_raise_provider_output_above_admission_bound(monkeypatch):
    """A request override must not dispatch more output tokens than the admission priced."""
    mock_client = MockWorkerApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )
    request = _valid_model_request()
    request.model_settings = {"max_tokens": 131_072}
    request.override = lambda **changes: SimpleNamespace(**{**vars(request), **changes})
    dispatched_settings = []

    # Why: A caller-supplied model setting can otherwise override the route's enforced output cap.
    # How: Capture the provider-facing request after middleware prepares model_settings.
    # Invariant: Provider max_tokens must not exceed outputTokensUpperBound priced at admission.
    UsageMeteringMiddleware().wrap_model_call(
        request,
        lambda prepared: (dispatched_settings.append(prepared.model_settings), _mock_response("ok"))[1],
    )

    admitted_output_bound = mock_client.admission_requests[0]["outputTokensUpperBound"]
    assert admitted_output_bound == 4_096
    assert dispatched_settings[0]["max_tokens"] == admitted_output_bound


def test_smaller_request_output_cap_remains_effective(monkeypatch):
    """A caller's smaller valid output cap remains effective within the admitted ceiling."""
    mock_client = MockWorkerApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )
    request = _valid_model_request()
    request.model_settings = {"max_tokens": 1_024}
    request.override = lambda **changes: SimpleNamespace(**{**vars(request), **changes})
    provider_settings = []

    UsageMeteringMiddleware().wrap_model_call(
        request,
        lambda prepared: (provider_settings.append(prepared.model_settings), _mock_response("ok"))[1],
    )

    assert mock_client.admission_requests[0]["outputTokensUpperBound"] == 4_096
    assert provider_settings[0]["max_tokens"] == 1_024


@pytest.mark.asyncio
async def test_async_model_call_uses_server_issued_invocation_id(monkeypatch):
    """ADR-028 & Root Cause 1: awrap_model_call MUST use server-issued invocationId throughout.

    Verifies that _admit(), telemetry, and usage records in awrap_model_call() do NOT
    generate an unlinked random UUID, but faithfully bind to admission["invocationId"].
    """
    mock_client = MockWorkerApiClient()
    server_invocation_id = "inv-server-assigned-async-42"
    mock_client.preset_admission_response = {
        "admissionId": "adm-async-1",
        "invocationId": server_invocation_id,
        "admissionRequestId": "req-async-1",
        "fundingPrincipal": "CUSTOMER_WALLET",
        "state": "ADMITTED",
        "rolloutMode": "ADMISSION_REQUIRED",
        "debitMode": "OFF",
        "resolvedProvider": "anthropic",
        "resolvedModel": "claude-sonnet-4-6",
        "maximumExposureMicrocredits": "5000000",
        "capabilityToken": "cap-token-" + "a" * 32,
        "admittedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=300)).isoformat().replace("+00:00", "Z"),
    }

    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    recorded_invocation_ids = []
    admitted_invocation_ids = []

    middleware = UsageMeteringMiddleware()

    orig_admit = middleware._admit
    def tracking_admit(request, inv_id):
        admitted_invocation_ids.append(inv_id)
        return orig_admit(request, inv_id)
    middleware._admit = tracking_admit

    orig_record = middleware._record
    def tracking_record(response, model, inv_id):
        recorded_invocation_ids.append(inv_id)
        return orig_record(response, model, inv_id)
    middleware._record = tracking_record

    req = _valid_model_request()

    async def async_provider_handler(r):
        return _mock_response("async ok")

    response = await middleware.awrap_model_call(req, async_provider_handler)

    assert len(admitted_invocation_ids) == 1
    assert len(recorded_invocation_ids) == 1
    # Invariant: Must use the server's invocationId, NOT a client-generated UUID
    assert admitted_invocation_ids[0] == server_invocation_id, (
        f"Expected _admit to use server invocationId '{server_invocation_id}', got '{admitted_invocation_ids[0]}'"
    )
    assert recorded_invocation_ids[0] == server_invocation_id, (
        f"Expected _record to use server invocationId '{server_invocation_id}', got '{recorded_invocation_ids[0]}'"
    )
    assert response.response_metadata["_lcsp_physical_invocation_id"] == server_invocation_id


@pytest.mark.asyncio
async def test_async_lost_response_retry_preserves_admission_request_id_and_uses_server_invocation_id(monkeypatch):
    """ADR-028 & Root Cause 1: awrap_model_call lost-response retry MUST preserve admissionRequestId and use server invocationId."""
    mock_client = MockWorkerApiClient()
    call_count = 0
    server_invocation_id = "inv-server-assigned-async-replay-99"

    def failing_first_request(payload):
        nonlocal call_count
        call_count += 1
        mock_client.admission_requests.append(dict(payload))
        if call_count == 1:
            raise WorkerCallbackError("Network timeout on response receipt", status_code=504)
        now = datetime.now(timezone.utc)
        return {
            "admissionId": "adm-async-replay-1",
            "invocationId": server_invocation_id,
            "admissionRequestId": payload["admissionRequestId"],
            "fundingPrincipal": "CUSTOMER_WALLET",
            "state": "ADMITTED",
            "rolloutMode": "ADMISSION_REQUIRED",
            "debitMode": "OFF",
            "resolvedProvider": "anthropic",
            "resolvedModel": "claude-sonnet-4-6",
            "maximumExposureMicrocredits": "5000000",
            "capabilityToken": "cap-token-" + "c" * 32,
            "admittedAt": now.isoformat().replace("+00:00", "Z"),
            "expiresAt": (now + timedelta(seconds=300)).isoformat().replace("+00:00", "Z"),
        }

    mock_client.request_invocation_admission = failing_first_request

    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    recorded_invocation_ids = []
    middleware = UsageMeteringMiddleware()

    orig_record = middleware._record
    def tracking_record(response, model, inv_id):
        recorded_invocation_ids.append(inv_id)
        return orig_record(response, model, inv_id)
    middleware._record = tracking_record

    req = _valid_model_request()

    async def async_provider_handler(r):
        return _mock_response("async retry ok")

    # First attempt: fails due to network timeout
    with pytest.raises(WorkerCallbackError, match="Network timeout"):
        await middleware.awrap_model_call(req, async_provider_handler)

    assert len(mock_client.admission_requests) == 1
    first_req_id = mock_client.admission_requests[0]["admissionRequestId"]

    # Second attempt: retrying the same logical attempt
    await middleware.awrap_model_call(req, async_provider_handler)

    assert len(mock_client.admission_requests) == 2
    second_req_id = mock_client.admission_requests[1]["admissionRequestId"]

    # Invariant: admissionRequestId MUST be identical across retries
    assert first_req_id == second_req_id, (
        f"Async admissionRequestId must be deterministic across retries: got {first_req_id} vs {second_req_id}"
    )
    # Invariant: recorded invocation_id must match the server-issued one
    assert recorded_invocation_ids == [server_invocation_id], (
        f"Expected recorded invocation_id '{server_invocation_id}', got {recorded_invocation_ids}"
    )


def test_sync_model_call_fails_closed_when_server_invocation_id_missing(monkeypatch):
    """ADR-028 & Root Cause 1: Sync call MUST fail closed if server admission lacks invocationId.

    Verifies that worker NEVER falls back to client-generated UUID when server invocationId is missing.
    Provider MUST NOT be dispatched (zero external calls).
    """
    mock_client = MockWorkerApiClient()
    # Malformed server response missing invocationId
    mock_client.preset_admission_response = {
        "admissionId": "adm-missing-id-sync",
        "invocationId": None,  # Missing!
        "admissionRequestId": "req-missing-id-sync",
        "fundingPrincipal": "CUSTOMER_WALLET",
        "state": "ADMITTED",
        "rolloutMode": "ADMISSION_REQUIRED",
        "debitMode": "OFF",
        "resolvedProvider": "anthropic",
        "resolvedModel": "claude-sonnet-4-6",
        "maximumExposureMicrocredits": "5000000",
        "capabilityToken": "cap-token-" + "a" * 32,
        "admittedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=300)).isoformat().replace("+00:00", "Z"),
    }

    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    provider_called = []
    def provider_handler(r):
        provider_called.append(r)
        return _mock_response("should not be called")

    # Invariant: Must raise error when invocationId is missing, rather than falling back to random UUID
    with pytest.raises(Exception, match="MISSING_SERVER_INVOCATION_ID"):
        middleware.wrap_model_call(req, provider_handler)

    # Invariant: Provider MUST NOT be called
    assert len(provider_called) == 0, "Provider was called despite missing server invocationId!"


@pytest.mark.asyncio
async def test_async_model_call_fails_closed_when_server_invocation_id_missing(monkeypatch):
    """ADR-028 & Root Cause 1: Async call MUST fail closed if server admission lacks invocationId.

    Verifies that async worker NEVER falls back to client-generated UUID when server invocationId is missing.
    Provider MUST NOT be dispatched (zero external calls).
    """
    mock_client = MockWorkerApiClient()
    # Malformed server response missing invocationId
    mock_client.preset_admission_response = {
        "admissionId": "adm-missing-id-async",
        "invocationId": None,  # Missing!
        "admissionRequestId": "req-missing-id-async",
        "fundingPrincipal": "CUSTOMER_WALLET",
        "state": "ADMITTED",
        "rolloutMode": "ADMISSION_REQUIRED",
        "debitMode": "OFF",
        "resolvedProvider": "anthropic",
        "resolvedModel": "claude-sonnet-4-6",
        "maximumExposureMicrocredits": "5000000",
        "capabilityToken": "cap-token-" + "a" * 32,
        "admittedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=300)).isoformat().replace("+00:00", "Z"),
    }

    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    provider_called = []
    async def async_provider_handler(r):
        provider_called.append(r)
        return _mock_response("should not be called")

    # Invariant: Must raise error when invocationId is missing, rather than falling back to random UUID
    with pytest.raises(Exception, match="MISSING_SERVER_INVOCATION_ID"):
        await middleware.awrap_model_call(req, async_provider_handler)

    # Invariant: Provider MUST NOT be called
    assert len(provider_called) == 0, "Async provider was called despite missing server invocationId!"


def test_model_call_heartbeat_renews_in_flight_lease(monkeypatch):
    """Test that active model call telemetry periodically issues heartbeats to extend the in-flight lease."""
    mock_client = MagicMock()
    mock_client.request_invocation_admission.return_value = {
        "admissionId": "adm-test-hb-1",
        "invocationId": "inv-server-assigned-hb-1",
        "admissionRequestId": "req-1",
        "fundingPrincipal": "CUSTOMER_WALLET",
        "state": "ADMITTED",
        "rolloutMode": "ADMISSION_REQUIRED",
        "debitMode": "OFF",
        "resolvedProvider": "anthropic",
        "resolvedModel": "claude-sonnet-4-6",
        "maximumExposureMicrocredits": "5000000",
        "capabilityToken": "cap-token-" + "a" * 32,
        "admittedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=300)).isoformat().replace("+00:00", "Z"),
    }
    mock_client.consume_invocation_admission.return_value = {
        "admissionId": "adm-test-hb-1",
        "invocationId": "inv-server-assigned-hb-1",
        "state": "IN_FLIGHT",
    }
    mock_client.heartbeat_invocation_admission.return_value = {
        "admissionId": "adm-test-hb-1",
        "invocationId": "inv-server-assigned-hb-1",
        "state": "IN_FLIGHT",
    }

    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )
    # Fast heartbeat interval for testing
    monkeypatch.setattr("middleware.usage_metering._MODEL_CALL_HEARTBEAT_SECONDS", 0.05)

    import time
    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    def slow_provider_handler(r):
        time.sleep(0.15)  # Run long enough for heartbeat to trigger at least once
        return _mock_response("slow response")

    res = middleware.wrap_model_call(req, slow_provider_handler)
    assert res is not None

    # Verify heartbeat_invocation_admission was called with capability token
    assert mock_client.heartbeat_invocation_admission.call_count >= 1
    call_args = mock_client.heartbeat_invocation_admission.call_args[0][0]
    assert call_args["admissionId"] == "adm-test-hb-1"
    assert call_args["invocationId"] == "inv-server-assigned-hb-1"
    assert call_args["capabilityToken"] == "cap-token-" + "a" * 32


def test_unverified_model_route_identity_fails_closed_zero_admission_zero_provider_calls(monkeypatch):
    """RED test: Model lacking verified route identity must fail closed with 0 admission requests and 0 provider calls."""
    mock_client = MockWorkerApiClient()
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )
    # Bypass legacy assert_model_identity to test server admission fail-closed enforcement directly
    monkeypatch.setattr("middleware.usage_metering.assert_model_identity", lambda *args, **kwargs: None)
    middleware = UsageMeteringMiddleware()

    # Model without provider or model_name, and not in registry or route table
    unverified_model = SimpleNamespace(
        profile={"max_output_tokens": 4096, "context_window_tokens": 1000000},
        options={"max_output_tokens": 4096},
    )
    req = SimpleNamespace(
        model=unverified_model,
        messages=[HumanMessage(content="Hello")],
        tools=[],
        run_id="run-unverified-identity-1",
        logical_operation_id="op-unverified-1",
        execution_lease_token="lease-unverified-1",
        assessment_id="asm-unverified-1",
    )

    provider_calls = []
    def provider_handler(r):
        provider_calls.append(r)
        return _mock_response("ok")

    from middleware.failure_policy import PaidAdmissionError
    with pytest.raises(PaidAdmissionError) as exc_info:
        middleware.wrap_model_call(req, provider_handler)

    assert exc_info.value.reason == "UNBOUND_MODEL_ROUTE"
    assert len(mock_client.admission_requests) == 0, "Zero server admission requests when model route identity is unverified"
    assert len(provider_calls) == 0, "Zero provider model calls when model route identity is unverified"
