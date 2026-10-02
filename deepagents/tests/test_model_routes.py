from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import model_policy as mp

FIXTURE = Path(__file__).parent / "fixtures" / "model_routes_contract.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))


def base_cfg() -> dict:
    return {
        "routes": {
            "a": {"provider": "openai", "model": "Model-Alpha", "options": {"reasoning": {"effort": "low"}}},
            "b": {"provider": "google_genai", "model": "Future-Model-X9"},
            "c": {"provider": "llm7", "model": "model-gamma"},
        },
        "roles": {"default": "a", "narrator": "b", "triage": "a"},
        "fallbacks": {"a": ["b", "c"]},
    }


@pytest.fixture
def routes(set_model_routes):
    cfg = base_cfg()
    set_model_routes(cfg)
    return cfg


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_parity_fixture_cases(case, set_model_routes):
    set_model_routes(case["yaml"])
    if case["valid"]:
        assert mp.load_model_routes().routes
    else:
        with pytest.raises(RuntimeError, match="model routes file") as error:
            mp.load_model_routes()
        assert case["errorContains"] in str(error.value)


def test_fixture_is_rich_enough():
    assert sum(c["valid"] for c in CASES) >= 38 and sum(not c["valid"] for c in CASES) >= 150


def test_default_file_loads_without_override(monkeypatch):
    monkeypatch.delenv("LCSP_MODEL_ROUTES_FILE", raising=False)
    routes = mp.load_model_routes()
    assert mp.DEFAULT_ROUTES_FILE == Path(mp.__file__).resolve().parent / "config" / "model_routes.yaml"
    assert routes.roles["default"] == "primary" and routes.fallbacks["primary"] == ("fallback",)
    for role in ("root", "triage", "repository-analyst", "interview", "narrator", "legal-chunk-triage", "legal-compiler"):
        assert role in routes.roles
    # The committed default names a model, but tests must not pin which one: model id is configuration.
    assert routes.routes["primary"]["provider"] == "llm7"
    assert isinstance(routes.routes["primary"]["model"], str) and routes.routes["primary"]["model"].strip()


def test_default_path_is_cwd_independent(monkeypatch, tmp_path):
    monkeypatch.delenv("LCSP_MODEL_ROUTES_FILE", raising=False)
    monkeypatch.chdir(tmp_path)
    assert mp.load_model_routes().roles["default"] == "primary"


def test_override_file_relative_to_cwd(monkeypatch, tmp_path, routes):
    (tmp_path / "x.yaml").write_text(json.dumps({"version": 1, **base_cfg(), "roles": {"default": "c"}}))
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", "x.yaml")
    assert mp.resolve_role("root").route_id == "c"


def test_missing_file_names_path_and_override_env(monkeypatch, tmp_path):
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", str(tmp_path / "nope.yaml"))
    with pytest.raises(RuntimeError, match=r"nope\.yaml.*LCSP_MODEL_ROUTES_FILE"):
        mp.resolve_role("root")


def test_loaded_once_per_path_until_cache_clear(monkeypatch, tmp_path, routes):
    path = Path(os.environ["LCSP_MODEL_ROUTES_FILE"])
    assert mp.resolve_role("root").model == "Model-Alpha"
    changed = base_cfg()
    changed["routes"]["a"]["model"] = "changed"
    path.write_text(json.dumps({"version": 1, **changed}))
    assert mp.resolve_role("root").model == "Model-Alpha"  # cached: no per-call read
    mp.load_model_routes.cache_clear()
    assert mp.resolve_role("root").model == "changed"


def test_old_json_env_is_ignored_and_not_referenced(monkeypatch, routes):
    monkeypatch.setenv("LCSP_MODEL_ROUTES", json.dumps({"routes": {"z": {"provider": "openai", "model": "z"}}, "roles": {"default": "z"}}))
    assert mp.resolve_role("root").route_id == "a"
    assert not hasattr(mp, "ROUTES_ENV")
    assert "LCSP_MODEL_ROUTES\"" not in Path(mp.__file__).read_text()


def test_role_resolution_default_and_shared_route(routes):
    assert mp.resolve_role("root").route_id == "a"  # falls to default
    assert mp.resolve_role("triage").route_id == mp.resolve_role("root").route_id
    narrator = mp.resolve_role("narrator")
    assert (narrator.provider, narrator.model) == ("google_genai", "Future-Model-X9")  # case preserved


def test_changing_model_string_changes_resolution_and_snapshot(set_model_routes):
    cfg = base_cfg()
    set_model_routes(cfg)
    before = mp.resolved_policy_snapshot("root")
    cfg["routes"]["a"]["model"] = "model-alpha"  # casing alone changes identity
    set_model_routes(cfg)
    assert mp.resolve_role("root").model == "model-alpha"
    assert mp.resolved_policy_snapshot("root")["policyVersion"] != before["policyVersion"]


def test_fallback_chain_by_route_or_role(routes):
    assert [c.route_id for c in mp.fallback_routes("a")] == ["b", "c"]
    assert [c.route_id for c in mp.fallback_routes("root")] == ["b", "c"]
    assert mp.fallback_routes("narrator") == ()
    assert mp.route_for_model("google_genai", "Future-Model-X9").route_id == "b"
    assert mp.route_for_model("google_genai", "future-model-x9") is None  # exact, case-sensitive
    assert mp.route_for_model("gemini", "Future-Model-X9") is None  # no aliases
    assert mp.route_for_model("openai", "nope") is None


