"""Offline structural contracts. These do not prove live-model semantic accuracy."""
from pathlib import Path

from assessment_root.agent import ROOT_INSTRUCTIONS
from assessment_root.researcher import RESEARCHER_PROMPT, read_only_permissions
from assessment_root.skills import CATALOG, ALLOWED, list_skills, load_skill
from assessment_root.tool_contracts import CONTRACTS, GRAPH_CONTRACTS, describe_tool
from assessment_root.tools import ROOT_TOOL_NAMES, build_root_tools

SKILLS = Path(__file__).resolve().parents[1] / "skills"


def test_skill_catalog_is_allowlisted_and_generic():
    assert len(ALLOWED) == 5
    assert set(name for name, _ in CATALOG) == ALLOWED
    assert set(s["name"] for s in list_skills()) == ALLOWED
    assert load_skill("../rogue") == {"ok": False, "code": "UNKNOWN_ASSESSMENT_SKILL"}
    for name in ALLOWED:
        text = (SKILLS / name / "SKILL.md").read_text(encoding="utf-8")
        assert "## Investigation" in text and "## Non-authority" in text
        assert "CheatShield" not in text


def test_prompt_keeps_legal_authority_and_selected_scope():
    for token in ("not a coding agent", "selected rules", "get_assessment_context",
                  "cite_repository_source", "NOT_ESTABLISHED", "open_human_request",
                  "SELECTED_RULES", "FULL_RULE_SET", "list_assessment_skills",
                  "load_assessment_skill"):
        assert token.lower() in ROOT_INSTRUCTIONS.lower()


def test_read_only_researcher_resists_injection_and_reports_gaps():
    for token in ("read-only", "ONE bounded", "NOT a coding agent", "path:start-end",
                  "UNTRUSTED DATA", "counterevidence", "Root re-reads"):
        assert token.lower() in RESEARCHER_PROMPT.lower()
    assert any(p.mode == "deny" and "write" in p.operations
               for p in read_only_permissions())


def test_governed_tools_explain_evidence_authority():
    import json
    from runtime_instruction_bundle import runtime_instruction
    extra = json.loads(runtime_instruction("assessment-tools.upstream"))
    assert set(ROOT_TOOL_NAMES) - {"retrieve_shared_heuristics"} <= set(CONTRACTS) | set(extra)
    assert set(GRAPH_CONTRACTS) == {"search_code_graph", "trace_call_path",
                                   "search_code_text", "get_repository_architecture"}
    assert "ASSESSMENT TOOL CONTRACT" in describe_tool(
        "submit_rule_decision", "Submit decision")


def test_skill_tool_bindings_are_root_only(tmp_path):
    from test_assessment_root_agent import FakeClient, _run
    bound = {t.name: t for t in build_root_tools(_run(tmp_path, FakeClient()))}
    assert set(bound) == set(ROOT_TOOL_NAMES)
    assert "cannot alter legal authority" in bound["load_assessment_skill"].description
    assert "API validates pins, references and revisions" in bound["submit_rule_decision"].description
