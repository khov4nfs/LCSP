import json
import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from conftest import use_model_routes
from langchain.agents.middleware import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_openai import ChatOpenAI

from middleware.failure_policy import (
    TerminalCredentialError,
    is_provider_route_incompatibility,
)
from middleware.provider_fallback import (
    ProviderFallbackMiddleware,
    provider_circuit_breaker_failure,
    provider_fallback_failure,
    route_key,
)
from middleware.usage_metering import (
    AgentRunState,
    UsageMeteringMiddleware,
    activate_agent_run_state,
)
from middleware.token_fallback import TokenFallbackMiddleware, model_provider
from provider_credentials import credential_init_kwargs


ALPHA, GAMMA, FUTURE, DELTA = "model-alpha", "model-gamma", "future-model-v99", "model-delta"
MODEL_FOR = {"openai": ALPHA, "llm7": GAMMA, "google_genai": FUTURE, "inception": DELTA}


def _routes(monkeypatch, primary: str, *fallbacks: str) -> None:
    """Configure the model routes file: ``primary`` bound as default, ``fallbacks`` its ordered chain."""
    chain = (primary, *fallbacks)
    use_model_routes(
        monkeypatch,
        (
            {
                "routes": {
                    f"r{i}": {"provider": provider, "model": MODEL_FOR[provider]}
                    for i, provider in enumerate(chain)
                },
                "roles": {"default": "r0"},
                "fallbacks": {"r0": [f"r{i}" for i in range(1, len(chain))]},
            }
        ),
    )


class QuotaError(Exception):
    status_code = 429


class CapacityError(Exception):
    status_code = 402
    code = "insufficient_balance"


class AuthError(Exception):
    status_code = 401


class UpstreamUnprocessableError(Exception):
    status_code = 422
    code = "upstream_unprocessable_request"
    type = "upstream_unprocessable_request"
    body = {
        "error": {
            "code": "upstream_unprocessable_request",
            "type": "upstream_unprocessable_request",
        }
    }


class LocalValidationError(Exception):
    status_code = 422
    code = "VALIDATION_FAILED"


@pytest.fixture(autouse=True)
def clear_provider_fallback_env(monkeypatch):
    _routes(monkeypatch, "openai")
    for key in ("OPENAI_API_KEY", "LLM7_API_KEY", "GOOGLE_API_KEY", "INCEPTION_API_KEY"):
        monkeypatch.setenv(key, "offline-test-key")
    from middleware import token_fallback

    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    token_fallback._RATE_LIMITED_UNTIL.clear()
    # A pool whose every slot is rate limited waits once for a cooldown; advance a
    # fake clock instead of sleeping for the production 30-120s.
    clock = {"now": 1_000.0}

    def sleep(seconds: float) -> None:
        clock["now"] += seconds

    async def asleep(seconds: float) -> None:
        clock["now"] += seconds

    monkeypatch.setattr(token_fallback, "_monotonic", lambda: clock["now"])
    monkeypatch.setattr(token_fallback, "_sleep", sleep)
    monkeypatch.setattr(token_fallback, "_asleep", asleep)
    yield
    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    token_fallback._RATE_LIMITED_UNTIL.clear()


def _openai_model():
    return ChatOpenAI(
        model=ALPHA,
        use_responses_api=True,
        **credential_init_kwargs("openai"),
    )


def _llm7_model():
    return ChatOpenAI(
        model=GAMMA,
        base_url="https://api.llm7.io/v1",
        use_responses_api=False,
        **credential_init_kwargs("llm7"),
    )


class _FakeModel:
    def __init__(self, provider: str, model_name: str | None = None):
        self.provider = provider
        self.model_name = model_name or MODEL_FOR[provider]


class _FakeRequest:
    def __init__(self, model, *, messages=None, tools=None):
        self.model = model
        self.messages = list(messages or [])
        self.tools = list(tools or [])

    def override(self, **kwargs):
        return _FakeRequest(
            kwargs.get("model", self.model),
            messages=self.messages,
            tools=self.tools,
        )


def _sync_chain(request, raw_handler):
    token_fallback = TokenFallbackMiddleware()
    return ProviderFallbackMiddleware().wrap_model_call(
        request,
        lambda next_request: token_fallback.wrap_model_call(next_request, raw_handler),
    )