@pytest.mark.parametrize(
    "mutate,match",
    [
        (lambda c: c["roles"].pop("default"), "roles.default"),
        (lambda c: c["roles"].update(x="zzz"), "unknown route"),
        (lambda c: c["routes"]["a"].update(provider="google"), "provider"),
        (lambda c: c["routes"]["a"].update(options={"api_key": "x"}), "protected"),
        (lambda c: c["fallbacks"].update(a=["a"]), "cycle"),
        (lambda c: c["fallbacks"].update(b=["a"]), "cycle"),
        (lambda c: c["fallbacks"].update(a=["ghost"]), "unknown"),
    ],
)
def test_config_errors_fail_closed(set_model_routes, mutate, match):
    cfg = base_cfg()
    mutate(cfg)
    set_model_routes(cfg)
    with pytest.raises(RuntimeError, match=match):
        mp.load_model_routes()


def capture(monkeypatch):
    seen = {}
    monkeypatch.setattr(mp, "init_chat_model", lambda spec, **kw: seen.update(spec=spec, kw=kw) or object())
    return seen


def test_options_pass_through_and_adapter_transport_wins(monkeypatch, set_model_routes):
    cfg = base_cfg()
    cfg["routes"]["a"]["options"] = {
        "temperature": 0.3,
        "reasoning": {"effort": "low"},
        "totally_unknown": 3,
        "use_responses_api": False,
        "context_window_tokens": 1000,
        "max_output_tokens": 50,
    }
    set_model_routes(cfg)
    seen = capture(monkeypatch)
    mp.resolve_agent_model("root")
    assert seen["spec"] == "openai:Model-Alpha"
    assert seen["kw"]["temperature"] == 0.3 and seen["kw"]["totally_unknown"] == 3
    assert seen["kw"]["use_responses_api"] is True  # adapter transport authority wins
    assert seen["kw"]["profile"] == {"name": "Model-Alpha", "max_input_tokens": 1000, "max_output_tokens": 50}
    assert "context_window_tokens" not in seen["kw"]


def test_absent_options_inject_no_reasoning_or_profile(monkeypatch, routes):
    seen = capture(monkeypatch)
    mp.resolve_agent_model("narrator")
    assert seen["spec"] == "google_genai:Future-Model-X9"
    assert not {"reasoning", "thinking_level", "profile", "reasoning_effort", "temperature"} & set(seen["kw"])
    mp.resolve_agent_model("missing-role-uses-default")
    assert seen["spec"] == "openai:Model-Alpha"


def test_openai_compatible_gateway_uses_openai_transport(monkeypatch, set_model_routes):
    cfg = base_cfg()
    cfg["roles"] = {"default": "c"}
    set_model_routes(cfg)
    seen = capture(monkeypatch)
    mp.resolve_agent_model("root")
    assert seen["spec"] == "openai:model-gamma"
    assert seen["kw"]["use_responses_api"] is False and "base_url" in seen["kw"]


def test_credentials_are_not_read_from_yaml(monkeypatch, set_model_routes):
    set_model_routes("version: 1\nroutes:\n  r: {provider: llm7, model: m, options: {api_key: sk-123}}\nroles: {default: r}\n")
    with pytest.raises(RuntimeError, match="protected option key"):
        mp.load_model_routes()
    cfg = base_cfg()
    cfg["roles"] = {"default": "c"}
    set_model_routes(cfg)
    monkeypatch.setenv("LLM7_API_KEY", "env-key")
    seen = capture(monkeypatch)
    mp.resolve_agent_model("root")
    assert seen["kw"]["api_key"] == "env-key"  # credentials come from the environment only


def test_options_colliding_with_credential_kwargs_do_not_crash_and_credentials_win(monkeypatch, set_model_routes):
    cfg = base_cfg()
    cfg["roles"] = {"default": "c"}
    cfg["routes"]["c"]["options"] = {"max_retries": 3, "temperature": 0.2}
    set_model_routes(cfg)
    monkeypatch.setenv("LLM7_API_KEY", "env-key")
    seen = capture(monkeypatch)
    mp.resolve_agent_model("root")
    assert seen["kw"]["temperature"] == 0.2
    assert seen["kw"]["max_retries"] == mp.credential_init_kwargs("llm7")["max_retries"] != 3


def test_snapshot_deterministic_and_content_addressed(set_model_routes):
    cfg = base_cfg()
    set_model_routes(cfg)
    first = mp.resolved_policy_snapshot("root")
    assert first == mp.resolved_policy_snapshot("root")
    assert first["provider"] == "OPENAI" and first["model"] == "Model-Alpha"
    assert first["policyVersion"].startswith("cfg-") and len(first["policyVersion"]) == 20
    assert first["effectiveAt"] == "1970-01-01T00:00:00.000Z"
    cfg["routes"]["a"]["options"] = {"reasoning": {"effort": "high"}}
    set_model_routes(cfg)
    assert mp.resolved_policy_snapshot("root")["policyVersion"] != first["policyVersion"]
    assert "effort" not in json.dumps(mp.resolved_policy_snapshot("root"))


def test_effective_telemetry_and_identities(routes):
    rows = {r["role"]: r for r in mp.effective_model_configs()}
    assert rows["narrator"]["provider"] == "google_genai"
    assert rows["narrator"]["model"] == "Future-Model-X9"
    assert rows["default"]["optionKeys"] == ("reasoning",)
    assert "low" not in json.dumps(rows, default=str)
    assert mp.distinct_runtime_identities() == {
        ("OPENAI", "Model-Alpha"),
        ("GOOGLE_GENAI", "Future-Model-X9"),
        ("LLM7", "model-gamma"),
    }
