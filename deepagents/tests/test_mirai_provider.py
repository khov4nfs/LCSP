from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from langchain.agents.middleware import ModelRequest, ModelResponse
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from openai import APIStatusError

import model_policy as mp
from middleware import token_fallback as tf
from middleware.usage_metering import provider_identity
from provider_credentials import credential_init_kwargs, mirai_base_url, provider_tokens


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("routed", [False, True])
@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
@pytest.mark.asyncio
async def test_mirai_uses_native_transport_and_metering_identity(
    monkeypatch, set_model_routes, asynchronous, routed, protocol
):
    monkeypatch.setenv("MIRAI_API_KEY", "offline-mirai-first,offline-mirai-second")
    monkeypatch.setenv("OPENAI_API_KEY", "offline-openai-unused")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "offline-anthropic-unused")
    assert provider_tokens("miraiapi") == ("offline-mirai-first", "offline-mirai-second")
    set_model_routes({
        "routes": {"r": {"provider": "miraiapi", "protocol": protocol, "model": "claude-sonnet-5"}},
        "roles": {"default": "r"},
    })
    client = ChatOpenAI if protocol == "openai" else ChatAnthropic
    options = {"use_responses_api": False, "stream_usage": True} if protocol == "openai" else {}
    model = mp.resolve_agent_model("root") if routed else client(
        model="claude-sonnet-5", base_url=mirai_base_url(protocol),
        **options, **credential_init_kwargs("miraiapi"),
    )
    error = APIStatusError(
        "offline quota exhausted",
        response=httpx.Response(402, request=httpx.Request("POST", mirai_base_url(protocol))),
        body={"error": {"code": "insufficient_quota"}},
    )
    answer = ModelResponse(result=[])
    handler = (AsyncMock if asynchronous else MagicMock)(side_effect=[error, answer])
    logger = MagicMock()
    monkeypatch.setattr(tf, "logger", logger)
    request = ModelRequest(model=model, messages=[], tools=[])
    middleware = tf.TokenFallbackMiddleware()
    tf._DEAD_CREDENTIAL_SLOTS.clear()
    try:
        result = await middleware.awrap_model_call(request, handler) if asynchronous else middleware.wrap_model_call(request, handler)
        assert result is answer
        models = [call.args[0].model for call in handler.call_args_list]
        key_field = "openai_api_key" if protocol == "openai" else "anthropic_api_key"
        assert [getattr(m, key_field).get_secret_value() for m in models] == ["offline-mirai-first", "offline-mirai-second"]
        for current in models:
            assert provider_identity(current) == ("MIRAIAPI", "claude-sonnet-5")
            assert tf.model_provider(current) == "miraiapi"
            assert tf.model_protocol(current) == protocol
            base_field = "openai_api_base" if protocol == "openai" else "anthropic_api_url"
            assert str(getattr(current, base_field)).rstrip("/") == mirai_base_url(protocol)
            if protocol == "openai":
                assert current.use_responses_api is False
                assert current.stream_usage is True
            assert current.max_retries == 0
        assert mp.model_route_config(models[-1]) == mp.model_route_config(model)
        assert "offline-mirai" not in str(logger.mock_calls)
    finally:
        tf._DEAD_CREDENTIAL_SLOTS.clear()


@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
def test_mirai_never_inherits_other_providers_keys(monkeypatch, set_model_routes, protocol):
    monkeypatch.delenv("MIRAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "offline-openai-unused")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "offline-anthropic-unused")
    set_model_routes({
        "routes": {"r": {"provider": "miraiapi", "protocol": protocol, "model": "claude-sonnet-5"}},
        "roles": {"default": "r"},
    })
    with pytest.raises(RuntimeError, match="miraiapi requires MIRAI_API_KEY"):
        mp.resolve_agent_model("root")
