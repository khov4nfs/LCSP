"""Tests of source-preserving development-scope methodology and skill tools."""

from __future__ import annotations

import errno
import json
from types import SimpleNamespace

import pytest

from rule_set_preparation.agent import phase_instructions
from rule_set_preparation.preparation_skills import (
    build_preparation_skill_tools,
    development_scope_overlay,
    read_preparation_skill,
)
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools


def _context(*, scope: str = "FULL_SOURCE", direct_draft: bool = False):
    return SimpleNamespace(
        target_activity_scope=scope,
        direct_draft=direct_draft,
        inventory=None,
        discovery_only=False,
    )


@pytest.mark.parametrize("direct_draft", [False, True])
def test_full_source_prep_preserves_phase_without_scope_overlay(direct_draft):
    prompt = phase_instructions(_context(direct_draft=direct_draft))
    assert "DEVELOPMENT_ONLY Preparation scope" not in prompt
    assert "Preserve each distinct duty" in prompt or "requirement/rule candidates" in prompt


@pytest.mark.parametrize("direct_draft", [False, True])
def test_development_scope_overlay_preserves_source_and_validation(direct_draft):
    prompt = phase_instructions(
        _context(scope="DEVELOPMENT_ONLY", direct_draft=direct_draft)
    )
    assert "targetActivityScope=DEVELOPMENT_ONLY" in prompt
    assert "NO_REQUIREMENT" in prompt
    assert "every legally operative claim" in prompt
    assert "server-authoritative" in prompt


def test_unknown_target_scope_fails_closed():
    with pytest.raises(ValueError, match="unsupported server-bound"):
        development_scope_overlay("DEPLOYMENT_ONLY")


def test_preparation_skill_catalog_contains_only_allowlisted_local_skills():
    tools = {item.name: item for item in build_preparation_skill_tools()}
    catalog = json.loads(tools["list_preparation_skills"].invoke({}))
    assert catalog["authority"] == "METHODOLOGY_ONLY"
    assert len(catalog["skills"]) == 4
    assert all(item["name"].startswith("rule-preparation-") for item in catalog["skills"])
    loaded = json.loads(
        tools["load_preparation_skill"].invoke(
            {"name": "rule-preparation-actor-stage"}
        )
    )
    assert loaded["locale"] == "en"
    assert catalog["locale"] == "en"
    assert len(loaded["sha256"]) == 64
    assert "not" in loaded["body"].lower()


@pytest.mark.parametrize("locale", ["en", "vi"])
def test_every_preparation_skill_has_required_localized_content(locale):
    names = (
        "rule-preparation-actor-stage",
        "rule-preparation-mixed-claims",
        "rule-preparation-material-context",
        "rule-preparation-scope-quality",
    )
    for name in names:
        item = read_preparation_skill(name, locale)
        assert item["name"] == name
        assert item["locale"] == "en"
        assert len(item["body"]) > 500
        assert f"name: {name}" in item["body"]
        assert len(item["sha256"]) == 64


def test_unauthorized_skill_or_locale_does_not_fallback():
    with pytest.raises(ValueError, match="allowlisted"):
        read_preparation_skill("../../secret", "en")
    with pytest.raises(ValueError, match="locale"):
        read_preparation_skill("rule-preparation-actor-stage", "fr")


def test_preparation_tools_expose_read_only_skills_without_source_graph():
    context = RuleSetPreparationContext(run_id="sample", api=object())
    names = {item.name for item in build_rule_set_tools(context)}
    assert {"list_preparation_skills", "load_preparation_skill"} <= names
    assert "submit_compliance_rule_set" in names


def test_direct_and_authoring_system_prompts_require_source_to_rule_traceability():
    from pathlib import Path

    prompts = Path(__file__).parents[1] / "rule_set_preparation"
    direct = (prompts / "instructions-direct.md").read_text(encoding="utf-8")
    authoring = (prompts / "instructions-authoring.md").read_text(encoding="utf-8")
    assert "## Package-level source-to-rule decision ledger" in direct
    assert "## Source-grounded pre-validation review" in authoring
    assert "printed article/clause/point" in direct
    assert "NO_REQUIREMENT" in direct
    assert "NOT_APPLICABLE" not in authoring.split("## Source-grounded pre-validation review")[1]
    assert "sourceNodeId" in direct


