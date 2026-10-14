import json
import os
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from anthropic import RateLimitError
from conftest import use_model_routes
from langchain.agents.middleware import ModelRequest, ModelResponse
from langchain_anthropic import ChatAnthropic
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
from middleware.token_fallback import TokenFallbackMiddleware, model_provider
from middleware.usage_metering import (
    AgentRunState,
    UsageMeteringMiddleware,
    activate_agent_run_state,
)
from provider_credentials import credential_init_kwargs

@pytest.fixture(autouse=True)
def provider_pauses(monkeypatch):
    """Rate-limit backoff pauses are recorded, never slept."""
    import middleware.provider_fallback as fallback_module

    pauses: list[float] = []

    async def _apause(delay):
        pauses.append(delay)

    monkeypatch.setattr(fallback_module, "_sleep", pauses.append)
    monkeypatch.setattr(fallback_module, "_asleep", _apause)
    return pauses


ALPHA, GAMMA, FUTURE, DELTA = "model-alpha", "model-gamma", "future-model-v99", "model-delta"
MODEL_FOR = {"openai": ALPHA, "apx": GAMMA, "google_genai": FUTURE, "inception": DELTA}


def _routes(monkeypatch, primary: str, *fallbacks: str) -> None:
    """Configure the model routes file: ``primary`` bound as default, ``fallbacks`` its ordered chain."""
    chain = (primary, *fallbacks)
    use_model_routes(
        monkeypatch,
        (
            {
                "routes": {
                    f"r{i}": {
                        "provider": provider,
                        **({"protocol": "anthropic"} if provider == "apx" else {}),
                        "model": MODEL_FOR[provider],
                    }
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


class AllowanceExhaustedError(Exception):
    status_code = 429

    def __init__(self, protocol="openai"):
        super().__init__("monthly allowance used up")
        error = {
            "code": "allowance_exhausted",
            "message": "Your monthly allowance is used up.",
        }
        if protocol == "openai":
            self.body = {"error": {"type": "insufficient_quota", **error}}
        else:
            self.body = {"type": "error", "error": {"type": "rate_limit_error", **error}}


class ProAccessRequiredError(Exception):
    """apx's key-level answer when one pool key has no Pro access to the requested model."""

    status_code = 402
    code = "pro_access_required"


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
    for key in ("OPENAI_API_KEY", "APX_API_KEY", "GOOGLE_API_KEY", "INCEPTION_API_KEY"):
        monkeypatch.setenv(key, "offline-test-key")
    from middleware import token_fallback

    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    token_fallback._RATE_LIMITED_UNTIL.clear()
    token_fallback._CREDENTIAL_POOL_FINGERPRINTS.clear()
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
    token_fallback._CREDENTIAL_POOL_FINGERPRINTS.clear()


def _openai_model():
    return ChatOpenAI(
        model=ALPHA,
        use_responses_api=True,
        **credential_init_kwargs("openai"),
    )


def _apx_model():
    return ChatAnthropic(
        model="claude-sonnet-4-6-free",
        base_url="https://api.apmix.ai",
        **credential_init_kwargs("apx"),
    )


def _model_api_key(model) -> str:
    for name in ("openai_api_key", "anthropic_api_key", "google_api_key"):
        value = getattr(model, name, None)
        if value is not None:
            return value.get_secret_value()
    raise AssertionError("test model has no API-key field")


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
    _routes(monkeypatch, "openai", "apx")
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


def test_apx_402_fallback_reports_usage_of_the_answering_route_only(monkeypatch):
    import middleware.provider_fallback as fallback_module

    _routes(monkeypatch, "apx", "google_genai")
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
        if request.model.provider == "apx":
            raise CapacityError("insufficient balance")
        return _usage_response()

    request = _FakeRequest(_FakeModel("apx"))
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
    assert provider_calls == ["apx", "google_genai"]
    # Only the provider-answered attempt reports usage; the failed attempt has none.
    assert [payload.provider for payload in payloads] == ["GOOGLE_GENAI"]
    assert payloads[0].inputTokens == "3"
    assert payloads[0].outputTokens == "2"


def test_apx_402_opens_run_scoped_circuit_and_skips_next_primary(monkeypatch):
    import middleware.provider_fallback as fallback_module

    stream_events = []
    import middleware.usage_metering as billing_module

    monkeypatch.setattr(
        billing_module,
        "publish_agent_stream_event",
        lambda event_type, **fields: stream_events.append((event_type, fields)),
    )
    _routes(monkeypatch, "apx", "google_genai")
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
        if request.model.provider == "apx":
            raise CapacityError("insufficient balance")
        return _usage_response()

    request = _FakeRequest(_FakeModel("apx"))
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

    assert provider_calls == ["apx", "google_genai", "google_genai"]
    assert session.provider_route_disabled(route_key("apx", MODEL_FOR["apx"], "anthropic")) is True
    assert [payload.provider for payload in client.payloads] == [
        "GOOGLE_GENAI",
        "GOOGLE_GENAI",
    ]
    # Routing transitions are infrastructure, never assessment events.
    assert not {"PROVIDER_FALLBACK", "CREDENTIAL_ROTATION"} & {
        event_type for event_type, _ in stream_events
    }


def test_apx_upstream_unprocessable_fallback_preserves_tool_continuation_and_opens_circuit(monkeypatch):
    import middleware.provider_fallback as fallback_module

    stream_events = []
    import middleware.usage_metering as billing_module

    monkeypatch.setattr(
        billing_module,
        "publish_agent_stream_event",
        lambda event_type, **fields: stream_events.append((event_type, fields)),
    )
    _routes(monkeypatch, "apx", "google_genai")
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
        _FakeModel("apx"),
        messages=messages,
    )
    provider_calls = []

    def provider_handler(next_request):
        provider_calls.append((next_request.model.provider, next_request.messages))
        if next_request.model.provider == "apx":
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
        ("apx", messages),
        ("google_genai", messages),
        ("google_genai", messages),
    ]
    assert session.provider_route_disabled(route_key("apx", MODEL_FOR["apx"], "anthropic")) is True
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
    monkeypatch.delenv("APX_API_KEY", raising=False)
    _routes(monkeypatch, "openai", "apx")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])

    with pytest.raises(RuntimeError, match="requires APX_API_KEY"):
        ProviderFallbackMiddleware().wrap_model_call(request, lambda _r: ModelResponse(result=[]))


