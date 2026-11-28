import itertools
import json
import sqlite3
import time
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import pytest
from conftest import use_model_routes
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

import model_policy as mp
from middleware import usage_metering, usage_recovery
from middleware.failure_policy import PaidAdmissionError
from middleware.usage_metering import (
    OUTPUT_EVALUATION_STATES,
    PROVIDER_COMPLETION_STATES,
    AgentRoleMiddleware,
    AgentRunState,
    ModelContextWindowExceeded,
    ModelIdentityMismatch,
    UsageMeteringMiddleware,
    activate_agent_run_state,
    active_agent_run_state,
    assert_model_identity,
    output_cap_settings,
    output_token_limit,
    check_request_context,
    extract_provider_usage,
)
from middleware.usage_recovery import (
    _normalize_usage_recovery_payload,
    drain,
    enqueue_usage,
    usage_recovery_key,
)
from orchestration.agent_stream import (
    AgentStreamInterrupted,
    active_agent_stream_cancel,
)
from tools.common.capabilities.platform.api_client import WorkerCallbackError
from tools.common.capabilities.platform.callback_schemas import SettledUsagePayload
from tools.common.capabilities.platform.config import resolve_usage_recovery_store_path


# Why: Server-issued admission requires explicit positive integer token bounds on governed routes.
# How: Provide shared technical capacity defaults without any pricing metadata; tests override alpha_options cleanly.
# Invariant: Technical route bounds never encode pricing/tariff/wallet policy.
_DEFAULT_ROUTE_OPTIONS = {"context_window_tokens": 1_000_000, "max_output_tokens": 65_536}


def _set_routes(monkeypatch, alpha_model="model-alpha", alpha_options=None):
    merged_alpha_options = {**_DEFAULT_ROUTE_OPTIONS, **(alpha_options or {})}
    use_model_routes(
        monkeypatch,
        (
            {
                "routes": {
                    "a": {"provider": "openai", "model": alpha_model, "options": merged_alpha_options},
                    "b": {"provider": "google_genai", "model": "future-model-v99", "options": dict(_DEFAULT_ROUTE_OPTIONS)},
                    "c": {"provider": "apx", "protocol": "anthropic", "model": "model-gamma", "options": dict(_DEFAULT_ROUTE_OPTIONS)},
                },
                "roles": {"default": "a", "narrator": "b"},
                "fallbacks": {"a": ["c"]},
            }
        ),
    )


@pytest.fixture(autouse=True)
def _model_routes(monkeypatch, tmp_path):
    _set_routes(monkeypatch)
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(tmp_path / "usage.sqlite3"))


class FakeClient:
    def __init__(self):
        self.attempts = []

    @property
    def payloads(self):
        # Existing response assertions count responses; lifecycle is checked separately.
        return [p for p in self.attempts if p.attemptStatus in (None, "COMPLETED")]

    def post_settled_usage(self, payload):
        self.attempts.append(payload)


class AdmittedFakeClient(FakeClient):
    """Test double implementing the ADR-028 server-issued admission lifecycle.

    Why: UsageMeteringMiddleware enforces request -> consume -> provider -> settle/heartbeat
    before dispatching any model call, and usage_recovery deduplicates by invocationId.
    How: Issues monotonically unique admissionId/invocationId/capabilityToken triples across
    all client instances (via _admission_seq) and records all lifecycle calls while preserving
    FakeClient.attempts/payloads.
    Invariant: OUTCOME_UNKNOWN settlements return settled=False, slotReleased=False so
    recovery envelopes are retained rather than prematurely deleted.
    """

    _admission_seq = itertools.count(1)

    def __init__(self):
        super().__init__()
        self.admissions = []
        self.consumes = []
        self.settlements = []
        self.heartbeats = []

    def request_invocation_admission(self, payload):
        idx = next(self._admission_seq)
        self.admissions.append(payload)
        return {
            "admissionId": f"adm-{idx}",
            "invocationId": f"inv-{idx}",
            "capabilityToken": f"cap-token-{idx}-" + "a" * 32,
            "state": "ADMITTED",
            "maximumExposureMicrocredits": "5000000",
            "admittedAt": "2026-11-28T00:00:00Z",
            "expiresAt": "2026-11-28T00:05:00Z",
        }

    def consume_invocation_admission(self, payload):
        self.consumes.append(payload)
        return {
            "admissionId": payload["admissionId"],
            "invocationId": payload["invocationId"],
            "state": "IN_FLIGHT",
        }

    def settle_invocation_usage(self, payload):
        self.settlements.append(payload)
        if payload.get("providerCompletionState") == "OUTCOME_UNKNOWN":
            return {"settled": False, "slotReleased": False, "debitMode": "OFF"}
        return {"settled": True, "slotReleased": True, "debitMode": "OFF"}

    def heartbeat_invocation_admission(self, payload):
        self.heartbeats.append(payload)
        return {
            "admissionId": payload["admissionId"],
            "invocationId": payload["invocationId"],
            "state": "IN_FLIGHT",
        }


class FailingClient(AdmittedFakeClient):
    """Simulates usage-callback delivery outage while server admission remains healthy.

    Why: Recovery queue tests exercise enqueue/drain behavior when post_settled_usage fails.
    How: Inherits server admission/consume/settle/heartbeat from AdmittedFakeClient and raises
    only on post_settled_usage.
    Invariant: Admission/consume still runs before provider dispatch; only legacy usage delivery fails.
    """

    def post_settled_usage(self, _payload):
        raise RuntimeError("api-unavailable")


def _state(
    client=None,
    *,
    role="planner",
    run_id="run-1",
    assessment_id="assessment-1",
    execution_lease_token="lease-test-1",
):
    # Why: Governed assessment calls require an active execution_lease_token on AgentRunState.
    # How: Attach execution_lease_token by default while allowing callers to pass None explicitly.
    # Invariant: Never mutates anonymous _request() calls that test MISSING_EXECUTION_CONTEXT.
    state = AgentRunState(
        run_id=run_id, agent_role=role, assessment_id=assessment_id, api_client=client
    )
    if execution_lease_token is not None:
        state.execution_lease_token = execution_lease_token
    return state