def test_preparation_quality_skills_explain_real_negative_controls_bilingually():
    en = read_preparation_skill("rule-preparation-scope-quality", "en")["body"]
    from pathlib import Path
    vi = (Path(__file__).parents[1] / "skills/rule-preparation-scope-quality/SKILL.vi.md").read_text(encoding="utf-8")
    assert en == read_preparation_skill("rule-preparation-scope-quality", "vi")["body"]
    assert "bounding boxes" in en
    assert "không mặc định" in vi
    assert "external" in en.lower() and "ngoài" in vi.lower()
    assert "REVIEW_REQUIRED" in en and "REVIEW_REQUIRED" in vi
    assert "not existing API enums" in en


def test_deployment_only_articles_and_context_are_excluded_from_development_view_prompts():
    """Development output must not inherit unrelated operational context."""
    from pathlib import Path

    root = Path(__file__).parents[1]
    prep = root / "rule_set_preparation"
    common = (prep / "instructions-common.md").read_text(encoding="utf-8")
    development = (prep / "instructions-development.md").read_text(encoding="utf-8")
    direct = (prep / "instructions-direct.md").read_text(encoding="utf-8")
    discovery = (prep / "instructions-discovery.md").read_text(encoding="utf-8")
    authoring = (prep / "instructions-authoring.md").read_text(encoding="utf-8")
    assert "## Deployment-only source suppression" in common
    assert "## Hard suppression policy for deployment-only material" in development
    assert "## Deployment-only clauses and contextual exclusion" in discovery
    assert "## Development output suppression of deployment clauses" in authoring
    assert "## Strict deployment exclusion from the development view" in direct
    for prompt in (common, development, direct, discovery, authoring):
        assert "full-source" in prompt.lower()
        assert "context" in prompt.lower()
    assert "minimal quoted predicate" in development
    assert "NO_REQUIREMENT" in development
    assert "not an input to a Development-only AssessmentRule" in direct


def test_deployment_context_skill_locales_require_verified_material_link():
    en = read_preparation_skill("rule-preparation-material-context", "en")["body"]
    from pathlib import Path
    vi = (Path(__file__).parents[1] / "skills/rule-preparation-material-context/SKILL.vi.md").read_text(encoding="utf-8")
    assert en == read_preparation_skill("rule-preparation-material-context", "vi")["body"]
    assert "Deployment-only context must not leak" in en
    assert "Loại triệt để context chỉ thuộc deploy" in vi
    assert "verified" in en
    assert "đã xác minh" in vi
    assert "source accounting stays complete" in en.lower()
    assert "full legal ledger" in vi.lower()



def test_runtime_rejects_unvalidated_development_scope_before_model_setup(tmp_path):
    from rule_set_preparation.agent import create_rule_set_preparation_agent

    context = RuleSetPreparationContext(
        run_id="sample", api=object(), target_activity_scope="DEVELOPMENT_ONLY"
    )
    with pytest.raises(ValueError, match="DEVELOPMENT_SCOPE_NOT_VALIDATED"):
        create_rule_set_preparation_agent(
            context=context, legal_source_root=tmp_path, model=None
        )


@pytest.mark.parametrize("locale", ["en", "vi"])
@pytest.mark.parametrize("scope", ["FULL_SOURCE", "DEVELOPMENT_ONLY"])
@pytest.mark.parametrize("frozen", [False, True])
def test_composed_phase_scope_contract(locale, scope, frozen):
    context = _context(scope=scope)
    context.response_language = locale
    context.inventory = SimpleNamespace(frozen=frozen)
    prompt = phase_instructions(context)
    assert "Today that scope is" not in prompt
    assert "For a future `DEVELOPMENT_ONLY`" not in prompt
    assert "Server chỉ cho phép thực thi" not in prompt
    assert "coverage.state = NON_ASSESSABLE" in prompt
    assert "OUT_OF_SCOPE_TARGET:" in prompt
    if scope == "DEVELOPMENT_ONLY":
        assert "targetActivityScope=DEVELOPMENT_ONLY" in prompt
        assert "server-authoritative" in prompt
    else:
        assert "DEVELOPMENT_ONLY Preparation scope" not in prompt