def test_primary_key_pool_exhausts_before_apx_pool(monkeypatch):
    _routes(monkeypatch, "openai", "apx")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("APX_API_KEY", "apx-a,apx-b")
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
        "apx",
        "apx",
        "apx",
    ]
    # The OpenAI pool hands over to apx instead of waiting out its cooldown; only
    # the last route (apx) waits once and retries its soonest slot.
    assert [_model_api_key(item.model) for item in requests] == [
        "openai-a", "openai-b", "apx-a", "apx-b", "apx-a"
    ]
    apx_model = requests[-1].model
    assert str(apx_model.anthropic_api_url).rstrip("/") == "https://api.apmix.ai"


def test_apx_allowance_exhaustion_rotates_every_slot_before_gemini_fallback(monkeypatch):
    import model_policy as mp

    monkeypatch.setenv("APX_API_KEY", "apx-slot-0,apx-slot-1")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "direct-anthropic-must-not-be-used")
    monkeypatch.setenv("GOOGLE_API_KEY", "gemini-only")
    monkeypatch.setenv("INCEPTION_API_KEY", "inception-later")
    use_model_routes(
        monkeypatch,
        {
            "routes": {
                "primary": {
                    "provider": "apx",
                    "protocol": "anthropic",
                    "model": "claude-sonnet-4-6-free",
                },
                "gemini": {"provider": "google_genai", "model": FUTURE},
                "inception": {"provider": "inception", "model": DELTA},
            },
            "roles": {"default": "primary"},
            "fallbacks": {"primary": ["gemini", "inception"]},
        },
    )
    request = ModelRequest(
        model=mp.build_model(mp.load_model_routes().config("primary")),
        messages=[],
        tools=[],
    )
    response = ModelResponse(result=[])
    observed = []

    def raw_handler(next_request):
        model = next_request.model
        observed.append((model_provider(model), _model_api_key(model)))
        if model_provider(model) == "apx":
            raise AllowanceExhaustedError("anthropic")
        return response

    assert _sync_chain(request, raw_handler) is response
    assert observed == [
        ("apx", "apx-slot-0"),
        ("apx", "apx-slot-1"),
        ("google_genai", "gemini-only"),
    ]
    from middleware import token_fallback

    assert token_fallback._DEAD_CREDENTIAL_SLOTS[("apx", "APX_API_KEY")] == {0, 1}