async def _async_chain(request, raw_handler):
    token_fallback = TokenFallbackMiddleware()

    async def token_handler(next_request):
        return await token_fallback.awrap_model_call(next_request, raw_handler)

    return await ProviderFallbackMiddleware().awrap_model_call(request, token_handler)


def _usage_response() -> ModelResponse:
    return ModelResponse(
        result=[
            AIMessage(
                content="ok",
                usage_metadata={"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
            )
        ]
    )


def test_usage_delivery_failure_neither_fails_the_call_nor_enters_provider_fallback(
    monkeypatch, tmp_path
):
    import middleware.provider_fallback as fallback_module

    monkeypatch.setenv("USAGE_RECOVERY_STORE_PATH", str(tmp_path / "usage.sqlite3"))
    _routes(monkeypatch, "openai", "llm7")
    monkeypatch.setattr(
        fallback_module, "fallback_model", lambda config: _FakeModel(config.provider, config.model)
    )
    state = AgentRunState(
        api_client=type(
            "FailingUsageClient",
            (),
            {"post_settled_usage": lambda self, _payload: (_ for _ in ()).throw(RuntimeError("api-down"))},
        )(),
        assessment_id="assessment-1",
        run_id="run-1",
        agent_role="planner",
    )
    provider_calls = []

    def provider_handler(_request):
        provider_calls.append(1)
        return _usage_response()

    request = _FakeRequest(_FakeModel("openai"))
    metering = UsageMeteringMiddleware()
    with activate_agent_run_state(state):
        response = ProviderFallbackMiddleware().wrap_model_call(
            request,
            lambda next_request: metering.wrap_model_call(next_request, provider_handler),
        )
    assert isinstance(response, ModelResponse)
    assert len(provider_calls) == 1


def test_llm7_402_fallback_reports_usage_of_the_answering_route_only(monkeypatch):
    import middleware.provider_fallback as fallback_module

    _routes(monkeypatch, "llm7", "google_genai")
    monkeypatch.setattr(
        fallback_module,
        "fallback_model",
        lambda config: _FakeModel(config.provider, config.model),
    )

    payloads = []
    class UsageClient:
        def post_settled_usage(self, payload):
            payloads.append(payload)

    session = AgentRunState(
        api_client=UsageClient(),
        assessment_id="assessment-1",
        run_id="run-1",
        agent_role="planner",
    )
    provider_calls = []

    def provider_handler(request):
        provider_calls.append(request.model.provider)
        if request.model.provider == "llm7":
            raise CapacityError("insufficient balance")
        return _usage_response()

    request = _FakeRequest(_FakeModel("llm7"))
    billing = UsageMeteringMiddleware()
    with activate_agent_run_state(session):
        response = ProviderFallbackMiddleware().wrap_model_call(
            request,
            lambda next_request: billing.wrap_model_call(
                next_request,
                provider_handler,
            ),
        )

    assert isinstance(response, ModelResponse)
    assert provider_calls == ["llm7", "google_genai"]
    # Only the provider-answered attempt reports usage; the failed attempt has none.
    assert [payload.provider for payload in payloads] == ["GOOGLE_GENAI"]
    assert payloads[0].inputTokens == "3"
    assert payloads[0].outputTokens == "2"


def test_llm7_402_opens_run_scoped_circuit_and_skips_next_primary(monkeypatch):
    import middleware.provider_fallback as fallback_module

    stream_events = []
    import middleware.usage_metering as billing_module

    monkeypatch.setattr(
        billing_module,
        "publish_agent_stream_event",
        lambda event_type, **fields: stream_events.append((event_type, fields)),
    )
    _routes(monkeypatch, "llm7", "google_genai")
    monkeypatch.setattr(
        fallback_module,
        "fallback_model",
        lambda config: _FakeModel(config.provider, config.model),
    )

    class UsageClient:
        def __init__(self):
            self.payloads = []

        def post_settled_usage(self, payload):
            self.payloads.append(payload)

    client = UsageClient()
    session = AgentRunState(
        api_client=client,
        assessment_id="assessment-circuit",
        run_id="run-circuit",
        agent_role="investigator",
    )
    provider_calls = []

    def provider_handler(request):
        provider_calls.append(request.model.provider)
        if request.model.provider == "llm7":
            raise CapacityError("insufficient balance")
        return _usage_response()

    request = _FakeRequest(_FakeModel("llm7"))
    fallback = ProviderFallbackMiddleware()
    billing = UsageMeteringMiddleware()

    with activate_agent_run_state(session):
        for _ in range(2):
            assert isinstance(
                fallback.wrap_model_call(
                    request,
                    lambda next_request: billing.wrap_model_call(
                        next_request,
                        provider_handler,
                    ),
                ),
                ModelResponse,
            )

    assert provider_calls == ["llm7", "google_genai", "google_genai"]
    assert session.provider_route_disabled(route_key("llm7", MODEL_FOR["llm7"])) is True
    assert [payload.provider for payload in client.payloads] == [
        "GOOGLE_GENAI",
        "GOOGLE_GENAI",
    ]
    # Routing transitions are infrastructure, never assessment events.
    assert not {"PROVIDER_FALLBACK", "CREDENTIAL_ROTATION"} & {
        event_type for event_type, _ in stream_events
    }


def test_llm7_upstream_unprocessable_fallback_preserves_tool_continuation_and_opens_circuit(monkeypatch):
    import middleware.provider_fallback as fallback_module

    stream_events = []
    import middleware.usage_metering as billing_module

    monkeypatch.setattr(
        billing_module,
        "publish_agent_stream_event",
        lambda event_type, **fields: stream_events.append((event_type, fields)),
    )
    _routes(monkeypatch, "llm7", "google_genai")
    monkeypatch.setattr(
        fallback_module,
        "fallback_model",
        lambda config: _FakeModel(config.provider, config.model),
    )

    class UsageClient:
        def __init__(self):
            self.payloads = []

        def post_settled_usage(self, payload):
            self.payloads.append(payload)

    client = UsageClient()
    session = AgentRunState(
        api_client=client,
        assessment_id="assessment-tools",
        run_id="run-tools",
        agent_role="investigator",
    )
    messages = [
        HumanMessage(content="inspect the repository"),
        AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "ls",
                    "args": {"path": "/workspace/repository"},
                    "id": "call_repository_ls",
                }
            ],
        ),
        ToolMessage(
            content='{"entries":["src"]}',
            tool_call_id="call_repository_ls",
            name="ls",
        ),
    ]
    request = _FakeRequest(
        _FakeModel("llm7"),
        messages=messages,
    )
    provider_calls = []

    def provider_handler(next_request):
        provider_calls.append((next_request.model.provider, next_request.messages))
        if next_request.model.provider == "llm7":
            raise UpstreamUnprocessableError("upstream provider could not process the request")
        return ModelResponse(
            result=[],
            structured_response={
                "summary": "Gemini completed the same repository conversation"
            },
        )

    fallback = ProviderFallbackMiddleware()
    billing = UsageMeteringMiddleware()

    with activate_agent_run_state(session):
        first_response = fallback.wrap_model_call(
            request,
            lambda next_request: billing.wrap_model_call(
                next_request,
                provider_handler,
            ),
        )
        assert isinstance(first_response, ModelResponse)
        assert first_response.structured_response == {
            "summary": "Gemini completed the same repository conversation"
        }
        second_response = fallback.wrap_model_call(
            request,
            lambda next_request: billing.wrap_model_call(
                next_request,
                provider_handler,
            ),
        )
        assert isinstance(second_response, ModelResponse)

    assert provider_calls == [
        ("llm7", messages),
        ("google_genai", messages),
        ("google_genai", messages),
    ]
    assert session.provider_route_disabled(route_key("llm7", MODEL_FOR["llm7"])) is True
    # No provider-reported usage on these responses: nothing is posted, no zeros invented.
    assert client.payloads == []
    # Routing transitions are infrastructure, never assessment events.
    assert not {"PROVIDER_FALLBACK", "CREDENTIAL_ROTATION"} & {
        event_type for event_type, _ in stream_events
    }