@pytest.mark.parametrize("direct,frozen", [(True, False), (False, False), (False, True)])
@pytest.mark.parametrize("locale", ["en", "vi"])
def test_prompt_reads_do_not_depend_on_default_encoding(monkeypatch, direct, frozen, locale):
    from pathlib import Path

    original = Path.read_text

    def cp1252_default(path, encoding=None, errors=None):
        return original(path, encoding=encoding or "cp1252", errors=errors)

    monkeypatch.setattr(Path, "read_text", cp1252_default)
    context = _context(direct_draft=direct)
    context.inventory = SimpleNamespace(frozen=frozen)
    context.response_language = locale
    prompt = phase_instructions(context)
    assert "Rule Set Preparation" in prompt
    from runtime_instruction_bundle import runtime_instruction
    assert runtime_instruction("preparation.presentation") in prompt


def test_preparation_language_overlay_and_skill_tools_are_server_bound():
    from rule_set_preparation.preparation_skills import (
        enforce_runtime_scope,
        preparation_locale_overlay,
    )

    assert preparation_locale_overlay("en") == preparation_locale_overlay("vi")
    assert "responseLanguage" in preparation_locale_overlay("en")
    with pytest.raises(ValueError, match="response language"):
        preparation_locale_overlay("fr")
    enforce_runtime_scope("FULL_SOURCE")
    with pytest.raises(ValueError, match="DEVELOPMENT_SCOPE_NOT_VALIDATED"):
        enforce_runtime_scope("DEVELOPMENT_ONLY")
    english = RuleSetPreparationContext(run_id="test", api=object(), response_language="en")
    tools = {item.name: item for item in build_rule_set_tools(english)}
    listing = json.loads(tools["list_preparation_skills"].invoke({}))
    assert listing["locale"] == "en"
    loaded = json.loads(tools["load_preparation_skill"].invoke(
        {"name": "rule-preparation-actor-stage"}
    ))
    assert loaded["locale"] == "en"
    failure = json.loads(tools["load_preparation_skill"].invoke(
        {"name": "rule-preparation-actor-stage", "locale": "vi"}
    ))
    assert failure["ok"] is False
    assert failure["error"] == "SKILL_LOCALE_MISMATCH"
    assert failure["retryable"] is False
    assert failure["requiredAction"] == "USE_TRUSTED_LOCALE"


def test_claim_author_has_read_only_skills_but_no_parent_governed_actions():
    from rule_set_preparation.agent import claim_author_subagent

    context = RuleSetPreparationContext(run_id="sample", api=object())
    # The child only receives commit_claims (if inventory exists) and the two
    # read-only skill tools. It must not receive submission or completion tools.
    class DummyBudget:
        pass

    # The graph-middleware construction is integration-sensitive, so assert
    # the exact child tool-policy code in addition to integration tests.
    import inspect

    body = inspect.getsource(claim_author_subagent)
    assert '"list_preparation_skills", "load_preparation_skill"' in body
    assert '"commit_claims"' in body
    assert '"submit_compliance_rule_set"' not in body



def test_preparation_skills_catalog_is_localized_by_trusted_run():
    for locale, expected in (("vi", "Distinguish"), ("en", "Distinguish")):
        run = RuleSetPreparationContext(run_id="t", api=object(), response_language=locale)
        tools = {tool.name: tool for tool in build_rule_set_tools(run)}
        catalog = json.loads(tools["list_preparation_skills"].invoke({}))
        assert catalog["locale"] == "en"
        assert expected.lower() in catalog["skills"][0]["purpose"].lower()