def _request(provider="openai", model_name="model-alpha", *, protocol=None, model_options=None, **extra):
    protocol = protocol or {
        "openai": "openai",
        "google_genai": "google_genai",
        "apx": "anthropic",
        "inception": "openai",
    }.get(provider)
    # Why: Keep _request() free of run_id/execution_lease_token/preparation_run_id by default
    # so anonymous wrap_model_call tests continue proving fail-closed MISSING_EXECUTION_CONTEXT.
    # How: Attach only technical model options (required by output_token_limit) and caller **extra.
    # Invariant: No execution authority fields are synthesized on _request() by default.
    return SimpleNamespace(
        model=SimpleNamespace(
            provider=provider,
            protocol=protocol,
            model_name=model_name,
            options=dict(_DEFAULT_ROUTE_OPTIONS) if model_options is None else model_options,
        ),
        **extra,
    )


def response(*, input_tokens=3, output_tokens=2, cached=1, response_id="resp-1"):
    return SimpleNamespace(
        usage_metadata={
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "input_token_details": {"cache_read": cached},
        },
        response_metadata={"id": response_id},
    )


def _capture_events(monkeypatch):
    events = []
    monkeypatch.setattr(
        usage_metering,
        "publish_agent_stream_event",
        lambda event_type, **fields: events.append((event_type, fields)),
    )
    return events


# --- provider-reported usage extraction ------------------------------------------------


def test_extract_provider_usage_is_numeric_and_does_not_persist_reasoning_content():
    usage = extract_provider_usage(
        response(), SimpleNamespace(provider="openai", model_name="model-alpha")
    )

    assert usage == {
        "inputTokens": "2",
        "inputTokensIncludingCache": "3",
        "cachedInputTokens": "1",
        "outputTokens": "2",
        "totalTokens": "5",
        "providerResponseId": "resp-1",
    }
    assert "reasoning" not in usage


def test_extract_provider_usage_preserves_partial_dimensions():
    usage = extract_provider_usage(SimpleNamespace(usage_metadata={"input_tokens": 1}),
        SimpleNamespace(provider="openai", protocol="openai", model_name="model-alpha"))
    # Why: One reported input token with no cached bucket is one uncached input token.
    # How: Preserve the known input total and its billable partition without inventing missing output usage.
    # Invariant: Partial provider evidence must never imply an output count.
    assert usage == {"inputTokens": "1", "inputTokensIncludingCache": "1"}


# --- usage reporting --------------------------------------------------------------------


def test_one_response_posts_one_provider_reported_payload_without_money_fields(monkeypatch):
    class AdmittedFakeClient(FakeClient):
        def __init__(self):
            super().__init__()
            self.admissions = []
            self.consumes = []
            self.settlements = []

        def request_invocation_admission(self, payload):
            self.admissions.append(payload)
            return {
                "admissionId": "adm-usage-report-1",
                "invocationId": "inv-usage-report-1",
                "capabilityToken": "cap-usage-report-abcdef1234567890abcdef1234567890",
                "state": "ADMITTED",
                "maximumExposureMicrocredits": "1000",
            }

        def consume_invocation_admission(self, payload):
            self.consumes.append(payload)
            return {"state": "IN_FLIGHT"}

        def settle_invocation_usage(self, payload):
            self.settlements.append(payload)
            return {"settled": True, "slotReleased": True, "debitMode": "OFF"}

    client = AdmittedFakeClient()
    store = SimpleNamespace(
        record_in_flight_admission=lambda _envelope: None,
        record_usage_evidence=lambda _invocation_id, _usage: None,
        remove_admission_recovery=lambda _admission_id: None,
    )
    # Why: The usage assertion must execute behind the current server-issued admission boundary.
    # How: Supply an authorized run lease and a local API/store double that records request, consume, and settle.
    # Invariant: This fixture cannot bypass the production MISSING_EXECUTION_CONTEXT guard.
    _set_routes(monkeypatch, alpha_options={"context_window_tokens": 1000, "max_output_tokens": 100})
    monkeypatch.setattr(UsageMeteringMiddleware, "_get_recovery_store", lambda _self: store)
    state = _state(client)
    state.execution_lease_token = "lease-usage-report-1"
    request = _request(logical_operation_id="op-usage-report-1")
    request.model.options = {"context_window_tokens": 1000, "max_output_tokens": 100}
    with activate_agent_run_state(state):
        result = UsageMeteringMiddleware().wrap_model_call(
            request, lambda _: response()
        )

    assert result is not None
    assert len(client.admissions) == len(client.consumes) == len(client.settlements) == 1
    assert len(client.payloads) == 1
    payload = client.payloads[0]
    assert (payload.assessmentId, payload.runId, payload.agentRole) == (
        "assessment-1",
        "run-1",
        "planner",
    )
    assert payload.providerResponseId == "resp-1"
    assert payload.inputTokens == "2"
    assert payload.cachedInputTokens == "1"
    wire = payload.model_dump(exclude_none=True)
    assert "reasoningTokens" not in wire
    assert not [k for k in wire if any(w in k.lower() for w in ("price", "charge", "credit", "reserv", "amount"))]
    assert "reservationId" not in SettledUsagePayload.model_fields


def test_partial_response_is_recorded_without_inventing_missing_tokens():
    client = AdmittedFakeClient()
    with activate_agent_run_state(_state(client)):
        UsageMeteringMiddleware().wrap_model_call(
            _request(logical_operation_id="op-partial"),
            lambda _: SimpleNamespace(
                usage_metadata={"input_tokens": 1}, response_metadata={"id": "partial"}
            ),
        )
    assert len(client.payloads) == 1
    assert client.payloads[0].inputTokensIncludingCache == "1"
    assert client.payloads[0].outputTokens is None
    # Partial usage lacking outputTokens cannot settle as COMPLETED; server receives OUTCOME_UNKNOWN.
    assert client.settlements[0]["providerCompletionState"] == "OUTCOME_UNKNOWN"


def test_failed_provider_attempt_posts_no_usage():
    client = AdmittedFakeClient()
    with activate_agent_run_state(_state(client)), pytest.raises(ConnectionError):
        UsageMeteringMiddleware().wrap_model_call(
            _request(logical_operation_id="op-fail"),
            lambda _: (_ for _ in ()).throw(ConnectionError("down")),
        )
    assert client.payloads == []


