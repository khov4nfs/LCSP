"""Provider-free EN/VI assessment prompt contract and locale-routing regressions."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from assessment_root.agent import (
    ROOT_INSTRUCTIONS,
    ROOT_INSTRUCTIONS_VI,
    create_assessment_root_agent,
)
from assessment_root.researcher import (
    RESEARCHER_PROMPT,
    RESEARCHER_PROMPT_VI,
    researcher_prompt_for_locale,
    researcher_subagent,
)
from assessment_root.skills import ALLOWED, list_skills, load_skill
from assessment_root.tool_contracts import CONTRACTS, CONTRACTS_VI, GRAPH_CONTRACTS, GRAPH_CONTRACTS_VI, describe_tool
from assessment_root.tools import ROOT_TOOL_NAMES, build_root_tools
from test_assessment_root_agent import FakeClient, RootScriptedModel, _run, complete_root_messages

BASE = Path(__file__).resolve().parents[1]
REQUIRED_GOVERNANCE = {
    "CLAIM_DERIVED", "get_assessment_context", "get_pinned_rule_set",
    "get_assessment_rule", "read_legal_source", "search_legal_source",
    "legalEffectStatus", "legalStatusSourceRef", "OPERATIVE_SCOPE",
    "NOT_ESTABLISHED", "ESTABLISHED", "REFUTED", "APPLICABLE",
    "NOT_APPLICABLE", "MET", "NOT_MET", "COMPLIANT",
    "NON_COMPLIANT", "HUMAN_PROVIDED", "record_search_coverage",
    "cite_repository_source", "open_human_request",
    "report_human_fact_unresolvable", "request_finalization",
    "submit_rule_decision", "submit_final_report", "SELECTED_RULES",
    "FULL_RULE_SET", "FINALIZING", "COMPLETE",
    "list_assessment_skills", "load_assessment_skill",
}


def test_root_has_full_en_and_vi_instructions_not_just_language_directive() -> None:
    assert len(ROOT_INSTRUCTIONS) > 18000
    assert len(ROOT_INSTRUCTIONS_VI) > 14000
    assert "Bạn là Assessment Root" in ROOT_INSTRUCTIONS_VI
    assert "You are the Assessment Root" in ROOT_INSTRUCTIONS
    for token in REQUIRED_GOVERNANCE:
        assert token in ROOT_INSTRUCTIONS, ("en", token)
        assert token in ROOT_INSTRUCTIONS_VI, ("vi", token)
    assert "không phải" in ROOT_INSTRUCTIONS_VI.lower()
    assert "coding agent" in ROOT_INSTRUCTIONS_VI.lower()


@pytest.mark.parametrize("locale,expected", [
    ("en", RESEARCHER_PROMPT), ("vi", RESEARCHER_PROMPT),
    ("EN", RESEARCHER_PROMPT), ("VI", RESEARCHER_PROMPT),
])
def test_researcher_prompt_selects_exact_checked_in_language(locale: str, expected: str) -> None:
    assert researcher_prompt_for_locale(locale) == expected
    assert "read-only" in RESEARCHER_PROMPT.lower()
    assert "chỉ đọc" in RESEARCHER_PROMPT_VI.lower()
    assert "path:start-end" in expected
    config = researcher_subagent([], middleware=(), locale=locale)
    assert config["system_prompt"] == expected
    assert "decision" not in [t.name for t in config["tools"]]


def test_missing_vi_skill_does_not_fall_back_to_english(monkeypatch, tmp_path) -> None:
    from tools.common.capabilities.agent_runtime import skill_loader
    selected = sorted(ALLOWED)[0]
    fake_root = tmp_path / "skills"
    (fake_root / selected).mkdir(parents=True)
    (fake_root / selected / "SKILL.md").write_text("English only", encoding="utf-8")
    monkeypatch.setattr(skill_loader, "SKILLS_ROOT", fake_root)
    skill_loader._load_localized_project_skill_body.cache_clear()
    try:
        with pytest.raises(FileNotFoundError):
            skill_loader.load_project_skill_for_locale(selected, "vi")
    finally:
        skill_loader._load_localized_project_skill_body.cache_clear()


@pytest.mark.parametrize("locale", ["en", "vi"])
def test_every_skill_locale_has_a_versioned_file_and_hash(locale: str) -> None:
    assert len(list_skills(locale)) == len(ALLOWED)
    for name in ALLOWED:
        filename = "SKILL.md"
        content = (BASE / "skills" / name / filename).read_text(encoding="utf-8")
        loaded = load_skill(name, locale)
        assert loaded["ok"] is True
        assert loaded["locale"] == "en"
        assert loaded["instructions"].strip() == content.strip()
        assert loaded["contentSha256"]
        assert "## Investigation" in content
        assert "## Non-authority" in content


def test_tool_contracts_have_same_keys_en_vi_and_stable_names() -> None:
    assert CONTRACTS.keys() == CONTRACTS_VI.keys()
    assert GRAPH_CONTRACTS.keys() == GRAPH_CONTRACTS_VI.keys()
    from runtime_instruction_bundle import runtime_instruction
    extra = json.loads(runtime_instruction("assessment-tools.upstream"))
    assert set(ROOT_TOOL_NAMES) - {"retrieve_shared_heuristics"} <= set(CONTRACTS) | set(extra)
    en = describe_tool("submit_rule_decision", "Canonical API schema", "en")
    vi = describe_tool("submit_rule_decision", "Canonical API schema", "vi")
    assert en != vi
    assert en.startswith("Canonical API schema")
    assert vi.startswith("Canonical API schema")
    assert "ASSESSMENT TOOL CONTRACT" in en and "ASSESSMENT TOOL CONTRACT" in vi
    assert "HITL" in vi


@pytest.mark.parametrize("locale,expected_term", [("en", "Investigation"), ("vi", "Investigation")])
def test_root_tool_schema_remains_same_but_locale_guidance_changes(tmp_path, locale, expected_term):
    run = _run(tmp_path, FakeClient())
    run.response_language = locale
    tools = {t.name: t for t in build_root_tools(run)}
    assert set(tools) == set(ROOT_TOOL_NAMES)
    skills = json.loads(tools["list_assessment_skills"].invoke({}))
    assert skills["locale"] == locale
    assert skills["skills"][0]["name"] in ALLOWED
    loaded = json.loads(tools["load_assessment_skill"].invoke({"name": "assessment-system-boundaries"}))
    assert loaded["locale"] == "en"
    assert loaded["ok"]
    assert expected_term.lower() in loaded["instructions"].lower()


@pytest.mark.parametrize("locale", ["en", "vi"])
def test_root_graph_binds_locale_to_root_researcher_and_compaction(monkeypatch, tmp_path, locale):
    import assessment_root.agent as module

    run = _run(tmp_path, FakeClient())
    run.response_language = locale
    captured = {}

    class Graph:
        def with_config(self, config):
            return self

    def capture(**kwargs):
        captured.update(kwargs)
        return Graph()

    monkeypatch.setattr(module, "create_deep_agent", capture)
    model = RootScriptedModel(responses=complete_root_messages())
    module.create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[])
    from runtime_instruction_bundle import runtime_instruction
    expected_root = runtime_instruction("assessment-root.system")
    expected_child = runtime_instruction("repository-researcher.system")
    assert captured["system_prompt"] == expected_root
    assert len(captured["subagents"]) == 1
    assert captured["subagents"][0]["system_prompt"] == expected_child
    assert all(t.name not in ROOT_TOOL_NAMES for t in captured["subagents"][0]["tools"])


def test_scoped_development_rules_are_not_legal_exemptions() -> None:
    """Both full-language system prompts distinguish server rule selection from legal effect."""
    assert "## Activity-stage and legal-scope separation" in ROOT_INSTRUCTIONS
    assert "## Phân biệt giai đoạn trách nhiệm và phạm vi quy tắc" in ROOT_INSTRUCTIONS_VI
    assert "not an exception to legislation" in ROOT_INSTRUCTIONS
    assert "không phải ngoại lệ luật" in ROOT_INSTRUCTIONS_VI
    assert "native human-fact path" in ROOT_INSTRUCTIONS
    assert "native HITL" in ROOT_INSTRUCTIONS_VI
    assert "Rule Set Preparation and server validation" in ROOT_INSTRUCTIONS
    assert "Preparation" in ROOT_INSTRUCTIONS_VI