def test_provider_route_incompatibility_is_fallback_before_generic_422_terminal():
    error = UpstreamUnprocessableError("upstream provider could not process the request")

    assert is_provider_route_incompatibility(error)
    assert provider_fallback_failure(error)
    assert provider_circuit_breaker_failure(error)


def test_local_validation_422_remains_terminal_without_provider_fallback():
    error = LocalValidationError("callback payload invalid")

    assert not is_provider_route_incompatibility(error)
    assert not provider_fallback_failure(error)
    assert not provider_circuit_breaker_failure(error)


def test_fallback_route_requires_its_own_credentials(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.delenv("LLM7_API_KEY", raising=False)
    _routes(monkeypatch, "openai", "llm7")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])

    with pytest.raises(RuntimeError, match="requires LLM7_API_KEY"):
        ProviderFallbackMiddleware().wrap_model_call(request, lambda _r: ModelResponse(result=[]))


def test_primary_key_pool_exhausts_before_llm7_pool(monkeypatch):
    _routes(monkeypatch, "openai", "llm7")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-a,llm7-b")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(
        side_effect=[QuotaError(), QuotaError(), QuotaError(), QuotaError(), response]
    )

    assert _sync_chain(request, raw_handler) is response
    assert raw_handler.call_count == 5
    requests = [call.args[0] for call in raw_handler.call_args_list]
    assert [model_provider(item.model) for item in requests] == [
        "openai",
        "openai",
        "llm7",
        "llm7",
        "llm7",
    ]
    # The OpenAI pool hands over to llm7 instead of waiting out its cooldown; only
    # the last route (llm7) waits once and retries its soonest slot.
    assert [
        item.model.openai_api_key.get_secret_value()
        for item in requests
    ] == ["openai-a", "openai-b", "llm7-a", "llm7-b", "llm7-a"]
    llm7_model = requests[-1].model
    assert str(llm7_model.openai_api_base).rstrip("/") == "https://api.llm7.io/v1"
    assert llm7_model.use_responses_api is False