@pytest.mark.asyncio
async def test_async_failed_provider_attempt_posts_no_usage():
    client = AdmittedFakeClient()

    async def fail(_request):
        raise ConnectionError("provider connection failed")

    with activate_agent_run_state(_state(client)), pytest.raises(ConnectionError):
        await UsageMeteringMiddleware().awrap_model_call(
            _request(logical_operation_id="op-fail-async"), fail
        )
    assert client.payloads == []


def test_scoped_state_archives_usage_locally_even_without_api_client(monkeypatch):
    # Why: Non-assessment states without api_client still execute behind server-issued admission
    # via WorkerApiClient fallback, while local usage recovery archiving remains scoped strictly
    # to states carrying assessment_id or preparation_run_id.
    # How: Monkeypatch WorkerApiClient to AdmittedFakeClient and attach execution_lease_token
    # to all 3 states without adding assessment_id/preparation_run_id to states 1 & 3.
    # Invariant: Only the assessment-scoped state writes STARTED/COMPLETED rows to usage_recovery.
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *_a, **_kw: AdmittedFakeClient(),
    )
    states = (
        AgentRunState(run_id="r", agent_role="legal"),
        AgentRunState(run_id="r", agent_role="legal", assessment_id="a"),
        AgentRunState(run_id="r", agent_role="legal", api_client=AdmittedFakeClient()),
    )
    for idx, state in enumerate(states, start=1):
        state.execution_lease_token = "lease-local-archive"
        with activate_agent_run_state(state):
            UsageMeteringMiddleware().wrap_model_call(
                _request(logical_operation_id=f"op-local-archive-{idx}"),
                lambda _: response(),
            )
    records = usage_recovery.read_usage_evidence(resolve_usage_recovery_store_path())
    assert [r["attemptStatus"] for r in records] == ["STARTED", "COMPLETED"]


def test_metering_without_run_state_fails_before_provider_dispatch(monkeypatch):
    events = _capture_events(monkeypatch)
    assert active_agent_run_state() is None
    provider_calls = []

    # Why: Server-issued admission cannot bind an anonymous model call to a run or lease.
    # How: The missing-context guard rejects before the handler and before model-call telemetry starts.
    # Invariant: A legacy no-state fixture must not silently dispatch a billable provider call.
    with pytest.raises(PaidAdmissionError, match="MISSING_EXECUTION_CONTEXT"):
        UsageMeteringMiddleware().wrap_model_call(
            _request(), lambda _: provider_calls.append("dispatched")
        )

    assert provider_calls == []
    assert events == []


def test_identity_check_runs_without_any_run_state():
    called = []
    with pytest.raises(ModelIdentityMismatch):
        UsageMeteringMiddleware().wrap_model_call(
            _request("openai", "unapproved"), lambda r: called.append(r)
        )
    assert called == []


def test_cancelled_turn_never_replays_and_keeps_usage_of_the_answered_call():
    for cancel_during_call in (False, True):
        client = AdmittedFakeClient()
        cancel = Event()
        calls = []

        def provider(request):
            calls.append(request)
            cancel.set()
            return response()

        if not cancel_during_call:
            cancel.set()
        token = active_agent_stream_cancel.set(cancel)
        try:
            with activate_agent_run_state(_state(client)):
                for _ in range(2):
                    with pytest.raises(AgentStreamInterrupted):
                        UsageMeteringMiddleware().wrap_model_call(
                            _request(logical_operation_id="op-cancel"), provider
                        )
        finally:
            active_agent_stream_cancel.reset(token)
        assert len(calls) == int(cancel_during_call)
        assert len(client.payloads) == int(cancel_during_call)


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel_during_call", [False, True])
async def test_async_cancelled_turn_keeps_usage_without_next_call(cancel_during_call):
    client = AdmittedFakeClient()
    cancel = Event()
    calls = []

    async def provider(request):
        calls.append(request)
        cancel.set()
        return response()

    if not cancel_during_call:
        cancel.set()
    token = active_agent_stream_cancel.set(cancel)
    try:
        with activate_agent_run_state(_state(client)):
            for _ in range(2):
                with pytest.raises(AgentStreamInterrupted):
                    await UsageMeteringMiddleware().awrap_model_call(
                        _request(logical_operation_id="op-async-cancel"), provider
                    )
    finally:
        active_agent_stream_cancel.reset(token)
    assert len(calls) == int(cancel_during_call)
    assert len(client.payloads) == int(cancel_during_call)


# --- no pricing, no model allow-list beyond the routes file ------------------------------
# Note: Legacy raw-text scan `test_metering_has_no_pricing_or_reservation_surface` was superseded
# by ADR-028 server-issued admission (envelope `maximumExposureMicrocredits` and wallet boundary
# docs in usage_metering.py). Equivalent invariants remain enforced by:
# - test_one_response_posts_one_provider_reported_payload_without_money_fields
# - tests/test_api_client.py::test_post_settled_usage_sends_provider_reported_fields_without_reservation
# - tests/test_server_issued_admission.py::test_insolvent_wallet_stops_execution_with_zero_provider_calls
# - tests/test_assessment_payment_required.py::test_payment_required_pauses_root_without_dispatching_provider


def test_arbitrary_future_model_without_pricing_metadata_executes():
    client = AdmittedFakeClient()
    request = _request(
        "google_genai", "future-model-v99", logical_operation_id="op-future"
    )  # no profile, no price anywhere
    with activate_agent_run_state(_state(client, role="narrator")):
        UsageMeteringMiddleware().wrap_model_call(request, lambda _: response())
    assert [p.model for p in client.payloads] == ["future-model-v99"]


def test_model_identity_accepts_routed_models_and_rejects_unrouted():
    assert_model_identity(SimpleNamespace(provider="apx", protocol="anthropic", model_name="model-gamma"))
    assert_model_identity(SimpleNamespace(provider="google_genai", protocol="google_genai", model_name="future-model-v99"))
    with pytest.raises(ModelIdentityMismatch):
        assert_model_identity(SimpleNamespace(provider="openai", protocol="openai", model_name="unapproved"))
    assert ModelIdentityMismatch.status_code == 400


