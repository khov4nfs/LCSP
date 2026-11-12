"""Construction-level locale and skill isolation tests without provider calls."""
from __future__ import annotations

import pytest

import rule_set_preparation.agent as module
from rule_set_preparation.tools import RuleSetPreparationContext


@pytest.mark.parametrize("locale", ["en", "vi"])
def test_claim_author_receives_read_only_skills_and_bound_locale(monkeypatch, locale):
    captured = []
    monkeypatch.setattr(
        module, "preparation_filesystem", lambda *args, **kwargs: object()
    )
    def summarize(*args, **kwargs):
        captured.append(kwargs)
        return object()
    monkeypatch.setattr(module, "governed_summarization_middleware", summarize)

    context = RuleSetPreparationContext(
        run_id="offline", api=object(), response_language=locale
    )
    child = module.claim_author_subagent(
        context=context, model=object(), backend=object(), budget=object()
    )
    tools = {tool.name for tool in child["tools"]}
    assert {"list_preparation_skills", "load_preparation_skill"} <= tools
    assert tools <= {"commit_claims", "list_preparation_skills", "load_preparation_skill"}
    assert "submit_compliance_rule_set" not in tools
    from runtime_instruction_bundle import runtime_instruction
    assert runtime_instruction("claim-author.system") in child["system_prompt"]
    assert child["system_prompt"] == module.claim_author_subagent(
        context=RuleSetPreparationContext(run_id="offline", api=object(), response_language="en" if locale == "vi" else "vi"),
        model=object(), backend=object(), budget=object())["system_prompt"]
    assert captured[0]["system_prompt"] == child["system_prompt"]