def test_single_primary_auth_failure_moves_to_llm7(monkeypatch):
    _routes(monkeypatch, "openai", "llm7")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-only")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(side_effect=[AuthError(), response])

    assert _sync_chain(request, raw_handler) is response
    assert [model_provider(call.args[0].model) for call in raw_handler.call_args_list] == [
        "openai",
        "llm7",
    ]


def test_llm7_capacity_failure_rotates_keys_then_moves_to_google(monkeypatch):
    _routes(monkeypatch, "llm7", "google_genai")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-a,llm7-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-only")
    request = ModelRequest(model=_llm7_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(
        side_effect=[
            CapacityError("insufficient balance"),
            CapacityError("insufficient balance"),
            response,
        ]
    )

    assert _sync_chain(request, raw_handler) is response
    requests = [call.args[0] for call in raw_handler.call_args_list]
    assert [model_provider(item.model) for item in requests] == [
        "llm7",
        "llm7",
        "google_genai",
    ]
    assert [
        item.model.openai_api_key.get_secret_value()
        for item in requests[:2]
    ] == ["llm7-a", "llm7-b"]
    assert requests[-1].model.google_api_key.get_secret_value() == "google-only"


@pytest.mark.asyncio
async def test_async_provider_fallback_keeps_llm7_key_rotation(monkeypatch):
    _routes(monkeypatch, "openai", "llm7")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-a,llm7-b")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = AsyncMock(side_effect=[QuotaError(), QuotaError(), response])

    assert await _async_chain(request, raw_handler) is response
    requests = [call.args[0] for call in raw_handler.call_args_list]
    assert [model_provider(item.model) for item in requests] == [
        "openai",
        "llm7",
        "llm7",
    ]
    assert requests[-1].model.openai_api_key.get_secret_value() == "llm7-b"


def test_chain_advances_openai_then_google_then_llm7(monkeypatch):
    _routes(monkeypatch, "openai", "google_genai", "llm7")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-a,google-b")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-only")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(side_effect=[QuotaError()] * 4 + [response])

    assert _sync_chain(request, raw_handler) is response
    # Rate-limited pools with a later route hand over without a cooldown retry.
    assert [model_provider(call.args[0].model) for call in raw_handler.call_args_list] == [
        "openai",
        "openai",
        "google_genai",
        "google_genai",
        "llm7",
    ]


def test_schema_request_failure_does_not_cross_provider(monkeypatch):
    _routes(monkeypatch, "openai", "llm7")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-only")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    raw_handler = MagicMock(side_effect=TypeError("bad structured request"))

    with pytest.raises(TypeError, match="bad structured request"):
        _sync_chain(request, raw_handler)
    assert raw_handler.call_count == 1


