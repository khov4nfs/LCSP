from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from langchain.agents.middleware import ModelRequest, ModelResponse
from langchain_openai import ChatOpenAI
from openai import APIStatusError

import model_policy as mp
from middleware import token_fallback as tf
from middleware.provider_fallback import ProviderFallbackMiddleware
from middleware.usage_metering import provider_identity
from provider_credentials import credential_init_kwargs, provider_tokens


@pytest.fixture(autouse=True)
def isolated_pools(monkeypatch):
    monkeypatch.setenv("NARA_API_KEY", "nara-first,nara-second")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-only")
    monkeypatch.setenv("APX_API_KEY", "apx-only")
    tf._DEAD_CREDENTIAL_SLOTS.clear()
    tf._RATE_LIMITED_UNTIL.clear()
    tf._CREDENTIAL_POOL_FINGERPRINTS.clear()
    yield
    tf._DEAD_CREDENTIAL_SLOTS.clear()
    tf._RATE_LIMITED_UNTIL.clear()
    tf._CREDENTIAL_POOL_FINGERPRINTS.clear()


def nara_model(set_model_routes):
    set_model_routes({
        "routes": {"nara": {"provider": "nara", "model": "agnes-3-flash"}},
        "roles": {"default": "nara"},
    })
    return mp.resolve_agent_model("root")


def provider_error(status):
    return APIStatusError(
        "offline provider error",
        response=httpx.Response(status, request=httpx.Request("POST", "https://router.bynara.id/v1/chat/completions")),
        body={"error": {"message": "offline provider error"}},
    )


def test_nara_credential_pool_is_isolated_and_validated(monkeypatch):
    monkeypatch.setenv("NARA_API_KEY", " nara-first, nara-second,nara-first, ,")
    assert provider_tokens("nara") == ("nara-first", "nara-second")
    assert credential_init_kwargs("nara") == {"api_key": "nara-first", "max_retries": 0}
    monkeypatch.setenv("NARA_API_KEY", ", ,")
    with pytest.raises(ValueError, match="NARA_API_KEY must contain at least one API token"):
        provider_tokens("nara")
    monkeypatch.delenv("NARA_API_KEY")
    assert provider_tokens("nara") == ()


def test_missing_nara_key_never_uses_openai_key(monkeypatch, set_model_routes):
    monkeypatch.delenv("NARA_API_KEY")
    with pytest.raises(RuntimeError, match="nara requires NARA_API_KEY"):
        nara_model(set_model_routes)


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("routed", [False, True])
@pytest.mark.parametrize("status", [401, 403, 429, 503])
@pytest.mark.asyncio
async def test_nara_rotates_in_shared_handler(monkeypatch, set_model_routes, asynchronous, routed, status):
    model = nara_model(set_model_routes) if routed else ChatOpenAI(
        model="agnes-3-flash",
        base_url="https://router.bynara.id/v1",
        use_responses_api=False,
        stream_usage=True,
        **credential_init_kwargs("nara"),
    )
    assert isinstance(model, ChatOpenAI)
    assert tf.model_provider(model) == "nara"
    assert tf.model_protocol(model) == "openai"
    logger = MagicMock()
    monkeypatch.setattr(tf, "logger", logger)
    request = ModelRequest(model=model, messages=[], tools=[])
    response = ModelResponse(result=[])
    handler = (AsyncMock if asynchronous else MagicMock)(side_effect=[provider_error(status), response])
    middleware = tf.TokenFallbackMiddleware()
    result = await middleware.awrap_model_call(request, handler) if asynchronous else middleware.wrap_model_call(request, handler)

    assert result is response
    assert [call.args[0].model.openai_api_key.get_secret_value() for call in handler.call_args_list] == [
        "nara-first", "nara-second",
    ]
    replacement = handler.call_args.args[0].model
    assert str(replacement.openai_api_base).rstrip("/") == "https://router.bynara.id/v1"
    assert replacement.model_name == "agnes-3-flash"
    assert replacement.use_responses_api is False
    assert replacement.stream_usage is True
    assert replacement.max_retries == 0
    assert replacement.root_client is not model.root_client
    assert mp.model_route_config(replacement) == mp.model_route_config(model)
    assert provider_identity(replacement) == ("NARA", "agnes-3-flash")
    assert "nara-first" not in str(logger.mock_calls)
    assert "nara-second" not in str(logger.mock_calls)


def test_nara_request_errors_do_not_rotate(set_model_routes):
    request = ModelRequest(model=nara_model(set_model_routes), messages=[], tools=[])
    error = provider_error(400)
    handler = MagicMock(side_effect=error)
    with pytest.raises(APIStatusError) as caught:
        tf.TokenFallbackMiddleware().wrap_model_call(request, handler)
    assert caught.value is error
    assert handler.call_count == 1


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_provider_fallback_exhausts_nara_pool_before_next_route(set_model_routes, asynchronous):
    set_model_routes({
        "routes": {
            "primary": {"provider": "openai", "model": "offline-model"},
            "nara": {"provider": "nara", "model": "agnes-3-flash"},
            "last": {"provider": "apx", "protocol": "anthropic", "model": "offline-model"},
        },
        "roles": {"default": "primary"},
        "fallbacks": {"primary": ["nara", "last"]},
    })
    request = ModelRequest(model=mp.resolve_agent_model("root"), messages=[], tools=[])
    response = ModelResponse(result=[])
    handler = (AsyncMock if asynchronous else MagicMock)(
        side_effect=[provider_error(401), provider_error(401), provider_error(401), response],
    )
    tokens = tf.TokenFallbackMiddleware()
    providers = ProviderFallbackMiddleware()
    if asynchronous:
        async def token_handler(next_request):
            return await tokens.awrap_model_call(next_request, handler)
        result = await providers.awrap_model_call(request, token_handler)
    else:
        result = providers.wrap_model_call(request, lambda next_request: tokens.wrap_model_call(next_request, handler))

    assert result is response
    models = [call.args[0].model for call in handler.call_args_list]
    assert [provider_identity(model)[0] for model in models] == ["OPENAI", "NARA", "NARA", "APX"]
    assert [model.openai_api_key.get_secret_value() for model in models[:3]] == [
        "openai-only", "nara-first", "nara-second",
    ]
