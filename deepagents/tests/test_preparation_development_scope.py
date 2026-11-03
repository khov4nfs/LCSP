"""Tests of source-preserving development-scope methodology and skill tools."""

from __future__ import annotations

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
            {"name": "rule-preparation-actor-stage", "locale": "vi"}
        )
    )
    assert loaded["locale"] == "vi"
    assert len(loaded["sha256"]) == 64
    assert "không" in loaded["body"].lower()


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
        assert item["locale"] == locale
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
