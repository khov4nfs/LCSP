from __future__ import annotations

import harness
from model_policy import (
    REASONING_EFFORT,
    _model_spec,
    canonical_provider,
    model_init_kwargs_for_agent,
    openai_responses_base_init_kwargs,
    openai_responses_init_kwargs,
    provider_client,
    provider_init_kwargs,
    providers_for_model_specs,
    reasoning_policy_for_agent,
)


def test_provider_aliases_route_to_langchain_canonical_keys(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_PLANNER_MODEL", "googleai:gemini-3.1-pro-preview")

    model_spec, source = _model_spec(
        "LCSP_PLANNER_MODEL",
        "openai:gpt-5-mini",
    )

    assert model_spec == "google_genai:gemini-3.1-pro-preview"
    assert source == "env"
    assert canonical_provider("Google-AI") == "google_genai"


def test_provider_constructor_kwargs_are_isolated() -> None:
    assert provider_init_kwargs("openai") == openai_responses_base_init_kwargs()
    assert provider_init_kwargs("anthropic") == {}
    assert provider_init_kwargs("google_genai") == {}

    assert provider_client("openai") == "responses_api"
    assert provider_client("anthropic") == "anthropic"
    assert provider_client("googleai") == "google_genai"

    openai_kwargs = provider_init_kwargs("openai")
    assert openai_kwargs == {
        "use_responses_api": True,
        "output_version": "responses/v1",
    }
    assert "use_responses_api" not in provider_init_kwargs("anthropic")
    assert "reasoning" not in provider_init_kwargs("google_genai")


def test_agent_constructor_kwargs_gate_reasoning_by_agent_and_model() -> None:
    assert (
        reasoning_policy_for_agent(
            agent_name="law_guided_investigator",
            model_spec="openai:gpt-5-mini",
        )
        == "enabled"
    )
    assert model_init_kwargs_for_agent(
        agent_name="law_guided_investigator",
        model_spec="openai:gpt-5-mini",
    )["reasoning"] == {"effort": REASONING_EFFORT}

    assert (
        reasoning_policy_for_agent(
            agent_name="lcsp-final-report-narrator",
            model_spec="openai:gpt-5-mini",
        )
        == "disabled_for_agent"
    )
    assert "reasoning" not in model_init_kwargs_for_agent(
        agent_name="lcsp-final-report-narrator",
        model_spec="openai:gpt-5-mini",
    )
    assert "reasoning" not in model_init_kwargs_for_agent(
        agent_name="law_guided_investigator",
        model_spec="openai:gpt-4o-mini",
    )
    assert model_init_kwargs_for_agent(
        agent_name="law_guided_investigator",
        model_spec="anthropic:claude-sonnet-4-6",
    ) == {}


def test_active_provider_routes_preserve_first_seen_order() -> None:
    specs = (
        "openai:gpt-5-mini",
        "anthropic:claude-sonnet-4-6",
        "google_genai:gemini-3.1-pro-preview",
        "openai:gpt-5.1",
    )

    assert providers_for_model_specs(specs) == (
        "openai",
        "anthropic",
        "google_genai",
    )


def test_harness_registers_each_active_provider_without_cross_provider_kwargs(
    monkeypatch,
) -> None:
    mixed_specs = (
        "openai:gpt-5-mini",
        "anthropic:claude-sonnet-4-6",
        "google_genai:gemini-3.1-pro-preview",
    )
    provider_registrations: list[tuple[str, object]] = []
    harness_registrations: list[tuple[str, object]] = []

    monkeypatch.setattr(harness, "ALL_LCSP_MODEL_SPECS", mixed_specs)
    monkeypatch.setattr(
        harness,
        "register_provider_profile",
        lambda key, profile: provider_registrations.append((key, profile)),
    )
    monkeypatch.setattr(
        harness,
        "register_harness_profile",
        lambda model_spec, profile: harness_registrations.append(
            (model_spec, profile)
        ),
    )

    harness.configure_lcsp_harness()

    assert tuple(key for key, _ in provider_registrations) == (
        "openai",
        "anthropic",
        "google_genai",
        "openai:gpt-5-mini",
        "anthropic:claude-sonnet-4-6",
        "google_genai:gemini-3.1-pro-preview",
    )

    profiles = {key: profile for key, profile in provider_registrations}
    assert dict(profiles["openai"].init_kwargs) == openai_responses_base_init_kwargs()
    assert dict(profiles["anthropic"].init_kwargs) == {}
    assert dict(profiles["google_genai"].init_kwargs) == {}
    assert dict(profiles["openai:gpt-5-mini"].init_kwargs) == (
        openai_responses_init_kwargs("openai:gpt-5-mini")
    )
    assert dict(profiles["anthropic:claude-sonnet-4-6"].init_kwargs) == {}
    assert dict(profiles["google_genai:gemini-3.1-pro-preview"].init_kwargs) == {}

    assert tuple(model_spec for model_spec, _ in harness_registrations) == mixed_specs
    assert all(
        profile is harness.LCSP_HARNESS_PROFILE
        for _, profile in harness_registrations
    )


def test_every_provider_seeds_one_key_from_a_rotated_credential_list(monkeypatch) -> None:
    # A comma-separated list is the rotation pool for TokenFallbackMiddleware. Handing it
    # to an SDK verbatim authenticates with a single nonsense key, so each registered
    # profile must carry exactly one token while keeping its provider-specific kwargs.
    mixed_specs = ("openai:gpt-5-mini", "google_genai:gemini-3.1-pro-preview")
    registrations: list[tuple[str, object]] = []

    monkeypatch.setenv("OPENAI_API_KEY", "sk-first, sk-second ,sk-third,")
    monkeypatch.setenv("GOOGLE_API_KEY", "goog-first,goog-second")
    monkeypatch.setattr(harness, "ALL_LCSP_MODEL_SPECS", mixed_specs)
    monkeypatch.setattr(
        harness,
        "register_provider_profile",
        lambda key, profile: registrations.append((key, profile)),
    )
    monkeypatch.setattr(harness, "register_harness_profile", lambda *_: None)

    harness.configure_lcsp_harness()

    profiles = {key: dict(profile.init_kwargs) for key, profile in registrations}
    assert profiles["openai"]["api_key"] == "sk-first"
    assert profiles["openai:gpt-5-mini"]["api_key"] == "sk-first"
    assert profiles["google_genai"]["api_key"] == "goog-first"
    assert profiles["google_genai:gemini-3.1-pro-preview"]["api_key"] == "goog-first"
    assert all("," not in profile["api_key"] for profile in profiles.values())
    # Rotation owns the retry budget, so the SDK must not silently retry a dead key.
    assert {profile["max_retries"] for profile in profiles.values()} == {0, 1}
    assert profiles["openai:gpt-5-mini"]["use_responses_api"] is True
    assert profiles["openai:gpt-5-mini"]["reasoning"] == {"effort": REASONING_EFFORT}
