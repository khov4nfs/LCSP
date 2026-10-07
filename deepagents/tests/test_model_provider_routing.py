from __future__ import annotations

import model_policy as mp


def _one_route(set_model_routes, provider: str, model: str = "Future-Model-X9") -> None:
    set_model_routes(
        {"routes": {"r": {"provider": provider, "model": model}}, "roles": {"default": "r"}}
    )


def test_arbitrary_model_strings_pass_through_every_adapter(monkeypatch, set_model_routes) -> None:
    seen = []
    monkeypatch.setattr(mp, "init_chat_model", lambda spec, **kw: seen.append(spec) or object())
    for provider, key in (("openai", "openai"), ("google_genai", "google_genai"), ("llm7", "openai"),
                          ("inception", "openai"), ("apx", "openai"), ("anthropic", "anthropic")):
        _one_route(set_model_routes, provider)
        mp.resolve_agent_model("root")
        assert seen[-1] == f"{key}:Future-Model-X9"  # case preserved, no catalog


def test_credentials_use_exact_provider(monkeypatch, set_model_routes) -> None:
    captured = {}
    monkeypatch.setattr(mp, "init_chat_model", lambda spec, **kw: captured.update(kw) or object())
    monkeypatch.setattr(mp, "credential_init_kwargs", lambda p: {"api_key": f"key-for-{p}"})
    _one_route(set_model_routes, "llm7", "m")
    mp.resolve_agent_model("root")
    assert captured["api_key"] == "key-for-llm7"