def test_single_primary_auth_failure_moves_to_apx(monkeypatch):
    _routes(monkeypatch, "openai", "apx")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("APX_API_KEY", "apx-only")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(side_effect=[AuthError(), response])

    assert _sync_chain(request, raw_handler) is response
    assert [model_provider(call.args[0].model) for call in raw_handler.call_args_list] == [
        "openai",
        "apx",
    ]


def test_apx_capacity_failure_rotates_keys_then_moves_to_google(monkeypatch):
    _routes(monkeypatch, "apx", "google_genai")
    monkeypatch.setenv("APX_API_KEY", "apx-a,apx-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-only")
    request = ModelRequest(model=_apx_model(), messages=[], tools=[])
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
        "apx",
        "apx",
        "google_genai",
    ]
    assert [_model_api_key(item.model) for item in requests[:2]] == ["apx-a", "apx-b"]
    assert requests[-1].model.google_api_key.get_secret_value() == "google-only"


@pytest.mark.parametrize(
    "message",
    ["monthly allowance has been used up", "insufficient_quota", "allowance_exhausted"],
)
def test_apx_pool_exhaustion_falls_through_gemini_then_inception(monkeypatch, message):
    _routes(monkeypatch, "apx", "google_genai", "inception")
    monkeypatch.setenv("APX_API_KEY", "apx-a,apx-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-a,google-b")
    monkeypatch.setenv("INCEPTION_API_KEY", "inception-only")
    request = ModelRequest(model=_apx_model(), messages=[], tools=[])
    response = ModelResponse(result=[])

    def apx_allowance_error():
        body = {
            "type": "error",
            "error": {
                "type": "rate_limit_error",
                "message": message,
            },
        }
        response = httpx.Response(
            429,
            request=httpx.Request("POST", "https://api.apmix.ai/v1/messages"),
            json=body,
        )
        return RateLimitError("rate limit", response=response, body=body)

    handler = MagicMock(
        side_effect=[
            apx_allowance_error(),
            apx_allowance_error(),
            AllowanceExhaustedError(),
            AllowanceExhaustedError(),
            response,
        ]
    )

    assert _sync_chain(request, handler) is response

    requests = [call.args[0] for call in handler.call_args_list]
    assert [model_provider(item.model) for item in requests] == [
        "apx",
        "apx",
        "google_genai",
        "google_genai",
        "inception",
    ]
    assert [_model_api_key(item.model) for item in requests] == [
        "apx-a",
        "apx-b",
        "google-a",
        "google-b",
        "inception-only",
    ]


def test_apx_pro_access_required_on_one_key_rotates_to_the_next_key_without_leaving_apx(monkeypatch):
    _routes(monkeypatch, "apx", "google_genai")
    monkeypatch.setenv("APX_API_KEY", "apx-a,apx-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-only")
    request = ModelRequest(model=_apx_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(
        side_effect=[
            ProAccessRequiredError("Pro models require balance or an active subscription."),
            response,
        ]
    )
    session = AgentRunState(
        api_client=object(), assessment_id="assessment-pro", run_id="run-pro", agent_role="investigator"
    )

    with activate_agent_run_state(session):
        assert _sync_chain(request, raw_handler) is response

    requests = [call.args[0] for call in raw_handler.call_args_list]
    # Slot 1 lacks Pro access; slot 2 of the SAME provider answers; no provider fallback.
    assert [model_provider(item.model) for item in requests] == ["apx", "apx"]
    assert [_model_api_key(item.model) for item in requests] == ["apx-a", "apx-b"]
    # One key's missing capability must not disable the whole apx route for the run.
    assert session.provider_route_disabled(route_key("apx", MODEL_FOR["apx"], "anthropic")) is False


@pytest.mark.asyncio
async def test_async_provider_fallback_keeps_apx_key_rotation(monkeypatch):
    _routes(monkeypatch, "openai", "apx")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("APX_API_KEY", "apx-a,apx-b")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = AsyncMock(side_effect=[QuotaError(), QuotaError(), response])

    assert await _async_chain(request, raw_handler) is response
    requests = [call.args[0] for call in raw_handler.call_args_list]
    assert [model_provider(item.model) for item in requests] == [
        "openai",
        "apx",
        "apx",
    ]
    assert _model_api_key(requests[-1].model) == "apx-b"


def test_chain_advances_openai_then_google_then_apx(monkeypatch):
    _routes(monkeypatch, "openai", "google_genai", "apx")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-a,google-b")
    monkeypatch.setenv("APX_API_KEY", "apx-only")
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
        "apx",
    ]


