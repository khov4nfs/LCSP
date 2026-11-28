"""Preparation records the actual phase-bound system prompt and authorized tools."""
from types import SimpleNamespace

import pytest

from langchain_core.messages import SystemMessage

from rule_set_preparation.agent import PreparationPhaseMiddleware


class FakeRequest:
    def __init__(self, tools):
        self.tools = tools
        self.system_message = SystemMessage(content="initial\n<LCSP_PHASE_END>governed compaction")

    def override(self, **kwargs):
        return kwargs


def context(locale="vi"):
    return SimpleNamespace(
        run_id="runner-001", response_language=locale, direct_draft=True,
        inventory=None,
        pinned_source_version_id="11111111-1111-4111-8111-111111111111",
        discovery_only=False,
        model_facing_manifests={}, used_skill_hashes={},
    )


def final_request(state, tools, model=None):
    from middleware.approved_instructions import ApprovedInstructionMiddleware
    phase = PreparationPhaseMiddleware(state, model)._request(FakeRequest(tools))
    request = SimpleNamespace(**phase, model=model, messages=[], runtime=SimpleNamespace(context=state))
    request.override = lambda **kwargs: kwargs
    guard = ApprovedInstructionMiddleware(["preparation.direct", "preparation.presentation"],
        receipt_context=lambda: {"run_id": state.run_id, "component": "rule-set-preparation", "locale": state.response_language,
            "pins": {"legalSourceVersionId": state.pinned_source_version_id}},
        receipt_sink=lambda manifest: state.model_facing_manifests.update({manifest["manifestSha256"]: manifest}))
    return guard._request(request)


def test_preparation_phase_fingerprints_actual_localized_prompt_and_allowed_tools(monkeypatch):
    monkeypatch.delenv("LCSP_EVAL_MANIFEST_DIR", raising=False)
    model = SimpleNamespace(model_name="test-model-id")
    extra = SimpleNamespace(name="unauthorized_write", description="Must not reach model")
    from langchain_core.tools import StructuredTool
    legit = StructuredTool.from_function(lambda: None, name="get_next_legal_analysis_package", description="Read the next bounded pinned legal analysis package for the current Preparation run; this read cannot activate a Rule Set.")
    en, vi = context("en"), context("vi")
    en_result = final_request(en, [extra, legit], model)
    vi_result = final_request(vi, [extra, legit], model)
    assert [t["function"]["name"] for t in en_result["tools"]] == [legit.name]
    assert [t["function"]["name"] for t in vi_result["tools"]] == [legit.name]
    assert en_result["system_message"].content == vi_result["system_message"].content
    assert "governed compaction" not in en_result["system_message"].content
    en_manifest = next(iter(en.model_facing_manifests.values()))
    vi_manifest = next(iter(vi.model_facing_manifests.values()))
    assert "unauthorized_write" not in en_manifest["toolDescriptionsSha256"]
    assert en_manifest["model"]["configuredModelId"] == "test-model-id"
    assert en_manifest["manifestSha256"] != vi_manifest["manifestSha256"]


@pytest.mark.parametrize("locale", ["en", "vi"])
@pytest.mark.parametrize("frozen", [False, True])
def test_middleware_passes_unified_preparation_contract_to_model(monkeypatch, locale, frozen):
    monkeypatch.delenv("LCSP_EVAL_MANIFEST_DIR", raising=False)
    state = context(locale)
    state.direct_draft = False
    state.inventory = SimpleNamespace(frozen=frozen)
    result = PreparationPhaseMiddleware(state)._request(FakeRequest([]))
    prompt = result["system_message"].content
    assert "governed compaction" in prompt


def test_missing_source_pin_fails_closed_when_eval_receipts_are_enabled(monkeypatch, tmp_path):
    state = context()
    state.pinned_source_version_id = None
    monkeypatch.setenv("LCSP_EVAL_MANIFEST_DIR", str(tmp_path))
    with pytest.raises(ValueError, match="MANIFEST_MISSING_PIN_OR_PROMPT"):
        final_request(state, [])
    assert not state.model_facing_manifests
    assert not list(tmp_path.iterdir())
