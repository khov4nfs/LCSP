from __future__ import annotations

import pytest

import model_policy as mp


def test_exact_provider_ids_and_clients() -> None:
    assert mp.canonical_provider("google_genai") == "google_genai"
    assert mp.provider_client("llm7") == "openai_compatible_chat_completions"
    assert mp.provider_client("openai") == "responses_api"


@pytest.mark.parametrize("alias", ["google", "gemini", "Google-AI", "LLM7", " openai", "unknown", ""])
def test_no_aliasing_or_normalization(alias) -> None:
    for call in (mp.canonical_provider, mp.provider_client, mp.provider_init_kwargs):
        with pytest.raises(RuntimeError, match="supported: openai, anthropic, google_genai, llm7, inception"):
            call(alias)
    assert not hasattr(mp, "PROVIDER_ALIASES")


def test_adapter_kwargs_are_transport_only(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER_TIMEOUT_SECONDS", "7")
    assert mp.provider_init_kwargs("google_genai")["request_timeout"] == 7
    assert mp.provider_init_kwargs("openai")["use_responses_api"] is True
    assert mp.provider_init_kwargs("inception")["use_responses_api"] is False
    assert mp.provider_init_kwargs("anthropic") == {}
    for provider in ("openai", "google_genai", "llm7", "inception"):
        assert not {"reasoning", "thinking_level", "temperature", "model"} & set(
            mp.provider_init_kwargs(provider)
        )