def test_schema_request_failure_does_not_cross_provider(monkeypatch):
    _routes(monkeypatch, "openai", "apx")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("APX_API_KEY", "apx-only")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    raw_handler = MagicMock(side_effect=TypeError("bad structured request"))

    with pytest.raises(TypeError, match="bad structured request"):
        _sync_chain(request, raw_handler)
    assert raw_handler.call_count == 1


def test_all_provider_pools_exhaust_to_terminal_error(monkeypatch, provider_pauses):
    _routes(monkeypatch, "openai", "apx")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("APX_API_KEY", "apx-a,apx-b")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    raw_handler = MagicMock(side_effect=QuotaError())

    with pytest.raises(TerminalCredentialError, match="provider routes exhausted"):
        _sync_chain(request, raw_handler)
    # Every failure was a plain rate limit, so both pools are waited on through the whole bounded
    # backoff (never forever) before the task ends.
    from middleware.provider_fallback import _RATE_LIMIT_BACKOFF_SECONDS

    assert provider_pauses == list(_RATE_LIMIT_BACKOFF_SECONDS)
    # 8 initial invocations, then every backoff round re-runs both rate-limited pools.
    assert raw_handler.call_count == 41


def test_current_provider_is_not_reentered_from_fallback_chain(monkeypatch):
    _routes(monkeypatch, "openai", "openai", "apx")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("APX_API_KEY", "apx-only")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(side_effect=[QuotaError(), response])

    assert _sync_chain(request, raw_handler) is response
    assert [model_provider(call.args[0].model) for call in raw_handler.call_args_list] == [
        "openai",
        "apx",
    ]


class _StreamedRefusal(Exception):
    """Mid-stream provider error event: a refusal message carrying a 400-like code."""

    def __init__(self, message="I'm sorry, but I can't help with that request."):
        super().__init__(message)
        self.code = 400


def test_a_provider_refusal_is_a_resample_not_a_rejected_request():
    from middleware.failure_policy import is_provider_refusal, is_terminal_task_error, retry_model_error

    refusal = _StreamedRefusal()
    assert is_provider_refusal(refusal) is True
    assert is_provider_refusal(_StreamedRefusal("I\u2019m sorry, but I can\u2019t help with that request.")) is True
    # Same shape, ordinary rejected request: stays terminal and is not retried.
    rejected = _StreamedRefusal("messages.0: field required")
    assert is_provider_refusal(rejected) is False
    assert is_terminal_task_error(rejected) is True and retry_model_error(rejected) is False
    # The refusal is neither terminal nor un-retryable, and another route may take it.
    assert is_terminal_task_error(refusal) is False
    assert retry_model_error(refusal) is True
    assert provider_fallback_failure(refusal) is True


def test_a_refusing_route_falls_back_to_the_next_route(monkeypatch):
    _install_routes(monkeypatch)
    calls: list[str] = []

    def handler(request):
        calls.append(request.model.provider)
        if request.model.provider == "apx":
            raise _StreamedRefusal()
        return ModelResponse(result=[])

    result = ProviderFallbackMiddleware().wrap_model_call(_RouteRequest("apx"), handler)

    assert isinstance(result, ModelResponse)
    assert calls == ["apx", "google_genai"]