def test_all_provider_pools_exhaust_to_terminal_error(monkeypatch):
    _routes(monkeypatch, "openai", "llm7")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-a,llm7-b")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    raw_handler = MagicMock(side_effect=QuotaError())

    with pytest.raises(TerminalCredentialError, match="provider routes exhausted"):
        _sync_chain(request, raw_handler)
    # The OpenAI pool tries both slots and hands over; the last (llm7) pool tries
    # both slots, waits once, and retries the soonest slot. Every failure was a
    # plain rate limit, so the primary OpenAI pool then gets one waited retry of
    # its own (bounded) before the task ends.
    assert raw_handler.call_count == 8


def test_current_provider_is_not_reentered_from_fallback_chain(monkeypatch):
    _routes(monkeypatch, "openai", "openai", "llm7")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-only")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(side_effect=[QuotaError(), response])

    assert _sync_chain(request, raw_handler) is response
    assert [model_provider(call.args[0].model) for call in raw_handler.call_args_list] == [
        "openai",
        "llm7",
    ]


def test_structured_output_rejection_is_provider_scoped_not_retried():
    from middleware.failure_policy import (
        StructuredOutputRejected,
        TerminalSchemaError,
        is_terminal_task_error,
        retry_model_error,
    )

    rejected = StructuredOutputRejected("Structured output schema validation failed")
    assert is_terminal_task_error(rejected) is True
    assert retry_model_error(rejected) is False
    assert provider_fallback_failure(rejected) is True
    assert provider_circuit_breaker_failure(rejected) is True
    # Other schema/request failures stay terminal without switching providers.
    generic = TerminalSchemaError("Tool argument schema validation failed")
    assert provider_fallback_failure(generic) is False
    assert provider_circuit_breaker_failure(generic) is False


def _rejection_session(monkeypatch, routes=("google_genai",)):
    import middleware.provider_fallback as fallback_module

    _routes(monkeypatch, "llm7", *routes)
    monkeypatch.setattr(fallback_module, "fallback_model", lambda config: _FakeModel(config.provider, config.model))

    class UsageClient:

        def post_settled_usage(self, payload):
            pass

    return AgentRunState(
        api_client=UsageClient(),
        assessment_id="assessment-rejection",
        run_id="run-rejection",
        agent_role="investigator",
    )


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_llm7_output_rejection_falls_back_and_opens_circuit(monkeypatch, asynchronous):
    # Regression: scan 581af151 — codestral (LLM7) returned an invalid
    # RepositoryAnalysisResult; the rejection killed the scan although Gemini was configured.
    from middleware.failure_policy import StructuredOutputRejected

    session = _rejection_session(monkeypatch)
    calls = []

    def provider_handler(request):
        calls.append(request.model.provider)
        if request.model.provider == "llm7":
            raise StructuredOutputRejected("Structured output schema validation failed")
        return ModelResponse(result=[])

    async def async_handler(request):
        return provider_handler(request)

    fallback = ProviderFallbackMiddleware()
    request = _FakeRequest(_FakeModel("llm7"))
    with activate_agent_run_state(session):
        for _ in range(2):
            if asynchronous:
                result = await fallback.awrap_model_call(request, async_handler)
            else:
                result = fallback.wrap_model_call(request, provider_handler)
            assert isinstance(result, ModelResponse)

    assert calls == ["llm7", "google_genai", "google_genai"]
    assert session.provider_route_disabled(route_key("llm7", MODEL_FOR["llm7"])) is True


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_output_rejected_by_every_route_reraises_the_schema_error(monkeypatch, asynchronous):
    from middleware.failure_policy import StructuredOutputRejected

    session = _rejection_session(monkeypatch)

    def reject(request):
        raise StructuredOutputRejected(f"{request.model.provider} rejected")

    async def async_reject(request):
        return reject(request)

    fallback = ProviderFallbackMiddleware()
    request = _FakeRequest(_FakeModel("llm7"))
    with activate_agent_run_state(session):
        with pytest.raises(StructuredOutputRejected, match="llm7 rejected"):
            if asynchronous:
                await fallback.awrap_model_call(request, async_reject)
            else:
                fallback.wrap_model_call(request, reject)


