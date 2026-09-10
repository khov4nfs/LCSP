"""Provider switching must select coherent role models despite stale overrides."""
import os
import subprocess
import sys

import pytest


@pytest.mark.parametrize("provider", ["openai", "google_genai", "gemini"])
def test_provider_preset_overrides_stale_role_settings(provider):
    env = dict(os.environ, LCSP_MODEL_PROVIDER=provider, LCSP_REASONING_EFFORT="invalid")
    for name in ("ROOT_AGENT", "TRIAGE", "PLANNER", "INTERVIEW", "INVESTIGATOR", "NARRATOR"):
        env[f"LCSP_{name}_MODEL"] = "anthropic:stale-model"
    result = subprocess.run([sys.executable, "-c", '''
import model_policy as p
from harness import model_provider_profile_for
expected = "openai" if p.SELECTED_PROVIDER == "openai" else "google_genai"
assert all(c.provider == expected and c.source == "provider_preset" for c in p.effective_model_configs())
assert p.REASONING_EFFORT == "low"
if expected == "google_genai":
    assert p.ALL_LCSP_MODEL_SPECS == ("google_genai:gemini-3.5-flash-lite",)
    assert model_provider_profile_for(p.ROOT_MODEL_SPEC).init_kwargs == {"thinking_level": "low"}
    for role in p.REASONING_AGENT_NAMES:
        assert p.model_init_kwargs_for_agent(agent_name=role, model_spec=p.ROOT_MODEL_SPEC) == {"thinking_level": "low"}
    for role in p.NON_REASONING_AGENT_NAMES:
        assert p.model_init_kwargs_for_agent(agent_name=role, model_spec=p.NARRATOR_MODEL_SPEC) == {"thinking_level": "minimal"}
else:
    assert p.ROOT_MODEL_SPEC == "openai:gpt-5-nano"
    assert p.NARRATOR_MODEL_SPEC == "openai:gpt-4.1-nano"
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