def test_a_newly_routed_model_is_accepted_without_code_changes(monkeypatch):
    with pytest.raises(ModelIdentityMismatch):
        assert_model_identity(SimpleNamespace(provider="openai", model_name="model-omega-7"))
    _set_routes(monkeypatch, alpha_model="model-omega-7")
    assert_model_identity(SimpleNamespace(provider="openai", model_name="model-omega-7"))


# --- context window and output cap ---------------------------------------------------------


def test_context_window_exceeded_is_raised_before_the_provider_call_and_posts_nothing():
    client = FakeClient()
    request = SimpleNamespace(
        model=SimpleNamespace(
            provider="google_genai",
            model_name="future-model-v99",
            profile={"max_input_tokens": 10},
        ),
        messages=[HumanMessage(content="known context overflow " * 100)],
    )
    called = []

    with activate_agent_run_state(_state(client)), pytest.raises(
        ModelContextWindowExceeded, match="active provider context window"
    ):
        UsageMeteringMiddleware().wrap_model_call(request, lambda r: called.append(r))

    assert called == [] and client.payloads == []


def test_provider_input_limit_is_the_only_context_guard():
    request = SimpleNamespace(
        model=SimpleNamespace(
            provider="google_genai",
            model_name="future-model-v99",
            profile={"max_input_tokens": 100},
        ),
        messages=[HumanMessage(content="small input")],
    )
    metrics = check_request_context(request, request.model)
    assert metrics.estimated_input_tokens <= 100
    assert metrics.provider_context_limit == 100


def test_long_runs_are_never_capped_by_run_state():
    client = AdmittedFakeClient()
    # Why: Server admission requires logical_operation_id and positive route bounds, while
    # intentionally omitting profile["max_input_tokens"] so _provider_context_limit_tokens stays None.
    # How: Attach _DEFAULT_ROUTE_OPTIONS on model.options and supply logical_operation_id="op-long".
    # Invariant: Run state never caps turns and every invocation receives a unique server invocationId.
    request = SimpleNamespace(
        model=SimpleNamespace(
            provider="google_genai",
            model_name="future-model-v99",
            options=dict(_DEFAULT_ROUTE_OPTIONS),
        ),
        messages=[
            HumanMessage(content="large managed history " * 2000),
            ToolMessage(
                content="large repository tool result " * 2000,
                tool_call_id="call-large-history",
                name="read_file",
            ),
        ],
        logical_operation_id="op-long",
    )
    with activate_agent_run_state(_state(client)):
        for index in range(20):
            assert (
                UsageMeteringMiddleware().wrap_model_call(
                    request, lambda _r, index=index: response(response_id=f"resp-{index}")
                )
                is not None
            )
    assert len(client.payloads) == 20
    assert len({p.invocationId for p in client.payloads}) == 20


class _BindModel:
    def __init__(self, provider="openai", profile=None):
        self.provider = provider
        self.model_name = "model-alpha"
        self.profile = profile

    def bind(self, **kwargs):
        self.bind_kwargs = kwargs
        return SimpleNamespace(bound=self, kwargs=kwargs)


def test_output_cap_settings_use_the_route_output_cap_or_fail_closed():
    assert output_cap_settings(_BindModel(profile={"max_output_tokens": 777})) == {"max_tokens": 777}
    with pytest.raises(ValueError, match="max_output_tokens"):
        output_cap_settings(_BindModel())
    assert output_cap_settings(_BindModel(provider="apx", profile={"max_output_tokens": 55})) == {"max_tokens": 55}
    assert output_cap_settings(_BindModel(provider="google_genai", profile={"max_output_tokens": 9})) == {"max_output_tokens": 9}


@pytest.mark.parametrize("bad_cap", [None, False, True, 0, -1, "4096", 12.5])
def test_output_token_limit_rejects_missing_bool_non_int_and_non_positive_caps(bad_cap):
    model = SimpleNamespace(profile={"max_output_tokens": bad_cap}, options={})
    with pytest.raises(ValueError, match="max_output_tokens"):
        output_token_limit(model)
    with pytest.raises(ValueError, match="max_output_tokens"):
        output_cap_settings(model)


def test_output_token_limit_falls_back_through_route_options_and_model_options():
    route = mp.ResolvedModelConfig(
        role="default",
        route_id="r1",
        provider="openai",
        protocol="openai",
        model="model-alpha",
        options={"max_output_tokens": 12345},
    )
    model_with_route = mp.attach_model_route(SimpleNamespace(profile={}), route)
    assert output_token_limit(model_with_route) == 12345

    model_with_options = SimpleNamespace(profile=None, options={"max_output_tokens": 9876})
    assert output_token_limit(model_with_options) == 9876


def test_usage_metering_exports_separated_completion_and_evaluation_state_sets():
    assert set(PROVIDER_COMPLETION_STATES) == {
        "COMPLETED",
        "MAX_TOKENS",
        "TRUNCATED",
        "FAILED",
        "OUTCOME_UNKNOWN",
    }
    assert set(OUTPUT_EVALUATION_STATES) == {
        "ACCEPTED",
        "SCHEMA_INVALID",
        "DOMAIN_REJECTED",
        "NOT_EVALUATED",
    }
    assert {"PROVIDER_COMPLETION_STATES", "OUTPUT_EVALUATION_STATES", "output_cap_settings", "output_token_limit"} <= set(
        usage_metering.__all__
    )


