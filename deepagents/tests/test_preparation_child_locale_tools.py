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
    if locale == "vi":
        assert "Bạn chỉ phụ trách" in child["system_prompt"]
        assert "## Tiếng Việt" in child["system_prompt"]
    else:
        assert "You own exactly one Article assignment" in child["system_prompt"]
        assert "## Tiếng Việt" not in child["system_prompt"]
    assert captured[0]["system_prompt"] == child["system_prompt"]