def test_common_and_direct_prompts_prioritize_full_source_contract():
    from pathlib import Path
    root = Path(__file__).parents[1] / "rule_set_preparation"
    assert "## Execution contract precedence" in (root / "instructions-common.md").read_text(encoding="utf-8")
    assert "## Trusted execution scope" in (root / "instructions-direct.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("locale", ["en", "vi"])
def test_load_skill_tool_reports_expected_invalid_requests_without_raising(locale):
    """Real LangChain Tool.invoke must give structured non-retryable errors."""
    selected: dict[str, str] = {}
    skill = {entry.name: entry for entry in build_preparation_skill_tools(locale, selected)}[
        "load_preparation_skill"
    ]
    for arguments, expected_error, expected_action in (
        ({"name": "../../private"}, "SKILL_NAME_NOT_ALLOWED", "SELECT_ALLOWLISTED_SKILL"),
        ({"name": "rule-preparation-actor-stage", "locale": "fr"}, "SKILL_LOCALE_MISMATCH", "USE_TRUSTED_LOCALE"),
        ({"name": "rule-preparation-actor-stage", "locale": "other"}, "SKILL_LOCALE_MISMATCH", "USE_TRUSTED_LOCALE"),
    ):
        result = json.loads(skill.invoke(arguments))
        assert result == {
            "ok": False,
            "error": expected_error,
            "retryable": False,
            "message": result["message"],
            "requiredAction": expected_action,
        }
        assert "private" not in result["message"].lower()
        assert selected == {}


@pytest.mark.parametrize(
    ("exception", "error", "retryable", "action"),
    [
        (FileNotFoundError("secret path /srv/skills"), "SKILL_FILE_MISSING", False, "STOP_AND_REPORT"),
        (PermissionError("internal hostname private.example"), "SKILL_FILE_DENIED", False, "STOP_AND_REPORT"),
        (ValueError("internal path /tmp/empty"), "SKILL_CONTENT_INVALID", False, "STOP_AND_REPORT"),
        (UnicodeDecodeError("utf-8", b"\\xff", 0, 1, "/secret/path"), "SKILL_CONTENT_INVALID", False, "STOP_AND_REPORT"),
        (OSError(errno.EAGAIN, "local internal host/path"), "SKILL_READ_UNAVAILABLE", True, "RETRY_ONCE_THEN_STOP"),
        (OSError("local internal host/path"), "SKILL_READ_FAILED", False, "STOP_AND_REPORT"),
        (IsADirectoryError("local internal host/path"), "SKILL_READ_FAILED", False, "STOP_AND_REPORT"),
    ],
)
def test_load_skill_tool_maps_expected_file_failures_without_leaking_details(
    monkeypatch, exception, error, retryable, action
):
    import rule_set_preparation.preparation_skills as module

    def fail_read(name, locale):
        raise exception

    monkeypatch.setattr(module, "read_preparation_skill", fail_read)
    selected = {}
    tool = {entry.name: entry for entry in build_preparation_skill_tools("vi", selected)}[
        "load_preparation_skill"
    ]
    result_text = tool.invoke({"name": "rule-preparation-material-context"})
    result = json.loads(result_text)
    assert result["ok"] is False
    assert result["error"] == error
    assert result["retryable"] is retryable
    assert result["requiredAction"] == action
    assert "/srv/" not in result_text
    assert "private.example" not in result_text
    assert "/tmp/" not in result_text
    assert "/secret/" not in result_text
    assert "internal host/path" not in result_text
    assert selected == {}


def test_skill_tool_handles_langchain_schema_validation_before_function_invocation():
    tool = {entry.name: entry for entry in build_preparation_skill_tools("en")}[
        "load_preparation_skill"
    ]
    for invalid in ({}, {"name": ["wrong", "type"]}, {"name": None}):
        result = json.loads(tool.invoke(invalid))
        assert result["ok"] is False
        assert result["error"] == "SKILL_INPUT_INVALID"
        assert result["retryable"] is False
        assert result["requiredAction"] == "FIX_ARGUMENTS"


def test_skill_tool_marks_success_and_records_hash_only_after_success():
    selected = {}
    tool = {entry.name: entry for entry in build_preparation_skill_tools("vi", selected)}[
        "load_preparation_skill"
    ]
    payload = json.loads(tool.invoke({"name": "rule-preparation-actor-stage"}))
    assert payload["ok"] is True
    assert payload["sha256"] == selected["rule-preparation-actor-stage"]
    assert len(selected) == 1


def test_unexpected_skill_programming_error_is_not_silently_relabelled(monkeypatch):
    import rule_set_preparation.preparation_skills as module

    def programmer_error(name, locale):
        raise RuntimeError("unexpected software fault")

    monkeypatch.setattr(module, "read_preparation_skill", programmer_error)
    tool = {entry.name: entry for entry in build_preparation_skill_tools("en")}[
        "load_preparation_skill"
    ]
    with pytest.raises(RuntimeError, match="unexpected software fault"):
        tool.invoke({"name": "rule-preparation-actor-stage"})