def test_output_cap_preserves_identity_for_usage_reporting():
    model = _BindModel(profile={"max_output_tokens": 8192})

    class Request:
        messages = []
        model_settings = {"automatic_function_calling": {"disable": True}}
        logical_operation_id = "op-cap"

        def __init__(self):
            self.model = model

        def override(self, *, model_settings):
            # Preserve logical_operation_id across _prepare()'s request.override() so
            # _execute_server_admission receives the caller's operation identity.
            return SimpleNamespace(
                model=self.model,
                messages=self.messages,
                model_settings=model_settings,
                logical_operation_id=self.logical_operation_id,
            )

    client = AdmittedFakeClient()
    downstream = []

    def provider_handler(request):
        downstream.append(request)
        return SimpleNamespace(
            usage_metadata={"input_tokens": 3, "output_tokens": 2},
            # OpenAI response metadata commonly omits provider.
            response_metadata={"model_name": "model-alpha", "id": "resp-1"},
        )

    with activate_agent_run_state(_state(client)):
        UsageMeteringMiddleware().wrap_model_call(Request(), provider_handler)

    # The cap rides in model settings next to the existing ones; the model itself is untouched.
    assert downstream[0].model_settings == {
        "max_tokens": 8192,
        "automatic_function_calling": {"disable": True},
    }
    assert downstream[0].model is model
    (payload,) = client.payloads
    assert (payload.provider, payload.model) == ("OPENAI", "model-alpha")
    # Why: extract_provider_usage populates uncached inputTokens == input_tokens when an inclusive
    # provider omits cached buckets (matching test_extract_provider_usage_preserves_partial_dimensions).
    # Invariant: Inclusive input tokens with no cached bucket represent uncached billable input tokens.
    assert payload.inputTokens == "3"
    assert (payload.inputTokensIncludingCache, payload.outputTokens) == ("3", "2")
    assert payload.occurredAt.endswith("Z") and "+00:00" not in payload.occurredAt


# --- telemetry -----------------------------------------------------------------------------


def test_model_call_telemetry_emits_heartbeat_and_completion(monkeypatch):
    events = _capture_events(monkeypatch)
    monkeypatch.setattr(usage_metering, "_MODEL_CALL_HEARTBEAT_SECONDS", 0.01)
    client = AdmittedFakeClient()
    request = _request("google_genai", "future-model-v99", logical_operation_id="op-hb")

    def slow_provider(_request):
        time.sleep(0.03)
        return response()

    with activate_agent_run_state(_state(client)):
        UsageMeteringMiddleware().wrap_model_call(request, slow_provider)

    event_types = [event_type for event_type, _ in events]
    assert {"MODEL_CALL_STARTED", "MODEL_CALL_HEARTBEAT", "MODEL_CALL_COMPLETED"} <= set(event_types)
    started = next(f for t, f in events if t == "MODEL_CALL_STARTED")
    assert started["data"]["provider"] == "google_genai"
    assert started["data"]["protocol"] == "google_genai"
    assert started["data"]["model"] == "future-model-v99"
    assert started["data"]["timeout_seconds"] == 300.0
    assert len(client.payloads) == 1


def test_model_call_timeout_emits_timeout_event_and_no_usage(monkeypatch):
    events = _capture_events(monkeypatch)
    client = AdmittedFakeClient()
    request = _request("google_genai", "future-model-v99")

    with activate_agent_run_state(_state(client)), pytest.raises(TimeoutError):
        AgentRoleMiddleware("planner").wrap_model_call(
            request,
            lambda inner: UsageMeteringMiddleware().wrap_model_call(
                inner, lambda _r: (_ for _ in ()).throw(TimeoutError("provider timed out"))
            ),
        )

    assert [t for t, _ in events] == ["MODEL_CALL_STARTED", "CUSTOM_PROGRESS", "MODEL_CALL_TIMEOUT"]
    attempt = events[1][1]["data"]
    assert attempt["activity_kind"] == "MODEL_PROVIDER_ATTEMPT_FAILED"
    assert attempt["provider"] == "google_genai"
    assert attempt["error_class"] == "TimeoutError"
    assert events[-1][1]["data"]["provider"] == "google_genai"
    assert events[-1][1]["data"]["error_type"] == "TimeoutError"
    assert client.payloads == []


def test_request_diagnostic_logs_shape_without_prompt_or_tool_content(monkeypatch):
    events = []

    class Logger:
        def info(self, event, **fields):
            events.append((event, fields))

    monkeypatch.setattr(usage_metering, "logger", Logger())
    request = SimpleNamespace(
        model=SimpleNamespace(
            provider="apx",
            model_name="model-gamma",
            options=dict(_DEFAULT_ROUTE_OPTIONS),
        ),
        messages=[
            HumanMessage(content="private prompt must not be logged"),
            AIMessage(
                content="",
                tool_calls=[
                    {"name": "ls", "args": {"path": "/workspace/repository"}, "id": "call_sensitive_tool_id"}
                ],
            ),
            ToolMessage(
                content="private tool result must not be logged",
                tool_call_id="call_sensitive_tool_id",
                name="ls",
            ),
        ],
        tools=[SimpleNamespace(name="ls")],
        tool_choice={"type": "function", "name": "ls"},
        logical_operation_id="op-diag-1",
    )

    # Why: Diagnostic logging still runs inside wrap_model_call, which now requires an admitted run context.
    # How: Activate a lease-bound AgentRunState backed by AdmittedFakeClient (assessment_id=None).
    # Invariant: Diagnostic payloads never include prompt text, tool args, or secrets.
    state = _state(
        AdmittedFakeClient(),
        role="planner",
        run_id="run-diag-1",
        assessment_id=None,
        execution_lease_token="lease-diag-1",
    )
    with activate_agent_run_state(state):
        UsageMeteringMiddleware().wrap_model_call(request, lambda _: response())

    _, fields = next(item for item in events if item[0] == "MODEL_REQUEST_DIAGNOSTIC")
    assert fields["provider"] == "apx"
    assert fields["model"] == "model-gamma"
    assert fields["message_roles"] == ["user", "assistant(tool_calls)", "tool"]
    assert fields["tool_count"] == 1
    assert fields["tool_result_count"] == 1
    assert fields["tool_choice"] is None
    serialized = str(fields)
    for secret in ("private prompt", "private tool result", "call_sensitive_tool_id", "/workspace/repository"):
        assert secret not in serialized


def test_request_shape_diagnostic_stays_bounded_for_long_runs():
    messages = [HumanMessage(content="start")]
    for index in range(200):
        call_id = f"call_{index:04d}"
        messages.append(AIMessage(content="", tool_calls=[{"name": "ls", "args": {}, "id": call_id}]))
        messages.append(ToolMessage(content="result", tool_call_id=call_id, name="ls"))

    fields = usage_metering._request_shape_diagnostic(
        SimpleNamespace(messages=messages, tools=[]),
        SimpleNamespace(provider="apx", model_name="model-gamma"),
    )

    assert fields["message_count"] == 401
    assert len(fields["message_roles"]) == 8
    assert fields["message_roles"][-1] == "tool"
    assert fields["message_roles_omitted"] == 393
    assert fields["tool_result_count"] == 200
    assert fields["tool_call_id_shapes"] == [
        {"length": len("call_0000"), "has_call_prefix": True, "contains_whitespace": False}
    ]
    assert len(str(fields)) < 1_000


