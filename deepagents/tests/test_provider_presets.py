"""Provider switching must select coherent role models despite stale overrides."""
import os
import subprocess
import sys

import pytest


@pytest.mark.parametrize("provider", ["openai", "google_genai", "gemini", "llm7"])
def test_provider_preset_overrides_stale_role_settings(provider):
    env = dict(os.environ, LCSP_MODEL_PROVIDER=provider, LCSP_REASONING_EFFORT="invalid")
    for name in ("ROOT_AGENT", "TRIAGE", "PLANNER", "INTERVIEW", "INVESTIGATOR", "NARRATOR"):
        env[f"LCSP_{name}_MODEL"] = "anthropic:stale-model"
    result = subprocess.run([sys.executable, "-c", '''
import model_policy as p
from harness import model_provider_profile_for
expected = p.SELECTED_PROVIDER
assert all(c.provider == expected and c.source == "provider_preset" for c in p.effective_model_configs())
assert p.REASONING_EFFORT == "low"
if expected == "google_genai":
    assert p.ALL_LCSP_MODEL_SPECS == ("google_genai:gemini-3.5-flash-lite",)
    assert model_provider_profile_for(p.ROOT_MODEL_SPEC).init_kwargs == {"thinking_level": "low"}
    for role in p.REASONING_AGENT_NAMES:
        assert p.model_init_kwargs_for_agent(agent_name=role, model_spec=p.ROOT_MODEL_SPEC) == {"thinking_level": "low"}
    for role in p.NON_REASONING_AGENT_NAMES:
        assert p.model_init_kwargs_for_agent(agent_name=role, model_spec=p.NARRATOR_MODEL_SPEC) == {"thinking_level": "minimal"}
elif expected == "llm7":
    assert p.ALL_LCSP_MODEL_SPECS == ("openai:gemini-3.1-flash-lite",)
    expected_kwargs = {
        "base_url": "https://api.llm7.io/v1",
        "use_responses_api": False,
    }
    assert model_provider_profile_for(p.ROOT_MODEL_SPEC).init_kwargs == expected_kwargs
    assert p.model_init_kwargs_for_agent(
        agent_name="law_guided_investigator", model_spec=p.ROOT_MODEL_SPEC
    ) == expected_kwargs
    assert p.reasoning_policy_for_agent(
        agent_name="law_guided_investigator", model_spec=p.ROOT_MODEL_SPEC
    ) == "unsupported_model"
else:
    assert p.ROOT_MODEL_SPEC == "openai:gpt-5-nano"
    assert p.NARRATOR_MODEL_SPEC == "openai:gpt-4.1-nano"
'''], env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


def test_llm7_harness_uses_llm7_credentials_not_openai_credentials():
    env = dict(
        os.environ,
        LCSP_MODEL_PROVIDER="llm7",
        LLM7_API_KEY="llm7-first,llm7-second",
        OPENAI_API_KEY="openai-must-not-be-used",
    )
    result = subprocess.run([sys.executable, "-c", '''
import harness
import model_policy as p
registrations = []
harness.register_provider_profile = lambda key, profile: registrations.append((key, profile))
harness.register_harness_profile = lambda *_: None
harness.configure_lcsp_harness()
profiles = {key: dict(profile.init_kwargs) for key, profile in registrations}
assert p.ALL_LCSP_MODEL_SPECS == ("openai:gemini-3.1-flash-lite",)
assert profiles["openai"]["api_key"] == "llm7-first"
assert profiles[p.ROOT_MODEL_SPEC]["api_key"] == "llm7-first"
assert profiles[p.ROOT_MODEL_SPEC]["base_url"] == "https://api.llm7.io/v1"
assert profiles[p.ROOT_MODEL_SPEC]["use_responses_api"] is False
assert profiles[p.ROOT_MODEL_SPEC]["max_retries"] == 0
assert "reasoning" not in profiles[p.ROOT_MODEL_SPEC]
assert "output_version" not in profiles[p.ROOT_MODEL_SPEC]
assert profiles[p.ROOT_MODEL_SPEC]["api_key"] != "openai-must-not-be-used"
'''], env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


def test_unknown_preset_fails_at_startup():
    result = subprocess.run(
        [sys.executable, "-c", "import model_policy"],
        env=dict(os.environ, LCSP_MODEL_PROVIDER="unknown"),
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode != 0
    assert "LCSP_MODEL_PROVIDER must be one of" in result.stderr
