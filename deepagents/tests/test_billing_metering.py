from pathlib import Path
from types import SimpleNamespace

from middleware.billing_metering import (
    BillingReservationUnavailable,
    BillingMeteringError,
    BillingMeteringMiddleware,
    BillingMeteringSession,
    BillingUsageUnavailable,
    activate_billing_metering,
    extract_provider_usage,
)
from middleware.billing_recovery import drain
from tools.common.capabilities.managed.invocation import _billing_metering_session
from tools.common.capabilities.managed.rabbitmq_consumer import _with_billing_attempt


class FakeClient:
    def __init__(self):
        self.payloads = []

    def post_settled_usage(self, payload):
        self.payloads.append(payload)


class FailingClient:
    def post_settled_usage(self, _payload):
        raise RuntimeError("billing-api-unavailable")


class RecoveryClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.release_ids = []
        self.fail_usage = True
        self.fail_release = True

    def post_settled_usage(self, payload):
        if self.fail_usage:
            raise RuntimeError("billing-api-unavailable")
        super().post_settled_usage(payload)

    def release_billing_reservation(self, reservation_id, _payload):
        if self.fail_release:
            raise RuntimeError("billing-api-unavailable")
        self.release_ids.append(reservation_id)


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


def test_extract_provider_usage_is_numeric_and_does_not_persist_reasoning_content():
    usage = extract_provider_usage(
        response(), SimpleNamespace(provider="openai", model_name="gpt-test")
    )

    assert usage == {
        "inputTokens": "2",
        "cachedInputTokens": "1",
        "outputTokens": "2",
        "totalTokens": "5",
        "providerResponseId": "resp-1",
    }
    assert "reasoning" not in usage


def test_extract_provider_usage_fails_closed_when_required_dimensions_are_missing():
    assert extract_provider_usage(
        SimpleNamespace(usage_metadata={"input_tokens": 1}),
        SimpleNamespace(provider="openai", model_name="gpt-test"),
    ) is None


def test_metering_middleware_records_one_payload_for_one_response():
    client = FakeClient()
    session = BillingMeteringSession(
        api_client=client,
        assessment_id="assessment-1",
        run_id="run-1",
        reservation_id="reservation-1",
        agent_role="planner",
        effective_runtime_model={
            "policyVersion": "policy-1",
            "effectiveAt": "2026-01-01T00:00:00Z",
        },
    )
    request = SimpleNamespace(model=SimpleNamespace(provider="openai", model_name="gpt-test"))
    middleware = BillingMeteringMiddleware()

    with activate_billing_metering(session):
        result = middleware.wrap_model_call(request, lambda _: response())

    assert result is not None
    assert len(client.payloads) == 1
    payload = client.payloads[0]
    assert payload.assessmentId == "assessment-1"
    assert payload.runId == "run-1"
    assert payload.agentRole == "planner"
    assert payload.providerResponseId == "resp-1"
    assert payload.inputTokens == "2"
    assert payload.cachedInputTokens == "1"
    assert payload.model_dump(exclude_none=True).get("reasoningTokens") is None


def test_key_fallback_attempts_charge_only_the_returned_response(monkeypatch):
    from middleware import token_fallback
    from middleware.token_fallback import TokenFallbackMiddleware

    client = FakeClient()
    session = BillingMeteringSession(
        api_client=client,
        assessment_id="assessment-fallback",
        run_id="run-fallback",
        reservation_id="reservation-fallback",
        agent_role="planner",
    )
    request = SimpleNamespace(
        model=SimpleNamespace(provider="openai", model_name="gpt-test")
    )
    attempts = []
    fallback = TokenFallbackMiddleware()

    monkeypatch.setattr(token_fallback, "model_provider", lambda _model: "openai")
    monkeypatch.setattr(
        token_fallback,
        "provider_token_source",
        lambda _provider: ("OPENAI_API_KEY", ("key-1", "key-2")),
    )
    monkeypatch.setattr(
        fallback,
        "_candidate_request",
        lambda candidate, _provider, _token, index: SimpleNamespace(
            model=candidate.model,
            key_slot=index,
        ),
    )

    def provider_call(candidate):
        attempts.append(candidate.key_slot)
        if candidate.key_slot == 0:
            raise ConnectionError("temporary provider failure")
        return response(response_id="resp-after-fallback")

    with activate_billing_metering(session):
        fallback.wrap_model_call(
            request,
            lambda candidate: BillingMeteringMiddleware().wrap_model_call(
                candidate,
                provider_call,
            ),
        )

    assert attempts == [0, 1]
    assert len(client.payloads) == 1
    assert client.payloads[0].providerResponseId == "resp-after-fallback"
    assert client.payloads[0].assessmentId == "assessment-fallback"


