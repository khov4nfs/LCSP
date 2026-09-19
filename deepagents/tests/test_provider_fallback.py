import os
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain.agents.middleware import ModelRequest, ModelResponse
from langchain_openai import ChatOpenAI

from middleware.failure_policy import TerminalCredentialError
from middleware.provider_fallback import (
    ProviderFallbackMiddleware,
    configured_fallback_providers,
)
from middleware.billing_metering import (
    BillingMeteringMiddleware,
    BillingMeteringSession,
    activate_billing_metering,
)
from middleware.token_fallback import TokenFallbackMiddleware, model_provider
from provider_credentials import credential_init_kwargs


class QuotaError(Exception):
    status_code = 429


class AuthError(Exception):
    status_code = 401


@pytest.fixture(autouse=True)
def clear_provider_fallback_env(monkeypatch):
    for name in list(os.environ):
        if name.startswith("LLM_FALLBACK_PROVIDER_"):
            monkeypatch.delenv(name, raising=False)
    from middleware import token_fallback

    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    token_fallback._RATE_LIMITED_UNTIL.clear()
    yield
    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    token_fallback._RATE_LIMITED_UNTIL.clear()


def _openai_model():
    return ChatOpenAI(
        model="gpt-5-nano",
        use_responses_api=True,
        **credential_init_kwargs("openai"),
    )


class _BillingModel:
    def __init__(self, provider: str):
        self.provider = provider
        self.model_name = "gpt-5-nano"


class _BillingRequest:
    def __init__(self, model):
        self.model = model
        self.messages = []
        self.tools = []

    def override(self, **kwargs):
        return _BillingRequest(kwargs.get("model", self.model))


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


def test_configured_provider_chain_is_numeric_ordered_aliased_and_deduplicated(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "google-test-token")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-test-token")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_20", "llm7")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_2", "gemini")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_3", "google_genai")

    assert configured_fallback_providers() == ("google_genai", "llm7")


def test_terminal_billing_delivery_failure_does_not_enter_provider_fallback(monkeypatch):
    import middleware.provider_fallback as fallback_module

    monkeypatch.setattr(fallback_module, "model_provider", lambda model: model.provider)
    monkeypatch.setattr(
        fallback_module, "configured_fallback_providers", lambda: ("llm7",)
    )
    monkeypatch.setattr(
        fallback_module, "fallback_model", lambda provider: _BillingModel(provider)
    )
    session = BillingMeteringSession(
        api_client=type(
            "FailingBillingClient",
            (),
            {"post_settled_usage": lambda self, _payload: (_ for _ in ()).throw(RuntimeError("api-down"))},
        )(),
        assessment_id="assessment-1",
        run_id="run-1",
        reservation_id="reservation-1",
        agent_role="planner",
        reserved_provider="OPENAI",
        reserved_model="gpt-5-nano",
    )
    provider_calls = []

    def provider_handler(_request):
        provider_calls.append(1)
        return ModelResponse(result=[])

    request = _BillingRequest(_BillingModel("openai"))
    billing = BillingMeteringMiddleware()
    with activate_billing_metering(session), pytest.raises(Exception) as error:
        ProviderFallbackMiddleware().wrap_model_call(
            request,
            lambda next_request: billing.wrap_model_call(
                next_request, provider_handler
            ),
        )
    assert type(error.value).__name__ == "BillingMeteringError"
    assert len(provider_calls) == 1


def test_configured_provider_requires_its_own_credentials(monkeypatch):
    monkeypatch.delenv("LLM7_API_KEY", raising=False)
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_1", "llm7")

    with pytest.raises(RuntimeError, match="requires LLM7_API_KEY"):
        configured_fallback_providers()


def test_invalid_fallback_provider_fails_closed(monkeypatch):
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_1", "unknown-gateway")

    with pytest.raises(RuntimeError, match="must be one of"):
        configured_fallback_providers()


def test_primary_key_pool_exhausts_before_llm7_pool(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-a,llm7-b")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_1", "llm7")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(side_effect=[QuotaError(), QuotaError(), QuotaError(), response])

    assert _sync_chain(request, raw_handler) is response
    assert raw_handler.call_count == 4
    requests = [call.args[0] for call in raw_handler.call_args_list]
    assert [model_provider(item.model) for item in requests] == [
        "openai",
        "openai",
        "llm7",
        "llm7",
    ]
    assert [
        item.model.openai_api_key.get_secret_value()
        for item in requests
    ] == ["openai-a", "openai-b", "llm7-a", "llm7-b"]
    llm7_model = requests[-1].model
    assert str(llm7_model.openai_api_base).rstrip("/") == "https://api.llm7.io/v1"
    assert llm7_model.use_responses_api is False


def test_single_primary_auth_failure_moves_to_llm7(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-only")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_1", "llm7")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(side_effect=[AuthError(), response])

    assert _sync_chain(request, raw_handler) is response
    assert [model_provider(call.args[0].model) for call in raw_handler.call_args_list] == [
        "openai",
        "llm7",
    ]


@pytest.mark.asyncio
async def test_async_provider_fallback_keeps_llm7_key_rotation(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-a,llm7-b")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_1", "llm7")
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
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-a,google-b")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-only")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_1", "google_genai")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_2", "llm7")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(
        side_effect=[QuotaError(), QuotaError(), QuotaError(), QuotaError(), response]
    )

    assert _sync_chain(request, raw_handler) is response
    assert [model_provider(call.args[0].model) for call in raw_handler.call_args_list] == [
        "openai",
        "openai",
        "google_genai",
        "google_genai",
        "llm7",
    ]


def test_schema_request_failure_does_not_cross_provider(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-only")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_1", "llm7")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    raw_handler = MagicMock(side_effect=TypeError("bad structured request"))

    with pytest.raises(TypeError, match="bad structured request"):
        _sync_chain(request, raw_handler)
    assert raw_handler.call_count == 1


def test_all_provider_pools_exhaust_to_terminal_error(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "openai-a,openai-b")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-a,llm7-b")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_1", "llm7")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    raw_handler = MagicMock(side_effect=QuotaError())

    with pytest.raises(TerminalCredentialError, match="provider routes exhausted"):
        _sync_chain(request, raw_handler)
    assert raw_handler.call_count == 4


def test_current_provider_is_not_reentered_from_fallback_chain(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("LLM7_API_KEY", "llm7-only")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_1", "openai")
    monkeypatch.setenv("LLM_FALLBACK_PROVIDER_2", "llm7")
    request = ModelRequest(model=_openai_model(), messages=[], tools=[])
    response = ModelResponse(result=[])
    raw_handler = MagicMock(side_effect=[QuotaError(), response])

    assert _sync_chain(request, raw_handler) is response
    assert [model_provider(call.args[0].model) for call in raw_handler.call_args_list] == [
        "openai",
        "llm7",
    ]