def test_when_every_route_refuses_the_refusal_itself_surfaces_so_the_sample_is_retried(monkeypatch):
    from middleware.failure_policy import retry_model_error

    _install_routes(monkeypatch)

    def handler(request):
        raise _StreamedRefusal()

    with pytest.raises(_StreamedRefusal) as raised:
        ProviderFallbackMiddleware().wrap_model_call(_RouteRequest("apx"), handler)

    # Not the terminal "routes exhausted" error: model retry may resample the request.
    assert retry_model_error(raised.value) is True


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

    _routes(monkeypatch, "apx", *routes)
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
async def test_apx_output_rejection_falls_back_and_opens_circuit(monkeypatch, asynchronous):
    # Regression: scan 581af151 — codestral (APX) returned an invalid
    # RepositoryAnalysisResult; the rejection killed the scan although Gemini was configured.
    from middleware.failure_policy import StructuredOutputRejected

    session = _rejection_session(monkeypatch)
    calls = []

    def provider_handler(request):
        calls.append(request.model.provider)
        if request.model.provider == "apx":
            raise StructuredOutputRejected("Structured output schema validation failed")
        return ModelResponse(result=[])

    async def async_handler(request):
        return provider_handler(request)

    fallback = ProviderFallbackMiddleware()
    request = _FakeRequest(_FakeModel("apx"))
    with activate_agent_run_state(session):
        for _ in range(2):
            if asynchronous:
                result = await fallback.awrap_model_call(request, async_handler)
            else:
                result = fallback.wrap_model_call(request, provider_handler)
            assert isinstance(result, ModelResponse)

    assert calls == ["apx", "google_genai", "google_genai"]
    assert session.provider_route_disabled(route_key("apx", MODEL_FOR["apx"], "anthropic")) is True


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
    request = _FakeRequest(_FakeModel("apx"))
    with activate_agent_run_state(session):
        with pytest.raises(StructuredOutputRejected, match="apx rejected"):
            if asynchronous:
                await fallback.awrap_model_call(request, async_reject)
            else:
                fallback.wrap_model_call(request, reject)