def test_key_fallback_failed_attempt_reports_nothing_and_success_reports_once(monkeypatch):
    from middleware import token_fallback
    from middleware.token_fallback import TokenFallbackMiddleware

    client = AdmittedFakeClient()
    attempts = []
    fallback = TokenFallbackMiddleware()
    monkeypatch.setattr(token_fallback, "model_provider", lambda _model: "openai")
    monkeypatch.setattr(
        token_fallback, "provider_token_source", lambda _p: ("OPENAI_API_KEY", ("key-1", "key-2"))
    )
    monkeypatch.setattr(
        fallback,
        "_candidate_request",
        # Preserve logical_operation_id on each fallback candidate so every physical attempt
        # carries the caller's logical operation identity into server admission.
        lambda candidate, _p, _t, index: SimpleNamespace(
            model=candidate.model,
            key_slot=index,
            logical_operation_id=getattr(candidate, "logical_operation_id", "op-fb"),
        ),
    )

    def provider_call(candidate):
        attempts.append(candidate.key_slot)
        if candidate.key_slot == 0:
            raise ConnectionError("temporary provider failure")
        return response(response_id="resp-after-fallback")

    with activate_agent_run_state(_state(client)):
        fallback.wrap_model_call(
            _request(logical_operation_id="op-fb"),
            lambda candidate: UsageMeteringMiddleware().wrap_model_call(candidate, provider_call),
        )

    assert attempts == [0, 1]
    (succeeded,) = client.payloads
    assert succeeded.providerResponseId == "resp-after-fallback"


# --- effective runtime model -----------------------------------------------------------------


def _settle(role, provider, model_name):
    client = AdmittedFakeClient()
    with activate_agent_run_state(_state(client, role=role)):
        UsageMeteringMiddleware().wrap_model_call(
            _request(provider, model_name, logical_operation_id="op-settle"),
            lambda _: response(),
        )
    return client.payloads[0]


def test_usage_reports_effective_runtime_model_of_the_resolved_route():
    payload = _settle("planner", "openai", "model-alpha")

    runtime = payload.effectiveRuntimeModel
    assert (payload.provider, payload.model) == ("OPENAI", "model-alpha")
    assert set(runtime) == {"provider", "protocol", "model", "policyVersion", "effectiveAt"}
    assert (runtime["provider"], runtime["model"]) == ("OPENAI", "model-alpha")
    assert runtime["protocol"] == "openai"
    assert runtime["policyVersion"].startswith("cfg-")
    assert runtime["effectiveAt"] == "1970-01-01T00:00:00.000Z"


@pytest.mark.parametrize(
    ("protocol", "model_name", "client_provider"),
    [
        ("anthropic", "claude-sonnet-4-6-free", "anthropic"),
        ("openai", "gpt-5.6-luna", "openai"),
    ],
    ids=["apx-anthropic", "apx-openai"],
)
def test_apx_usage_and_activity_keep_canonical_provider_and_route_protocol(
    monkeypatch, protocol, model_name, client_provider
):
    use_model_routes(
        monkeypatch,
        {
            "routes": {
                "primary": {
                    "provider": "apx",
                    "protocol": protocol,
                    "model": model_name,
                    "options": dict(_DEFAULT_ROUTE_OPTIONS),
                }
            },
            "roles": {"default": "primary"},
        },
    )
    route = mp.resolve_role("default")
    model = mp.attach_model_route(
        SimpleNamespace(provider=client_provider, model_name=model_name), route
    )
    request = SimpleNamespace(model=model, messages=[], tools=[], logical_operation_id="op-apx")
    client = AdmittedFakeClient()
    events = _capture_events(monkeypatch)

    with activate_agent_run_state(_state(client)):
        UsageMeteringMiddleware().wrap_model_call(request, lambda _: response())

    assert len(client.payloads) == 1
    payload = client.payloads[0]
    assert (payload.provider, payload.model) == ("APX", model_name)
    assert payload.effectiveRuntimeModel["provider"] == "APX"
    assert payload.effectiveRuntimeModel["protocol"] == protocol
    for event_type in ("MODEL_CALL_STARTED", "MODEL_CALL_COMPLETED"):
        data = next(fields["data"] for kind, fields in events if kind == event_type)
        assert (data["provider"], data["protocol"], data["model"]) == (
            "apx", protocol, model_name
        )


def test_policy_version_changes_when_model_or_options_change(monkeypatch):
    before = _settle("planner", "openai", "model-alpha").effectiveRuntimeModel
    assert _settle("planner", "openai", "model-alpha").effectiveRuntimeModel == before

    _set_routes(monkeypatch, alpha_model="model-omega-7")
    after = _settle("planner", "openai", "model-omega-7").effectiveRuntimeModel
    assert after["model"] == "model-omega-7"
    assert after["policyVersion"] != before["policyVersion"]

    _set_routes(monkeypatch, alpha_options={"reasoning": {"effort": "high"}})
    reasoned = _settle("planner", "openai", "model-alpha").effectiveRuntimeModel
    assert reasoned["policyVersion"] not in {before["policyVersion"], after["policyVersion"]}


def test_fallback_route_usage_reports_the_route_actually_used_with_the_agent_role():
    primary = _settle("planner", "openai", "model-alpha")
    fallback = _settle("planner", "apx", "model-gamma")

    assert (fallback.provider, fallback.model) == ("APX", "model-gamma")
    assert (fallback.effectiveRuntimeModel["provider"], fallback.effectiveRuntimeModel["model"]) == (
        "APX",
        "model-gamma",
    )
    assert fallback.effectiveRuntimeModel["policyVersion"] != primary.effectiveRuntimeModel["policyVersion"]
    other_role = _settle("narrator", "apx", "model-gamma")
    assert other_role.effectiveRuntimeModel["policyVersion"] != fallback.effectiveRuntimeModel["policyVersion"]


# --- run state: sticky routes and role-scoped identity -------------------------------------------


