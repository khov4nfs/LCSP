from __future__ import annotations

import model_policy as mp


def _one_route(set_model_routes, provider: str, model: str = "Future-Model-X9") -> None:
    set_model_routes(
        {"routes": {"r": {"provider": provider, "model": model}}, "roles": {"default": "r"}}
    )


def test_arbitrary_model_strings_pass_through_every_adapter(monkeypatch, set_model_routes) -> None:
    seen = []
    monkeypatch.setenv("MIRAI_API_KEY", "offline-mirai-key")
    monkeypatch.setattr(mp, "init_chat_model", lambda spec, **kw: seen.append(spec) or object())
    for provider, key in (("openai", "openai"), ("google_genai", "google_genai"), ("apx", "anthropic"),
                          ("inception", "openai"), ("anthropic", "anthropic"),
                          ("miraiapi", "openai")):
        _one_route(set_model_routes, provider)
        mp.resolve_agent_model("root")
        assert seen[-1] == f"{key}:Future-Model-X9"  # case preserved, no catalog


def test_credentials_use_exact_provider(monkeypatch, set_model_routes) -> None:
    captured = {}
    monkeypatch.setattr(mp, "init_chat_model", lambda spec, **kw: captured.update(kw) or object())
    monkeypatch.setattr(mp, "credential_init_kwargs", lambda p: {"api_key": f"key-for-{p}"})
    _one_route(set_model_routes, "apx", "m")
    mp.resolve_agent_model("root")
    assert captured["api_key"] == "key-for-apx"


def test_apx_uses_anthropic_messages_transport_and_its_own_credential_pool(
    monkeypatch, set_model_routes
) -> None:
    captured = {}
    monkeypatch.setenv("APX_API_KEY", "apx-slot-zero,apx-slot-one")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "direct-anthropic-only")
    monkeypatch.setenv("APX_BASE_URL", "https://api.apmix.ai/v1/")
    monkeypatch.setattr(mp, "init_chat_model", lambda spec, **kwargs: captured.update({"spec": spec, **kwargs}))
    _one_route(set_model_routes, "apx", "claude-sonnet-4-6-free")

    mp.resolve_agent_model("root")

    assert captured["spec"] == "anthropic:claude-sonnet-4-6-free"
    assert captured["api_key"] == "apx-slot-zero"
    assert captured["base_url"] == "https://api.apmix.ai"
    assert captured["timeout"] == 300.0
    assert not {"use_responses_api", "output_version", "openai_api_base"} & set(captured)


def test_direct_anthropic_keeps_its_independent_credential(monkeypatch, set_model_routes) -> None:
    captured = {}
    monkeypatch.setenv("APX_API_KEY", "apx-must-not-be-used")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "direct-anthropic-key")
    monkeypatch.setattr(mp, "init_chat_model", lambda spec, **kwargs: captured.update({"spec": spec, **kwargs}))
    _one_route(set_model_routes, "anthropic", "claude-sonnet-4-6")

    mp.resolve_agent_model("root")

    assert captured["spec"] == "anthropic:claude-sonnet-4-6"
    assert captured["api_key"] == "direct-anthropic-key"
    assert "base_url" not in captured
