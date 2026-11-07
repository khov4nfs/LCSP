"""Preparation records the actual phase-bound system prompt and authorized tools."""
from types import SimpleNamespace

import pytest

from langchain_core.messages import SystemMessage

from rule_set_preparation.agent import PreparationPhaseMiddleware, ScopeReviewPauseRequired


class FakeRequest:
    def __init__(self, tools):
        self.tools = tools
        self.system_message = SystemMessage(content="initial\n<LCSP_PHASE_END>governed compaction")

    def override(self, **kwargs):
        return kwargs


def context(locale="vi"):
    return SimpleNamespace(
        run_id="runner-001", response_language=locale, direct_draft=True,
        inventory=None, target_activity_scope="FULL_SOURCE",
        pinned_source_version_id="11111111-1111-4111-8111-111111111111",
        discovery_only=False, scope_review_paused=False,
        model_facing_manifests={}, used_skill_hashes={},
    )


def test_preparation_phase_fingerprints_actual_localized_prompt_and_allowed_tools(monkeypatch):
    monkeypatch.delenv("LCSP_EVAL_MANIFEST_DIR", raising=False)
    model = SimpleNamespace(model_name="test-model-id")
    extra = SimpleNamespace(name="unauthorized_write", description="Must not reach model")
    legit = SimpleNamespace(name="get_next_legal_analysis_package", description="Pinned legal source")
    en, vi = context("en"), context("vi")
    en_result = PreparationPhaseMiddleware(en, model)._request(FakeRequest([extra, legit]))
    vi_result = PreparationPhaseMiddleware(vi, model)._request(FakeRequest([extra, legit]))
    assert [t.name for t in en_result["tools"]] == [legit.name]
    assert [t.name for t in vi_result["tools"]] == [legit.name]
    assert "governed compaction" in en_result["system_message"].content
    assert "governed compaction" in vi_result["system_message"].content
    en_manifest = next(iter(en.model_facing_manifests.values()))
    vi_manifest = next(iter(vi.model_facing_manifests.values()))
    assert "unauthorized_write" not in en_manifest["toolDescriptionsSha256"]
    assert en_manifest["model"]["configuredModelId"] == "test-model-id"
    assert en_manifest["manifestSha256"] != vi_manifest["manifestSha256"]


def test_review_paused_stops_before_model_invocation():
    state = context()
    state.scope_review_paused = True
    with __import__("pytest").raises(ScopeReviewPauseRequired, match="SCOPE_REVIEW_PAUSED"):
        PreparationPhaseMiddleware(state)._request(FakeRequest([]))
    assert not state.model_facing_manifests


@pytest.mark.parametrize("locale", ["en", "vi"])
@pytest.mark.parametrize("frozen", [False, True])
def test_middleware_passes_reviewed_scope_contract_to_model(monkeypatch, locale, frozen):
    monkeypatch.delenv("LCSP_EVAL_MANIFEST_DIR", raising=False)
    state = context(locale)
    state.direct_draft = False
    state.inventory = SimpleNamespace(frozen=frozen)
    state.target_activity_scope = "DEVELOPMENT_ONLY"
    result = PreparationPhaseMiddleware(state)._request(FakeRequest([]))
    prompt = result["system_message"].content
    assert "coverage.state = NON_ASSESSABLE" in prompt
    assert "OUT_OF_SCOPE_TARGET:" in prompt
    assert "Today that scope is" not in prompt
    assert "Server chỉ cho phép thực thi" not in prompt
    assert "governed compaction" in prompt


def test_missing_source_pin_fails_closed_when_eval_receipts_are_enabled(monkeypatch, tmp_path):
    state = context()
    state.pinned_source_version_id = None
    monkeypatch.setenv("LCSP_EVAL_MANIFEST_DIR", str(tmp_path))
    with pytest.raises(ValueError, match="MANIFEST_MISSING_PIN_OR_PROMPT"):
        PreparationPhaseMiddleware(state)._request(FakeRequest([]))
    assert not state.model_facing_manifests
    assert not list(tmp_path.iterdir())