def test_disabled_and_sticky_provider_routes_are_run_scoped():
    state = _state(FakeClient())
    assert not state.provider_route_disabled("apx:model-gamma")
    state.disable_provider_route("APX:model-gamma", sticky=True)
    state.disable_provider_route("openai:model-alpha")
    assert state.provider_route_disabled("apx:model-gamma")
    assert state.provider_route_sticky("apx:model-gamma")
    assert state.provider_route_disabled("openai:model-alpha")
    assert not state.provider_route_sticky("openai:model-alpha")
    assert not _state(FakeClient()).provider_route_disabled("apx:model-gamma")


def test_active_role_scopes_the_reported_agent_role_and_run_identity():
    client = AdmittedFakeClient()
    with activate_agent_run_state(_state(client, role="root", run_id="run-9")):
        UsageMeteringMiddleware().wrap_model_call(
            _request(logical_operation_id="op-role-1"), lambda _: response()
        )
        AgentRoleMiddleware("investigator").wrap_model_call(
            _request(),
            lambda inner: UsageMeteringMiddleware().wrap_model_call(inner, lambda _: response()),
        )
    assert [(p.agentRole, p.runId) for p in client.payloads] == [
        ("root", "run-9"),
        ("investigator", "run-9"),
    ]
    assert active_agent_run_state() is None


# --- failure to deliver usage is never silent ----------------------------------------------------


def _store_rows(path):
    with sqlite3.connect(path) as db:
        return db.execute("SELECT kind, state, recovery_key FROM usage_recovery WHERE kind != 'EVIDENCE' ORDER BY id").fetchall()


def test_failed_usage_post_is_enqueued_logged_and_never_fails_the_model_call(monkeypatch):
    warnings = []

    class Logger:
        def info(self, *_a, **_k):
            pass

        def warning(self, event, **fields):
            warnings.append((event, fields))

        def error(self, *_a, **_k):
            pass

    monkeypatch.setattr(usage_metering, "logger", Logger())
    state = _state(FailingClient())
    with activate_agent_run_state(state):
        result = UsageMeteringMiddleware().wrap_model_call(
            _request(logical_operation_id="op-fail-post"), lambda _: response()
        )

    assert result is not None
    # API unavailability leaves both lifecycle callbacks durable; provider work is not repeated.
    rows = _store_rows(resolve_usage_recovery_store_path())
    assert [(kind, state_) for kind, state_, _ in rows] == [("USAGE", "PENDING"), ("USAGE", "PENDING")]


def test_queued_usage_is_drained_later_exactly_once():
    with activate_agent_run_state(_state(FailingClient())):
        UsageMeteringMiddleware().wrap_model_call(
            _request(logical_operation_id="op-drain-once"), lambda _: response()
        )
    path = resolve_usage_recovery_store_path()

    recovered = AdmittedFakeClient()
    assert drain(path, recovered) == 2
    assert len(recovered.payloads) == 1
    assert recovered.payloads[0].inputTokens == "2"
    assert drain(path, recovered) == 0
    assert len(recovered.payloads) == 1


def test_still_failing_api_keeps_usage_pending_for_the_next_drain():
    with activate_agent_run_state(_state(FailingClient())):
        UsageMeteringMiddleware().wrap_model_call(
            _request(logical_operation_id="op-still-failing"), lambda _: response()
        )
    path = resolve_usage_recovery_store_path()

    assert drain(path, FailingClient()) == 0
    assert [s for _, s, _ in _store_rows(path)] == ["PENDING", "PENDING"]


def test_recovery_store_failure_prevents_provider_dispatch(monkeypatch):
    monkeypatch.setattr(
        usage_metering,
        "enqueue_usage",
        lambda *_a: (_ for _ in ()).throw(OSError("recovery-store-failed")),
    )
    from langchain_core.exceptions import ModelError
    dispatched = []
    with activate_agent_run_state(_state(FailingClient())), pytest.raises(ModelError, match="Durable usage commit failed"):
        UsageMeteringMiddleware().wrap_model_call(
            _request(logical_operation_id="op-store-fail"), lambda _: dispatched.append(1)
        )
    assert dispatched == []


def _payload(invocation_id="invocation-1"):
    return SettledUsagePayload(
        assessmentId="assessment-1",
        runId="run-1",
        invocationId=invocation_id,
        agentRole="planner",
        provider="OPENAI",
        model="model-alpha",
        inputTokens="1",
        outputTokens="1",
        occurredAt="2026-09-24T16:39:22Z",
    )


def test_enqueue_is_idempotent_on_the_usage_recovery_key(tmp_path):
    path = tmp_path / "idem.sqlite3"
    enqueue_usage(path, _payload())
    enqueue_usage(path, _payload())
    enqueue_usage(path, _payload("invocation-2"))
    keys = [key for _, _, key in _store_rows(path)]
    assert keys == [usage_recovery_key(_payload()), usage_recovery_key(_payload("invocation-2"))]
    assert keys[0] == "usage:assessment-1:run-1:invocation-1"


@pytest.mark.parametrize("status", [400, 403, 404, 409, 422])
def test_contract_rejected_usage_is_quarantined_once_not_retried_forever(tmp_path, status, caplog):
    path = tmp_path / "poison.sqlite3"
    enqueue_usage(path, _payload())

    class RejectingClient:
        attempts = 0

        def post_settled_usage(self, _payload):
            self.attempts += 1
            raise WorkerCallbackError("Client error", status_code=status)

    client = RejectingClient()
    with caplog.at_level("ERROR"):
        assert drain(path, client) == 0
        assert drain(path, client) == 0
    assert client.attempts == 1
    assert [s for _, s, _ in _store_rows(path)] == ["POISON"]
    assert any("quarantined" in r.getMessage() for r in caplog.records)
    with sqlite3.connect(path) as db:
        reason = db.execute("SELECT dead_letter_reason FROM usage_recovery").fetchone()[0]
    assert reason.startswith(f"HTTP_{status}")


def test_server_errors_are_transient_and_stay_pending(tmp_path):
    path = tmp_path / "transient.sqlite3"
    enqueue_usage(path, _payload())

    class Unavailable:
        def post_settled_usage(self, _payload):
            raise WorkerCallbackError("server error", status_code=503)

    assert drain(path, Unavailable()) == 0
    assert [s for _, s, _ in _store_rows(path)] == ["PENDING"]


