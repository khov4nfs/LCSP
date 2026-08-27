from __future__ import annotations

from tools.common.capabilities.managed.skill_loader import load_project_skill
from tools.legal.corpus.engineering_rules.compilation.chunk_triage import (
    TRIAGE_PROMPT_VERSION,
    TRIAGE_SKILL_NAME,
    LegalChunkEngineeringRuleTriage,
)
from tools.legal.corpus.engineering_rules.compilation.compiler import PROMPT_VERSION


def test_legal_rule_triage_skill_is_meaningful_and_canonical() -> None:
    skill = load_project_skill(TRIAGE_SKILL_NAME)

    assert "name: legal-rule-triage" in skill
    assert "ENGINEERING_RULE_CANDIDATE" in skill
    assert "CONTEXT_ONLY" in skill
    assert "REJECT" in skill
    assert "concreteness test" in skill
    assert "Candidate-to-EngineeringRule conversion" in skill
    assert "Assessment business context" in skill
    assert "compliance" in skill.lower()
    assert "source chunk IDs and locators" in skill


def test_triage_and_compiler_versions_change_with_skill_reasoning_policy() -> None:
    assert TRIAGE_PROMPT_VERSION == "legal-chunk-triage/v2"
    assert PROMPT_VERSION == "legal-to-engineering/v2"


def test_triage_prompt_requires_bounded_decision_reasoning() -> None:
    prompt = LegalChunkEngineeringRuleTriage._prompt(
        {"legalRuleId": "RULE-1"},
        [
            {
                "id": "LAW:art-1::cl-1",
                "locator": "art-1::cl-1",
                "content": "A provider must record human approval before final action.",
                "hierarchy": {},
            }
        ],
    )

    assert "actor, modality" in prompt
    assert "Assessment-specific facts" in prompt
    assert "preserve legal strength and timing" in prompt
    assert "customer source code" in prompt