def test_rate_limited_llm7_pool_moves_to_google_without_cooldown_wait(monkeypatch):
    _routes(monkeypatch, "llm7", "google_genai")
    from middleware import token_fallback

    sleeps: list[float] = []
    monkeypatch.setattr(token_fallback, "_sleep", sleeps.append)
    monkeypatch.setenv("LLM7_API_KEY", "llm7-a,llm7-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-a,google-b")
    request = ModelRequest(model=_llm7_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(side_effect=[QuotaError(), QuotaError(), response])

    assert _sync_chain(request, raw_handler) is response
    requests = [call.args[0] for call in raw_handler.call_args_list]
    assert [model_provider(item.model) for item in requests] == [
        "llm7",
        "llm7",
        "google_genai",
    ]
    assert sleeps == []


def test_last_provider_route_still_waits_for_its_cooldown(monkeypatch):
    _routes(monkeypatch, "llm7", "google_genai")
    from middleware import token_fallback

    sleeps: list[float] = []
    monkeypatch.setattr(token_fallback, "_sleep", sleeps.append)
    monkeypatch.setenv("LLM7_API_KEY", "llm7-a,llm7-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-a,google-b")
    request = ModelRequest(model=_llm7_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(
        side_effect=[QuotaError(), QuotaError(), QuotaError(), QuotaError(), response]
    )

    assert _sync_chain(request, raw_handler) is response
    requests = [call.args[0] for call in raw_handler.call_args_list]
    assert [model_provider(item.model) for item in requests] == [
        "llm7",
        "llm7",
        "google_genai",
        "google_genai",
        "google_genai",
    ]
    assert len(sleeps) == 1


def test_llm7_text_only_structured_answer_falls_back_to_google(monkeypatch):
    _routes(monkeypatch, "openai", "google_genai")
    from langchain.agents.structured_output import ToolStrategy
    from pydantic import BaseModel
    from middleware.model_governance import StopSchemaRepairMiddleware

    class Answer(BaseModel):
        count: int

    monkeypatch.setenv("LLM7_API_KEY", "llm7-a,llm7-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-a")
    request = ModelRequest(
        model=_llm7_model(), messages=[], tools=[], response_format=ToolStrategy(Answer),
    )
    structured = ModelResponse(result=[AIMessage(content="")], structured_response=Answer(count=2))
    raw_handler = MagicMock(side_effect=[
        ModelResponse(result=[AIMessage(content="I think the answer is two.")]),
        structured,
    ])
    stop_schema_repair = StopSchemaRepairMiddleware()
    token_fallback = TokenFallbackMiddleware()

    response = ProviderFallbackMiddleware().wrap_model_call(
        request,
        lambda provider_request: token_fallback.wrap_model_call(
            provider_request,
            lambda slot_request: stop_schema_repair.wrap_model_call(slot_request, raw_handler),
        ),
    )

    assert response is structured
    # The contract violation is provider-specific: no llm7 key rotation, straight to Google.
    assert [model_provider(call.args[0].model) for call in raw_handler.call_args_list] == [
        "llm7",
        "google_genai",
    ]


class _StatusError(RuntimeError):
    def __init__(self, status_code: int, code: str | None = None):
        super().__init__(f"status {status_code}")
        self.status_code = status_code
        if code:
            self.error_code = code


class _RouteRequest:
    def __init__(self, provider: str):
        self.model = type("M", (), {"provider": provider, "model_name": MODEL_FOR[provider]})()

    def override(self, *, model):
        request = _RouteRequest(model.provider)
        return request


def _rate_limited_primary(code: str | None = None) -> BaseException:
    from middleware.failure_policy import TerminalCredentialError

    try:
        raise _StatusError(429, code)
    except _StatusError as cause:
        try:
            raise TerminalCredentialError("slots cooling") from cause
        except TerminalCredentialError as error:
            return error


def _install_routes(monkeypatch):
    import middleware.provider_fallback as fallback_module

    _routes(monkeypatch, "llm7", "google_genai")
    monkeypatch.setattr(
        fallback_module,
        "fallback_model",
        lambda config: type("M", (), {"provider": config.provider, "model_name": config.model})(),
    )
    monkeypatch.setattr(fallback_module, "_provider_route_disabled", lambda _p: False)
    monkeypatch.setattr(fallback_module, "_trip_provider_circuit", lambda *_a: None)


def test_rate_limited_primary_waits_out_its_cooldown_instead_of_ending_the_task(monkeypatch):
    from middleware.token_fallback import _FURTHER_PROVIDER_ROUTE

    _install_routes(monkeypatch)
    calls: list[tuple[str, bool]] = []

    def handler(request):
        calls.append((request.model.provider, _FURTHER_PROVIDER_ROUTE.get()))
        if len(calls) == 1:
            raise _rate_limited_primary()
        if len(calls) == 2:
            raise _StatusError(503)
        return ModelResponse(result=[])

    result = ProviderFallbackMiddleware().wrap_model_call(_RouteRequest("llm7"), handler)

    assert isinstance(result, ModelResponse)
    # llm7 deferred (a later route existed), Google failed, then llm7 again with
    # no later route: token fallback now waits for the cooldown and retries.
    assert calls == [("llm7", True), ("google_genai", False), ("llm7", False)]


def test_an_exhausted_quota_is_not_waited_on(monkeypatch):
    from middleware.failure_policy import TerminalCredentialError

    _install_routes(monkeypatch)
    calls: list[str] = []

    def handler(request):
        calls.append(request.model.provider)
        if len(calls) == 1:
            raise _rate_limited_primary("insufficient_quota")
        raise _StatusError(503)

    with pytest.raises(TerminalCredentialError):
        ProviderFallbackMiddleware().wrap_model_call(_RouteRequest("llm7"), handler)
    assert calls == ["llm7", "google_genai"]


def _run_session(run_id: str, **kwargs) -> AgentRunState:
    class _Client:

        def post_settled_usage(self, payload):
            pass

    return AgentRunState(
        api_client=_Client(),
        assessment_id="assessment-sticky",
        run_id=run_id,
        agent_role="repository_analyst",
        **kwargs,
    )


def _sticky_env(monkeypatch):
    _routes(monkeypatch, "openai", "llm7")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-only")


def _providers(handler):
    return [model_provider(call.args[0].model) for call in handler.call_args_list]


def test_fallback_is_sticky_for_later_turns_even_after_cooldown_expires(monkeypatch):
    from middleware import token_fallback

    _sticky_env(monkeypatch)
    session = _run_session("run-sticky")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    handler = MagicMock(side_effect=[QuotaError(), QuotaError(), response, response, response])

    with activate_agent_run_state(session):
        assert _sync_chain(request, handler) is response
        # Past the maximum credential cooldown: the primary slots are eligible again.
        clock_now = token_fallback._monotonic()
        monkeypatch.setattr(token_fallback, "_monotonic", lambda: clock_now + 10_000)
        assert _sync_chain(request, handler) is response
        assert _sync_chain(request, handler) is response

    assert _providers(handler) == ["openai", "openai", "llm7", "llm7", "llm7"]
    assert session.provider_route_disabled(route_key("openai", MODEL_FOR["openai"])) is True


def test_new_run_reconsiders_primary(monkeypatch):
    _sticky_env(monkeypatch)
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    first = MagicMock(side_effect=[QuotaError(), QuotaError(), response])
    with activate_agent_run_state(_run_session("run-one")):
        _sync_chain(request, first)

    from middleware import token_fallback

    token_fallback._RATE_LIMITED_UNTIL.clear()
    second = MagicMock(return_value=response)
    session = _run_session("run-two")
    with activate_agent_run_state(session):
        _sync_chain(request, second)

    assert _providers(second) == ["openai"]
    assert session.provider_route_disabled(route_key("openai", MODEL_FOR["openai"])) is False


def test_auth_failure_semantics_unchanged_with_sticky_fallback(monkeypatch):
    _routes(monkeypatch, "openai", "llm7")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-only")
    from middleware import token_fallback

    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    handler = MagicMock(side_effect=[AuthError(), AuthError(), response])
    with activate_agent_run_state(_run_session("run-auth")):
        assert _sync_chain(request, handler) is response
    # 401 still marks slots dead for the process and opens the run circuit.
    assert token_fallback._DEAD_CREDENTIAL_SLOTS[("openai", "OPENAI_API_KEY")] == {0, 1}
    assert _providers(handler) == ["openai", "openai", "llm7"]


def test_sticky_fallback_failure_stays_bounded(monkeypatch):
    _sticky_env(monkeypatch)
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    session = _run_session("run-bounded")
    handler = MagicMock(side_effect=[QuotaError(), QuotaError(), response])
    with activate_agent_run_state(session):
        _sync_chain(request, handler)
        failing = MagicMock(side_effect=QuotaError())
        with pytest.raises(TerminalCredentialError, match="provider routes exhausted"):
            _sync_chain(request, failing)
    # Fallback pool makes its own bounded attempts, then the sticky-skipped primary
    # gets one last-resort retry (its transient failure is not a permanent circuit).
    assert set(_providers(failing)) == {"llm7", "openai"}
    assert failing.call_count <= 3


def test_sticky_fallback_reports_usage_per_answered_attempt_without_extra_logical_turns(monkeypatch):
    import middleware.provider_fallback as fallback_module

    _routes(monkeypatch, "openai", "llm7")
    monkeypatch.setattr(fallback_module, "fallback_model", lambda config: _FakeModel(config.provider, config.model))

    class Client:
        def __init__(self):
            self.payloads = []

        def post_settled_usage(self, payload):
            self.payloads.append(payload)

    client = Client()
    session = AgentRunState(
        api_client=client,
        assessment_id="a",
        run_id="run-bill",
        agent_role="repository_analyst",
    )
    calls = []

    def provider_handler(request):
        calls.append(request.model.provider)
        if request.model.provider == "openai":
            raise QuotaError()
        return _usage_response()

    billing = UsageMeteringMiddleware()
    fallback = ProviderFallbackMiddleware()
    with activate_agent_run_state(session):
        for _ in range(2):
            fallback.wrap_model_call(
                _FakeRequest(_FakeModel("openai")),
                lambda r: billing.wrap_model_call(r, provider_handler),
            )

    # Turn 1: failed primary attempt + fallback success; turn 2: fallback only.
    assert calls == ["openai", "llm7", "llm7"]
    # Only the answering route reports usage; the failed primary attempt reports none.
    assert [p.provider for p in client.payloads] == ["LLM7", "LLM7"]
    assert len({p.invocationId for p in client.payloads}) == 2


def _raw_routes(monkeypatch, routes: dict, chain: list[str]) -> None:
    use_model_routes(
        monkeypatch,
        (
            {
                "routes": routes,
                "roles": {"default": "primary"},
                "fallbacks": {"primary": chain},
            }
        ),
    )


def test_fallback_model_is_built_from_the_configured_route(monkeypatch):
    import middleware.provider_fallback as fallback_module
    import model_policy

    _raw_routes(
        monkeypatch,
        {
            "primary": {"provider": "openai", "model": ALPHA},
            "backup": {"provider": "llm7", "model": "model-omega-7", "options": {"temperature": 0.25}},
        },
        ["backup"],
    )
    (config,) = model_policy.fallback_routes("primary")

    model = fallback_module.fallback_model(config)

    assert model_provider(model) == "llm7"
    assert model.model_name == "model-omega-7"
    assert model.temperature == 0.25


def test_same_provider_different_model_route_is_a_distinct_fallback(monkeypatch):
    import middleware.provider_fallback as fallback_module

    _raw_routes(
        monkeypatch,
        {
            "primary": {"provider": "openai", "model": ALPHA},
            "backup": {"provider": "openai", "model": "model-beta"},
        },
        ["backup"],
    )
    monkeypatch.setattr(
        fallback_module,
        "fallback_model",
        lambda config: _FakeModel(config.provider, config.model),
    )
    session = _run_session("route-identity")
    seen = []

    def handler(request):
        seen.append((request.model.provider, request.model.model_name))
        if request.model.model_name == ALPHA:
            raise AuthError("revoked")
        return ModelResponse(result=[])

    fallback = ProviderFallbackMiddleware()
    with activate_agent_run_state(session):
        fallback.wrap_model_call(_FakeRequest(_FakeModel("openai", ALPHA)), handler)
        fallback.wrap_model_call(_FakeRequest(_FakeModel("openai", ALPHA)), handler)

    # The permanently failed route stays closed for the run; its sibling model is untouched.
    assert seen == [("openai", ALPHA), ("openai", "model-beta"), ("openai", "model-beta")]
    assert session.provider_route_disabled(route_key("openai", ALPHA)) is True
    assert session.provider_route_disabled(route_key("openai", "model-beta")) is False
