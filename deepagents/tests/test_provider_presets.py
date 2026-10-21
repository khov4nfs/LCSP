from __future__ import annotations

import pytest
from conftest import use_model_routes
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

import model_policy as mp
from middleware.usage_metering import output_cap_settings
from model_policy import model_route_config
from provider_credentials import apx_base_url


def test_exact_provider_ids_and_clients() -> None:
    assert mp.canonical_provider("google_genai") == "google_genai"
    assert mp.provider_client("apx") == "anthropic_compatible_messages"
    assert mp.provider_client("apx", "openai") == "openai_compatible_chat_completions"
    assert mp.provider_client("openai") == "responses_api"
    assert mp.provider_client("nara") == "openai_compatible_chat_completions"
    assert mp.provider_client("miraiapi") == "openai_compatible_chat_completions"
    assert mp.provider_client("miraiapi", "anthropic") == "anthropic_compatible_messages"


@pytest.mark.parametrize("alias", ["google", "gemini", "Google-AI", "APX", " openai", "unknown", ""])
def test_no_aliasing_or_normalization(alias) -> None:
    for call in (mp.canonical_provider, mp.provider_client, mp.provider_init_kwargs):
        with pytest.raises(RuntimeError, match="supported: openai, anthropic, google_genai, inception, apx"):
            call(alias)
    assert not hasattr(mp, "PROVIDER_ALIASES")


def test_adapter_kwargs_are_transport_only(monkeypatch) -> None:
    monkeypatch.delenv("APX_BASE_URL", raising=False)
    monkeypatch.setenv("LLM_PROVIDER_TIMEOUT_SECONDS", "7")
    assert mp.provider_init_kwargs("google_genai")["request_timeout"] == 7
    assert mp.provider_init_kwargs("openai")["use_responses_api"] is True
    assert mp.provider_init_kwargs("inception")["use_responses_api"] is False
    assert mp.provider_init_kwargs("inception")["stream_usage"] is True
    assert mp.provider_init_kwargs("nara")["base_url"] == "https://router.bynara.id/v1"
    assert mp.provider_init_kwargs("nara")["use_responses_api"] is False
    assert mp.provider_init_kwargs("nara")["stream_usage"] is True
    assert mp.provider_init_kwargs("nara")["timeout"] == 7
    assert mp.provider_init_kwargs("miraiapi") == {
        "base_url": "https://api.miraiapi.com/v1",
        "use_responses_api": False,
        "stream_usage": True,
        "timeout": 7,
    }
    assert mp.provider_init_kwargs("miraiapi", "anthropic") == {
        "base_url": "https://api.miraiapi.com", "timeout": 7,
    }
    assert mp.provider_init_kwargs("apx")["base_url"] == "https://api.apmix.ai"
    assert "use_responses_api" not in mp.provider_init_kwargs("apx")
    assert mp.provider_init_kwargs("apx", "openai")["base_url"] == "https://api.apmix.ai/v1"
    assert mp.provider_init_kwargs("apx", "openai")["use_responses_api"] is False
    assert mp.provider_init_kwargs("anthropic") == {}
    for provider in ("openai", "google_genai", "apx", "inception", "nara", "miraiapi"):
        assert not {"reasoning", "thinking_level", "temperature", "model"} & set(
            mp.provider_init_kwargs(provider)
        )


def test_apx_endpoint_resolution_removes_repeated_version_suffixes(monkeypatch) -> None:
    monkeypatch.setenv("APX_BASE_URL", "https://api.apmix.ai/v1/v1/")
    assert apx_base_url("anthropic") == "https://api.apmix.ai"
    assert apx_base_url("openai") == "https://api.apmix.ai/v1"


def test_route_protocol_selects_native_clients_and_canonical_credentials(monkeypatch) -> None:
    use_model_routes(
        monkeypatch,
        {
            "routes": {
                "apx-anthropic": {
                    "provider": "apx",
                    "protocol": "anthropic",
                    "model": "claude-sonnet-4-6-free",
                    "options": {"context_window_tokens": 1000, "max_output_tokens": 50},
                },
                "apx-openai": {
                    "provider": "apx",
                    "protocol": "openai",
                    "model": "gpt-5.6-luna",
                },
                "direct-anthropic": {"provider": "anthropic", "model": "claude-direct"},
                "direct-openai": {"provider": "openai", "model": "gpt-direct"},
            },
            "roles": {"default": "apx-anthropic"},
        },
    )
    monkeypatch.setenv("APX_BASE_URL", "https://api.apmix.ai/v1/")
    monkeypatch.setenv("APX_API_KEY", "apx-first,apx-second")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-direct")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-direct")

    routes = mp.load_model_routes()
    apx_anthropic = mp.build_model(routes.config("apx-anthropic"))
    apx_openai = mp.build_model(routes.config("apx-openai"))
    direct_anthropic = mp.build_model(routes.config("direct-anthropic"))
    direct_openai = mp.build_model(routes.config("direct-openai"))

    assert isinstance(apx_anthropic, ChatAnthropic)
    assert apx_anthropic.anthropic_api_key.get_secret_value() == "apx-first"
    assert str(apx_anthropic.anthropic_api_url).rstrip("/") == "https://api.apmix.ai"
    assert model_route_config(apx_anthropic).provider == "apx"
    assert model_route_config(apx_anthropic).protocol == "anthropic"
    assert apx_anthropic.profile == {
        "name": "claude-sonnet-4-6-free",
        "max_input_tokens": 1000,
        "max_output_tokens": 50,
    }

    assert isinstance(apx_openai, ChatOpenAI)
    assert apx_openai.openai_api_key.get_secret_value() == "apx-first"
    assert str(apx_openai.openai_api_base).rstrip("/") == "https://api.apmix.ai/v1"
    assert "/v1/v1" not in str(apx_openai.openai_api_base)
    assert apx_openai.use_responses_api is False
    assert model_route_config(apx_openai).provider == "apx"
    assert model_route_config(apx_openai).protocol == "openai"
    assert output_cap_settings(apx_anthropic) == {"max_tokens": 50}

    assert isinstance(direct_anthropic, ChatAnthropic)
    assert direct_anthropic.anthropic_api_key.get_secret_value() == "anthropic-direct"
    assert isinstance(direct_openai, ChatOpenAI)
    assert direct_openai.openai_api_key.get_secret_value() == "openai-direct"