def test_output_cap_preserves_authorized_identity_for_settlement():
    class BindCapableModel:
        provider = "openai"
        model_name = "gpt-test"

        def bind(self, **kwargs):
            self.bind_kwargs = kwargs
            # Matches LangChain's wrapper behavior: provider/model attrs are on
            # the original model, not on the RunnableBinding passed downstream.
            return SimpleNamespace(bound=self, kwargs=kwargs)

    class Request:
        messages = []
        model = BindCapableModel()

        def override(self, *, model):
            return SimpleNamespace(model=model, messages=self.messages)

    class PolicyCheckingClient(FakeClient):
        def post_settled_usage(self, payload):
            assert (payload.provider, payload.model) == ("OPENAI", "gpt-test")
            assert payload.effectiveRuntimeModel["provider"] == "OPENAI"
            assert payload.effectiveRuntimeModel["model"] == "gpt-test"
            super().post_settled_usage(payload)

    client = PolicyCheckingClient()
    model = Request.model
    session = BillingMeteringSession(
        api_client=client,
        assessment_id="assessment-1",
        run_id="run-1",
        reservation_id="reservation-1",
        agent_role="planner",
        effective_runtime_model={"policyVersion": "policy-1"},
        max_output_tokens=7,
        max_reasoning_tokens=3,
        reserved_provider="OPENAI",
        reserved_model="gpt-test",
        authorized_models={("OPENAI", "gpt-test")},
    )
    downstream_models = []

    def provider_handler(request):
        downstream_models.append(request.model)
        return SimpleNamespace(
            usage_metadata={"input_tokens": 3, "output_tokens": 2},
            # OpenAI response metadata commonly omits provider.
            response_metadata={"model_name": "gpt-test", "id": "resp-1"},
        )

    with activate_billing_metering(session):
        BillingMeteringMiddleware().wrap_model_call(Request(), provider_handler)

    assert model.bind_kwargs == {"max_output_tokens": 10}
    assert downstream_models[0].bound is model
    assert len(client.payloads) == 1
    payload = client.payloads[0]
    assert payload.provider == "OPENAI"
    assert payload.model == "gpt-test"
    assert payload.inputTokens == "3"
    assert payload.outputTokens == "2"


def test_metering_middleware_records_missing_usage_for_terminal_release():
    client = FakeClient()
    session = BillingMeteringSession(
        api_client=client,
        assessment_id="assessment-1",
        run_id="run-1",
        reservation_id="reservation-1",
        agent_role="planner",
        effective_runtime_model={
            "policyVersion": "policy-1",
            "effectiveAt": "2026-01-01T00:00:00Z",
        },
    )
    request = SimpleNamespace(model=SimpleNamespace(provider="openai", model_name="gpt-test"))

    with activate_billing_metering(session):
        BillingMeteringMiddleware().wrap_model_call(
            request,
            lambda _: SimpleNamespace(
                usage_metadata={"input_tokens": 1},
                response_metadata={"id": "missing-usage-response"},
            ),
        )
    assert len(client.payloads) == 1
    assert client.payloads[0].inputTokens is None
    assert client.payloads[0].outputTokens is None
    assert client.payloads[0].providerResponseId == "missing-usage-response"


def test_reservation_replay_refuses_a_terminal_reservation_before_model_spend():
    class Client(FakeClient):
        def reserve_billing_credits(self, _payload):
            return {"id": "reservation-1", "status": "RELEASED"}

    with __import__("pytest").raises(BillingReservationUnavailable):
        BillingMeteringSession.reserve(
            api_client=Client(),
            assessment_id="assessment-1",
            run_id="run-1",
            agent_role="planner",
            amount_credits="100",
            max_charge_credits="100",
            provider="openai",
            model="gpt-test",
            max_input_tokens="1000",
            max_input_bytes="4000",
            max_output_tokens="1000",
            max_reasoning_tokens="1000",
            max_invocations="1",
            authorized_models=[{"provider": "OPENAI", "model": "gpt-test"}],
            idempotency_key="outbox:1:planner",
        )


def test_assessment_invocation_cannot_bypass_server_issued_billing_context():
    import pytest

    with pytest.raises(ValueError, match="billing context is required"):
        _billing_metering_session(
            "planner",
            {"assessmentId": "assessment-1", "runId": "run-1"},
            "corr-1",
        )


def test_non_assessment_invocation_can_remain_unbilled():
    assert _billing_metering_session("legal", {"requestId": "request-1"}, "corr-1") is None


def test_broker_retry_attempt_is_carried_only_inside_billing_context():
    message = {
        "assessmentId": "assessment-1",
        "billing": {"idempotencyKey": "outbox:1:billing-reservation"},
    }
    retried = _with_billing_attempt(message, 2)

    assert retried["billing"]["attempt"] == "2"
    assert "attempt" not in message["billing"]