def test_rate_limited_apx_pool_moves_to_google_without_cooldown_wait(monkeypatch):
    _routes(monkeypatch, "apx", "google_genai")
    from middleware import token_fallback

    sleeps: list[float] = []
    monkeypatch.setattr(token_fallback, "_sleep", sleeps.append)
    monkeypatch.setenv("APX_API_KEY", "apx-a,apx-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-a,google-b")
    request = ModelRequest(model=_apx_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(side_effect=[QuotaError(), QuotaError(), response])

    assert _sync_chain(request, raw_handler) is response
    requests = [call.args[0] for call in raw_handler.call_args_list]
    assert [model_provider(item.model) for item in requests] == [
        "apx",
        "apx",
        "google_genai",
    ]
    assert sleeps == []


def test_last_provider_route_still_waits_for_its_cooldown(monkeypatch):
    _routes(monkeypatch, "apx", "google_genai")
    from middleware import token_fallback

    sleeps: list[float] = []
    monkeypatch.setattr(token_fallback, "_sleep", sleeps.append)
    monkeypatch.setenv("APX_API_KEY", "apx-a,apx-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-a,google-b")
    request = ModelRequest(model=_apx_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(
        side_effect=[QuotaError(), QuotaError(), QuotaError(), QuotaError(), response]
    )

    assert _sync_chain(request, raw_handler) is response
    requests = [call.args[0] for call in raw_handler.call_args_list]
    assert [model_provider(item.model) for item in requests] == [
        "apx",
        "apx",
        "google_genai",
        "google_genai",
        "google_genai",
    ]
    assert len(sleeps) == 1


def test_apx_text_only_structured_answer_falls_back_to_google(monkeypatch):
    _routes(monkeypatch, "openai", "google_genai")
    from langchain.agents.structured_output import ToolStrategy
    from pydantic import BaseModel

    from middleware.model_governance import StopSchemaRepairMiddleware

    class Answer(BaseModel):
        count: int

    monkeypatch.setenv("APX_API_KEY", "apx-a,apx-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-a")
    request = ModelRequest(
        model=_apx_model(), messages=[], tools=[], response_format=ToolStrategy(Answer),
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
    # The contract violation is provider-specific: no apx key rotation, straight to Google.
    assert [model_provider(call.args[0].model) for call in raw_handler.call_args_list] == [
        "apx",
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
    _routes(monkeypatch, "apx", "google_genai")
    _install_fallback_models(monkeypatch)


def _install_fallback_models(monkeypatch):
    import middleware.provider_fallback as fallback_module

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

    result = ProviderFallbackMiddleware().wrap_model_call(_RouteRequest("apx"), handler)

    assert isinstance(result, ModelResponse)
    # apx deferred (a later route existed), Google failed, then apx again with
    # no later route: token fallback now waits for the cooldown and retries.
    assert calls == [("apx", True), ("google_genai", False), ("apx", False)]



def test_a_pool_that_is_rate_limited_on_every_route_is_waited_out_not_ended(monkeypatch, provider_pauses):
    """Production shape: APX allowance gone, Gemini failing, Inception 429 on every slot."""
    from middleware.token_fallback import _FURTHER_PROVIDER_ROUTE

    _routes(monkeypatch, "apx", "google_genai", "inception")
    _install_fallback_models(monkeypatch)
    calls: list[tuple[str, bool]] = []
    inception_attempts = 0

    def handler(request):
        nonlocal inception_attempts
        provider = request.model.provider
        calls.append((provider, _FURTHER_PROVIDER_ROUTE.get()))
        if provider == "apx":
            raise _rate_limited_primary("insufficient_quota")
        if provider == "google_genai":
            raise _StatusError(503)
        inception_attempts += 1
        if inception_attempts <= 2:
            raise _rate_limited_primary()
        return ModelResponse(result=[])

    result = ProviderFallbackMiddleware().wrap_model_call(_RouteRequest("apx"), handler)

    assert isinstance(result, ModelResponse)
    # Only the route that actually hit a plain 429 is retried; apx (quota) and google (503) are not.
    assert [provider for provider, _ in calls] == ["apx", "google_genai", "inception", "inception", "inception"]
    assert all(further is False for _, further in calls[2:])
    assert provider_pauses == [5.0, 15.0]


def test_a_route_that_recovers_after_the_wait_is_not_made_sticky_disabled(monkeypatch, provider_pauses):
    """Regression: the recovered route was in the call's failed list and got disabled for the run."""
    import middleware.provider_fallback as fallback_module

    _routes(monkeypatch, "apx", "inception")
    _install_fallback_models(monkeypatch)
    stuck: list[list] = []
    monkeypatch.setattr(fallback_module, "_stick_to_fallback", lambda failed: stuck.append(list(failed)))
    inception_attempts = 0

    def handler(request):
        nonlocal inception_attempts
        if request.model.provider == "apx":
            raise _rate_limited_primary("insufficient_quota")
        inception_attempts += 1
        if inception_attempts == 1:
            raise _rate_limited_primary()
        return ModelResponse(result=[])

    ProviderFallbackMiddleware().wrap_model_call(_RouteRequest("apx"), handler)

    assert provider_pauses == [5.0]
    assert len(stuck) == 1
    assert all("inception" not in str(route) for route in stuck[0])


@pytest.mark.asyncio
async def test_async_recovered_route_is_not_made_sticky_disabled(monkeypatch, provider_pauses):
    import middleware.provider_fallback as fallback_module

    _routes(monkeypatch, "apx", "inception")
    _install_fallback_models(monkeypatch)
    stuck: list[list] = []
    monkeypatch.setattr(fallback_module, "_stick_to_fallback", lambda failed: stuck.append(list(failed)))
    inception_attempts = 0

    async def handler(request):
        nonlocal inception_attempts
        if request.model.provider == "apx":
            raise _rate_limited_primary("insufficient_quota")
        inception_attempts += 1
        if inception_attempts == 1:
            raise _rate_limited_primary()
        return ModelResponse(result=[])

    await ProviderFallbackMiddleware().awrap_model_call(_RouteRequest("apx"), handler)

    assert all("inception" not in str(route) for route in stuck[0])


def test_rate_limit_waiting_is_bounded_and_then_ends_the_task(monkeypatch, provider_pauses):
    from middleware.failure_policy import TerminalCredentialError
    from middleware.provider_fallback import _RATE_LIMIT_BACKOFF_SECONDS

    _routes(monkeypatch, "apx", "inception")
    _install_fallback_models(monkeypatch)
    calls: list[str] = []

    def handler(request):
        calls.append(request.model.provider)
        raise _rate_limited_primary("insufficient_quota") if request.model.provider == "apx" else _rate_limited_primary()

    with pytest.raises(TerminalCredentialError):
        ProviderFallbackMiddleware().wrap_model_call(_RouteRequest("apx"), handler)

    assert provider_pauses == list(_RATE_LIMIT_BACKOFF_SECONDS)
    assert calls.count("inception") == 1 + len(_RATE_LIMIT_BACKOFF_SECONDS)
    assert calls.count("apx") == 1


def test_a_route_that_turns_into_quota_exhaustion_stops_being_waited_on(monkeypatch, provider_pauses):
    from middleware.failure_policy import TerminalCredentialError

    _routes(monkeypatch, "apx", "inception")
    _install_fallback_models(monkeypatch)
    attempts = 0

    def handler(request):
        nonlocal attempts
        attempts += 1
        raise _rate_limited_primary("insufficient_quota" if attempts > 2 else None)

    with pytest.raises(TerminalCredentialError):
        ProviderFallbackMiddleware().wrap_model_call(_RouteRequest("apx"), handler)

    assert attempts == 3 + 1  # apx, inception, then one retry round whose failure ends the waiting
    assert provider_pauses == [5.0]


@pytest.mark.asyncio
async def test_async_rate_limited_pool_is_waited_out_too(monkeypatch, provider_pauses):
    _routes(monkeypatch, "apx", "inception")
    _install_fallback_models(monkeypatch)
    inception_attempts = 0

    async def handler(request):
        nonlocal inception_attempts
        if request.model.provider == "apx":
            raise _rate_limited_primary("insufficient_quota")
        inception_attempts += 1
        if inception_attempts == 1:
            raise _rate_limited_primary()
        return ModelResponse(result=[])

    result = await ProviderFallbackMiddleware().awrap_model_call(_RouteRequest("apx"), handler)

    assert isinstance(result, ModelResponse)
    assert provider_pauses == [5.0]

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
        ProviderFallbackMiddleware().wrap_model_call(_RouteRequest("apx"), handler)
    assert calls == ["apx", "google_genai"]


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
    _routes(monkeypatch, "openai", "apx")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("APX_API_KEY", "apx-only")


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

    assert _providers(handler) == ["openai", "openai", "apx", "apx", "apx"]
    assert session.provider_route_disabled(route_key("openai", MODEL_FOR["openai"], "openai")) is True


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
    assert session.provider_route_disabled(route_key("openai", MODEL_FOR["openai"], "openai")) is False


def test_auth_failure_semantics_unchanged_with_sticky_fallback(monkeypatch):
    _routes(monkeypatch, "openai", "apx")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("APX_API_KEY", "apx-only")
    from middleware import token_fallback

    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    handler = MagicMock(side_effect=[AuthError(), AuthError(), response])
    with activate_agent_run_state(_run_session("run-auth")):
        assert _sync_chain(request, handler) is response
    # 401 still marks slots dead for the process and opens the run circuit.
    assert token_fallback._DEAD_CREDENTIAL_SLOTS[("openai", "OPENAI_API_KEY")] == {0, 1}
    assert _providers(handler) == ["openai", "openai", "apx"]


def test_sticky_fallback_failure_stays_bounded(monkeypatch, provider_pauses):
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
    # The sticky-skipped primary is not retried; the fallback pool that actually hit the plain
    # rate limit is, once per bounded backoff round, and then the task ends.
    from middleware.provider_fallback import _RATE_LIMIT_BACKOFF_SECONDS

    assert set(_providers(failing)) == {"apx"}
    assert failing.call_count == 1 + len(_RATE_LIMIT_BACKOFF_SECONDS)
    assert provider_pauses == list(_RATE_LIMIT_BACKOFF_SECONDS)


def test_sticky_fallback_reports_usage_per_answered_attempt_without_extra_logical_turns(monkeypatch):
    import middleware.provider_fallback as fallback_module

    _routes(monkeypatch, "openai", "apx")
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
    assert calls == ["openai", "apx", "apx"]
    # Only the answering route reports usage; the failed primary attempt reports none.
    assert [p.provider for p in client.payloads] == ["APX", "APX"]
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
            "backup": {"provider": "apx", "model": "model-omega-7", "options": {"temperature": 0.25}},
        },
        ["backup"],
    )
    (config,) = model_policy.fallback_routes("primary")

    model = fallback_module.fallback_model(config)

    assert model_provider(model) == "apx"
    assert model.model == "model-omega-7"
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
    assert session.provider_route_disabled(route_key("openai", ALPHA, "openai")) is True
    assert session.provider_route_disabled(route_key("openai", "model-beta", "openai")) is False