def test_recovery_store_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(usage_recovery, "MAX_PENDING_ROWS", 2)
    path = tmp_path / "bounded.sqlite3"
    for index in range(5):
        enqueue_usage(path, _payload(f"invocation-{index}"))
    assert len(_store_rows(path)) == 2


def test_recovery_normalizes_legacy_utc_offset_timestamp():
    payload = {"occurredAt": "2026-09-24T16:39:22.123456+00:00", "invocationId": "inv-1"}

    normalized = _normalize_usage_recovery_payload(payload)

    assert normalized["occurredAt"] == "2026-09-24T16:39:22.123456Z"
    assert normalized["invocationId"] == "inv-1"
    assert payload["occurredAt"].endswith("+00:00")


def test_background_worker_starts_once_per_store(tmp_path, monkeypatch):
    started = []

    class FakeThread:
        def __init__(self, **kwargs):
            started.append(kwargs["name"])

        def start(self):
            pass

    monkeypatch.setattr(usage_recovery.threading, "Thread", FakeThread)
    monkeypatch.setattr(usage_recovery, "_workers", set())
    path = tmp_path / "worker.sqlite3"
    usage_recovery.start_background_worker(path, FakeClient())
    usage_recovery.start_background_worker(path, FakeClient())
    assert started == ["usage-recovery"]


def test_usage_recovery_store_path_override_and_default(monkeypatch, tmp_path):
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(tmp_path / "x.sqlite3"))
    assert resolve_usage_recovery_store_path() == str(tmp_path / "x.sqlite3")
    monkeypatch.delenv("USAGE_RECOVERY_STORE_PATH")
    default = Path(resolve_usage_recovery_store_path())
    assert default.is_absolute() and default.name == "usage-recovery.sqlite3"
    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", "rel/usage.sqlite3")
    assert Path(resolve_usage_recovery_store_path()).is_absolute()


def test_consumer_starts_the_usage_recovery_worker_at_startup(monkeypatch):
    from tools.common.capabilities.agent_runtime import rabbitmq_consumer

    started = []
    client = object()
    monkeypatch.setattr(rabbitmq_consumer, "load_runtime_env", lambda: None)
    monkeypatch.setattr(rabbitmq_consumer, "_worker_client_or_none", lambda: client)
    monkeypatch.setattr(
        rabbitmq_consumer, "start_background_worker", lambda path, api: started.append((path, api))
    )
    monkeypatch.delenv("RABBITMQ_URL", raising=False)

    with pytest.raises(RuntimeError, match="RABBITMQ_URL"):
        rabbitmq_consumer.run_consumer()

    assert started == [(resolve_usage_recovery_store_path(), client)]


# --- boundary run state ----------------------------------------------------------------------------


def test_assessment_invocation_gets_a_usage_reporting_run_state(monkeypatch):
    import tools.common.capabilities.agent_runtime.invocation as invocation

    clients = []
    monkeypatch.setattr(
        invocation,
        "WorkerApiClient",
        lambda *_a: clients.append(object()) or clients[-1],
    )
    monkeypatch.setattr(
        invocation,
        "load_config",
        lambda: SimpleNamespace(nestjs_api_base_url="http://api", worker_api_key="k"),
    )

    state = invocation._agent_run_state(
        "planner", {"assessmentId": "assessment-1", "runId": "run-1"}, "corr-1"
    )

    assert (state.assessment_id, state.run_id, state.agent_role) == ("assessment-1", "run-1", "planner")
    assert state.api_client is clients[0]


def test_non_assessment_invocation_has_a_state_without_usage_reporting():
    import tools.common.capabilities.agent_runtime.invocation as invocation

    state = invocation._agent_run_state("legal", {"requestId": "request-1"}, "corr-1")

    assert state.api_client is None and state.assessment_id is None
    assert state.run_id == "request-1"


def test_corrupt_row_is_quarantined_and_does_not_block_later_rows(tmp_path):
    path = tmp_path / "corrupt.sqlite3"
    enqueue_usage(path, _payload("invocation-1"))
    enqueue_usage(path, _payload("invocation-2"))
    with sqlite3.connect(path) as db:
        db.execute("UPDATE usage_recovery SET payload = '{not json' WHERE id = 1")
    delivered = FakeClient()
    assert drain(path, delivered) == 1
    assert [p.invocationId for p in delivered.payloads] == ["invocation-2"]
    assert [s for _, s, _ in _store_rows(path)] == ["POISON"]


@pytest.mark.parametrize("actual_route", ["audit-fallback", "general-fallback"])
def test_usage_keeps_attached_route_options_when_provider_model_protocol_are_shared(monkeypatch, actual_route):
    use_model_routes(monkeypatch, {
        "routes": {
            "primary": {"provider": "openai", "model": "model-alpha"},
            "audit-fallback": {"provider": "google_genai", "model": "shared-model", "options": {"reasoning_effort": "high"}},
            "general-fallback": {"provider": "google_genai", "model": "shared-model"},
        },
        "roles": {"default": "primary", "planner": "primary"},
        "fallbacks": {"primary": ["audit-fallback"]},
    })
    assert mp.route_for_model("google_genai", "shared-model", "google_genai") is None
    route = mp.load_model_routes().config(actual_route, "planner")
    # Why: Keep route.options untouched so config_snapshot parity holds while supplying required
    # server admission bounds via model.profile (without max_input_tokens).
    # Invariant: Shared provider/protocol/model routes remain ambiguous to route_for_model.
    model = mp.attach_model_route(
        SimpleNamespace(
            provider="google_genai",
            model_name="shared-model",
            profile=dict(_DEFAULT_ROUTE_OPTIONS),
        ),
        route,
    )
    client = AdmittedFakeClient()
    with activate_agent_run_state(_state(client, role="planner")):
        UsageMeteringMiddleware().wrap_model_call(
            SimpleNamespace(model=model, messages=[], tools=[], logical_operation_id="op-shared"),
            lambda _: response(),
        )
    expected = mp.config_snapshot(route, "planner")
    expected.pop("role")
    assert client.payloads[0].effectiveRuntimeModel == expected