def test_usage_delivery_failure_is_not_converted_to_provider_fallback():
    session = BillingMeteringSession(
        api_client=FailingClient(),
        assessment_id="assessment-1",
        run_id="run-1",
        reservation_id="reservation-1",
        agent_role="planner",
    )
    request = SimpleNamespace(
        model=SimpleNamespace(provider="openai", model_name="gpt-test")
    )

    import pytest

    with activate_billing_metering(session), pytest.raises(BillingMeteringError):
        BillingMeteringMiddleware().wrap_model_call(request, lambda _: response())


def test_usage_delivery_failure_is_terminal_for_model_retry():
    from middleware.failure_policy import retry_model_error

    assert not retry_model_error(BillingMeteringError(RuntimeError("api-down")))


def test_recovery_store_failure_is_terminal_after_provider_success(monkeypatch):
    import pytest

    client = FailingClient()
    session = BillingMeteringSession(
        api_client=client,
        assessment_id="assessment-1",
        run_id="run-1",
        reservation_id="reservation-1",
        agent_role="planner",
        recovery_store_path="D:/unwritable/billing.sqlite3",
    )
    monkeypatch.setattr(
        "middleware.billing_metering.enqueue_usage_and_release",
        lambda *_args: (_ for _ in ()).throw(OSError("recovery-store-failed")),
    )

    with activate_billing_metering(session), pytest.raises(BillingMeteringError):
        BillingMeteringMiddleware().wrap_model_call(
            SimpleNamespace(
                model=SimpleNamespace(provider="openai", model_name="gpt-test")
            ),
            lambda _: response(),
        )

    from middleware.failure_policy import retry_model_error

    assert not retry_model_error(BillingMeteringError(OSError("recovery-store-failed")))


def test_usage_failure_is_durable_and_replayed_without_provider_retry(tmp_path: Path):
    client = RecoveryClient()
    session = BillingMeteringSession(
        api_client=client,
        assessment_id="assessment-1",
        run_id="run-1",
        reservation_id="reservation-1",
        agent_role="planner",
        recovery_store_path=str(tmp_path / "billing.sqlite3"),
    )
    request = SimpleNamespace(
        model=SimpleNamespace(provider="openai", model_name="gpt-test")
    )

    import pytest

    with activate_billing_metering(session), pytest.raises(BillingMeteringError):
        BillingMeteringMiddleware().wrap_model_call(request, lambda _: response())
    assert len(client.payloads) == 0

    client.fail_usage = False
    client.fail_release = False
    assert drain(session.recovery_store_path, client) == 2
    assert len(client.payloads) == 1
    assert client.payloads[0].invocationId in session._invocation_ids
    assert client.release_ids == ["reservation-1"]
    assert drain(session.recovery_store_path, client) == 0


def test_release_failure_is_durable_and_replayed_without_model_retry(tmp_path: Path):
    client = RecoveryClient()
    session = BillingMeteringSession(
        api_client=client,
        assessment_id="assessment-1",
        run_id="run-1",
        reservation_id="reservation-1",
        agent_role="planner",
        recovery_store_path=str(tmp_path / "billing.sqlite3"),
    )

    import pytest

    with pytest.raises(RuntimeError):
        session.release()
    client.fail_release = False
    assert drain(session.recovery_store_path, client) == 1
    assert client.release_ids == ["reservation-1"]
    assert drain(session.recovery_store_path, client) == 0


def test_input_ceiling_fails_before_provider_handler():
    session = BillingMeteringSession(
        api_client=FakeClient(),
        assessment_id="assessment-1",
        run_id="run-1",
        reservation_id="reservation-1",
        agent_role="planner",
        max_input_bytes=1,
        max_output_tokens=1,
        max_reasoning_tokens=0,
    )
    request = SimpleNamespace(messages=[{"role": "user", "content": "too long"}])
    called = False

    def provider_handler(_request):
        nonlocal called
        called = True
        return response()

    import pytest

    with activate_billing_metering(session), pytest.raises(BillingUsageUnavailable):
        BillingMeteringMiddleware().wrap_model_call(request, provider_handler)
    assert called is False


def test_priced_token_ceiling_is_enforced_before_provider_handler():
    session = BillingMeteringSession(
        api_client=FakeClient(),
        assessment_id="assessment-1",
        run_id="run-1",
        reservation_id="reservation-1",
        agent_role="planner",
        max_input_tokens=4,
        max_input_bytes=16_384,
    )
    request = SimpleNamespace(messages=[{"role": "user", "content": "12345"}])
    called = False

    def provider_handler(_request):
        nonlocal called
        called = True
        return response()

    import pytest

    with activate_billing_metering(session), pytest.raises(BillingUsageUnavailable):
        BillingMeteringMiddleware().wrap_model_call(request, provider_handler)
    assert called is False
