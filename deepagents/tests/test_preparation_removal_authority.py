"""Exercise actual tools: descriptions are metadata; validation alone grants repair scope."""
from copy import deepcopy
import json

import pytest
from langchain_core.utils.function_calling import convert_to_openai_tool

from rule_set_preparation.claim_tools import build_claim_tools
from test_rule_set_preparation_agent import FakeApi, _draft_tools, _packet, DOC


class FailedValidation(FakeApi):
    def validate_compliance_rule_set(self, run_id, packet):
        return {"outcome": "FAILED", "failures": [{
            "code": "STALE_SOURCE_HASH", "ref": f"relation:REL-1|locator:{DOC}::art-2::cl-1", "detail": "fixture failure",
        }]}


def _valid_repair_claim(**overrides):
    base = {
        "schema_version": "1.0",
        "intent_class": "PACKET_DRAFT_REPAIR",
        "selected_tool": "remove_from_packet_draft",
        "expected_effect": "REMOVE_VALIDATION_FAILURES",
        "risk_tier": "LOW",
        "uncertainty": 0.0,
        "untrusted_context": False,
        "evidence_refs": [f"relation:REL-1|locator:{DOC}::art-2::cl-1"],
    }
    base.update(overrides)
    return base


def test_actual_claim_tools_have_explicit_model_facing_descriptions_and_schemas():
    from retained_rule_authoring_harness import restore
    _, context, runtime_tools, _ = restore()
    assert "remove_from_packet_draft" not in runtime_tools
    tools = build_claim_tools(context)
    assert len({tool.name for tool in tools}) == len(tools)
    for tool in tools:
        metadata = convert_to_openai_tool(tool)["function"]
        assert metadata["name"] == tool.name
        assert metadata["description"] == tool.description
        assert len(metadata["description"].strip()) > 30
        assert "properties" in metadata["parameters"]
        assert metadata["parameters"].get("additionalProperties") is False
    author = next(tool for tool in tools if tool.name == "author_assessment_rule")
    assert "cannot create a legal obligation" in author.description
    assert set(author.args_schema["required"]) == {"assessment_rule_id", "concept", "legal_requirement_ids"}


@pytest.mark.parametrize("edit", ["add", "external_validation", "restored_draft"])
def test_stale_or_foreign_validation_cannot_authorize_removal(edit):
    context, tools = _draft_tools(FailedValidation())
    packet = _packet()
    tools["add_to_packet_draft"].invoke(packet)
    tools["validate_compliance_rule_set"].invoke({})
    if edit == "add":
        tools["add_to_packet_draft"].invoke({"legalRequirements": [{**packet["legalRequirements"][0], "title": "corrected"}]})
    elif edit == "external_validation":
        other = deepcopy(packet)
        other["legalRequirements"][0]["title"] = "independent candidate"
        tools["validate_compliance_rule_set"].invoke({"packet": other})
    else:
        context.draft["contextRelations"]["REL-1"]["sourceQuote"] = "restored different bytes"
    before = deepcopy(context.draft)
    claim = _valid_repair_claim()
    result = json.loads(tools["remove_from_packet_draft"].invoke({"claim": claim, "relationIds": ["REL-1"]}))
    assert result["refused"] == ["REL-1"]
    assert context.draft == before


def test_removal_records_exact_repair_scope_and_requires_revalidation():
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    claim = _valid_repair_claim()
    result = json.loads(tools["remove_from_packet_draft"].invoke({
        "claim": claim,
        "relationIds": ["REL-1", "missing"],
        "legalRequirementIds": ["LR-RET"],
    }))
    assert result["removed"]["contextRelations"] == 1
    trace = context.trace[-1]
    assert trace["claimMediation"]["outcome"] == "PASSED"
    assert trace["removedLabels"] == [{"section": "contextRelations", "label": "REL-1"}]
    assert trace["refusedLabels"] == ["LR-RET"] and trace["unknownLabels"] == ["missing"]
    assert trace["validationFailures"][0]["code"] == "STALE_SOURCE_HASH"
    assert context.removal_validation_packet is None and not context.removable
    assert context.last_validation is None and context.validated_packet is None


@pytest.mark.parametrize("terminal", ["submission", "source_blocked", "concluded"])
def test_terminal_preparation_rejects_repair_mutation(terminal):
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    setattr(context, terminal, {"fixture": True})
    before = deepcopy(context.draft)
    claim = _valid_repair_claim()
    assert "error" in json.loads(tools["remove_from_packet_draft"].invoke({"claim": claim, "relationIds": ["REL-1"]}))
    assert context.draft == before


# --- LCSP-347 P1.4 Targeted Negative-Control & Assurance Suite S01 - S13 ---

def test_s01_valid_repair_claim_permits_authorized_removal():
    """S01 — Valid repair claim: correctly bound claim with valid failed-draft snapshot permits removal."""
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    claim = _valid_repair_claim()
    result = json.loads(tools["remove_from_packet_draft"].invoke({"claim": claim, "relationIds": ["REL-1"]}))
    assert result["removed"]["contextRelations"] == 1
    assert "REL-1" not in context.draft["contextRelations"]
    assert context.trace[-1]["claimMediation"]["outcome"] == "PASSED"


def test_s02_missing_claim_rejected_without_mutation():
    """S02 — Missing claim: missing or None claim is rejected fail-closed without mutation."""
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    before = deepcopy(context.draft)

    # Missing claim entirely
    result = json.loads(tools["remove_from_packet_draft"].invoke({"relationIds": ["REL-1"]}))
    assert "error" in result and result["code"] == "CLAIM_REQUIRED"
    assert context.draft == before

    # Explicit None claim
    result_none = json.loads(tools["remove_from_packet_draft"].invoke({"claim": None, "relationIds": ["REL-1"]}))
    assert "error" in result_none and result_none["code"] == "CLAIM_REQUIRED"
    assert context.draft == before


def test_s03_wrong_tool_identity_rejected():
    """S03 — Wrong tool identity: claim intended for another tool cannot authorize removal."""
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    before = deepcopy(context.draft)

    claim = _valid_repair_claim(selected_tool="add_to_packet_draft")
    result = json.loads(tools["remove_from_packet_draft"].invoke({"claim": claim, "relationIds": ["REL-1"]}))
    assert "error" in result and result["code"] == "TOOL_MISMATCH"
    assert context.draft == before
    assert context.trace[-1]["claimMediation"]["outcome"] == "REJECTED"


def test_s04_argument_mismatch_rejected():
    """S04 — Argument mismatch: claim describing different labels cannot authorize supplied arguments."""
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    before = deepcopy(context.draft)

    # Target labels mismatch
    claim_mismatch = _valid_repair_claim(target_labels=["OTHER-REL"])
    result = json.loads(tools["remove_from_packet_draft"].invoke({"claim": claim_mismatch, "relationIds": ["REL-1"]}))
    assert "error" in result and result["code"] == "ARGUMENT_MISMATCH"
    assert context.draft == before

    # Intent class mismatch
    claim_wrong_intent = _valid_repair_claim(intent_class="ARBITRARY_DELETION")
    result_intent = json.loads(tools["remove_from_packet_draft"].invoke({"claim": claim_wrong_intent, "relationIds": ["REL-1"]}))
    assert "error" in result_intent and result_intent["code"] == "INVALID_INTENT_CLASS"
    assert context.draft == before


def test_s05_stale_validation_snapshot_rejected():
    """S05 — Stale validation snapshot: old claim cannot authorize removal after draft mutation."""
    context, tools = _draft_tools(FailedValidation())
    packet = _packet()
    tools["add_to_packet_draft"].invoke(packet)
    tools["validate_compliance_rule_set"].invoke({})

    # Mutate draft after validation
    tools["add_to_packet_draft"].invoke({"legalRequirements": [{**packet["legalRequirements"][0], "title": "edited"}]})
    before = deepcopy(context.draft)
    claim = _valid_repair_claim()
    result = json.loads(tools["remove_from_packet_draft"].invoke({"claim": claim, "relationIds": ["REL-1"]}))
    assert result["refused"] == ["REL-1"]
    assert context.draft == before


def test_s06_independent_packet_validation_cannot_authorize_removal():
    """S06 — Independent packet validation: validating an unrelated packet cannot authorize draft removal."""
    context, tools = _draft_tools(FailedValidation())
    packet = _packet()
    tools["add_to_packet_draft"].invoke(packet)

    other = deepcopy(packet)
    other["legalRequirements"][0]["title"] = "independent external candidate"
    tools["validate_compliance_rule_set"].invoke({"packet": other})

    before = deepcopy(context.draft)
    claim = _valid_repair_claim()
    result = json.loads(tools["remove_from_packet_draft"].invoke({"claim": claim, "relationIds": ["REL-1"]}))
    assert result["refused"] == ["REL-1"]
    assert context.draft == before


def test_s07_unauthorized_label_refused_even_with_valid_claim():
    """S07 — Unauthorized label: claim cannot remove labels absent from the validation allowlist."""
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    before = deepcopy(context.draft)

    claim = _valid_repair_claim()
    result = json.loads(tools["remove_from_packet_draft"].invoke({
        "claim": claim,
        "relationIds": ["REL-1"],
        "legalRequirementIds": ["LR-RET"],
    }))
    assert result["removed"]["contextRelations"] == 1
    assert result["refused"] == ["LR-RET"]
    assert "LR-RET" in context.draft["legalRequirements"]


@pytest.mark.parametrize("hazard,override,expected_code", [
    ("untrusted_context", {"untrusted_context": True}, "UNTRUSTED_CONTEXT"),
    ("forged_evidence", {"evidence_refs": ["fabricated-failure-locator"]}, "FORGED_EVIDENCE_REF"),
    ("high_risk", {"risk_tier": "HIGH"}, "UNACCEPTABLE_RISK_TIER"),
    ("critical_risk", {"risk_tier": "CRITICAL"}, "UNACCEPTABLE_RISK_TIER"),
    ("uncertainty", {"uncertainty": 0.5}, "UNRESOLVED_UNCERTAINTY"),
    ("bad_schema", {"schema_version": "99.0"}, "INVALID_SCHEMA_VERSION"),
    ("bad_effect", {"expected_effect": "NUKE_ALL"}, "INVALID_EXPECTED_EFFECT"),
])
def test_s08_forged_or_untrusted_evidence_rejected(hazard, override, expected_code):
    """S08 — Forged or untrusted evidence: invented evidence or unsafe parameters fail closed."""
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    before = deepcopy(context.draft)

    claim = _valid_repair_claim(**override)
    result = json.loads(tools["remove_from_packet_draft"].invoke({"claim": claim, "relationIds": ["REL-1"]}))
    assert "error" in result and result["code"] == expected_code
    assert context.draft == before
    assert context.trace[-1]["claimMediation"]["outcome"] == "REJECTED"


@pytest.mark.parametrize("terminal", ["submission", "source_blocked", "concluded"])
def test_s09_terminal_state_rejects_mutation_regardless_of_claim(terminal):
    """S09 — Terminal state: finished runs reject mutation before evaluating claims."""
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    setattr(context, terminal, {"finished": True})
    before = deepcopy(context.draft)

    claim = _valid_repair_claim()
    result = json.loads(tools["remove_from_packet_draft"].invoke({"claim": claim, "relationIds": ["REL-1"]}))
    assert "error" in result and "already finished" in result["error"]
    assert context.draft == before


def test_s10_frozen_inventory_path_rejects_legacy_mutation():
    """S10 — Frozen inventory: typed authoring path rejects legacy packet removal."""
    from retained_rule_authoring_harness import restore
    _, context, runtime_tools, _ = restore()
    assert "remove_from_packet_draft" not in runtime_tools
    from rule_set_preparation.tools import build_rule_set_tools
    all_tools = {t.name: t for t in build_rule_set_tools(context)}
    assert "remove_from_packet_draft" not in all_tools


def test_s11_model_facing_schema_matches_langchain_openai_format():
    """S11 — Model-facing schema: verifies claim structure in tool's OpenAI schema representation."""
    context, tools = _draft_tools(FailedValidation())
    tool = tools["remove_from_packet_draft"]
    metadata = convert_to_openai_tool(tool)["function"]
    assert metadata["name"] == "remove_from_packet_draft"
    params = metadata["parameters"]
    assert params["type"] == "object"
    assert "claim" in params["properties"]
    assert "claim" in params["required"]
    claim_schema = params["properties"]["claim"]
    assert claim_schema["type"] == "object"
    assert set(claim_schema["required"]) == {
        "schema_version",
        "intent_class",
        "selected_tool",
        "expected_effect",
        "risk_tier",
        "uncertainty",
        "untrusted_context",
        "evidence_refs",
    }
    assert claim_schema["properties"]["selected_tool"]["enum"] == ["remove_from_packet_draft"]
    assert claim_schema["properties"]["intent_class"]["enum"] == ["PACKET_DRAFT_REPAIR"]
    assert claim_schema["additionalProperties"] is False


def test_s12_audit_trace_records_claim_validation_outcomes_without_leakage():
    """S12 — Audit trace: records structured mediation outcome without secret or raw prompt leakage."""
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})

    # 1. Successful mediation
    claim = _valid_repair_claim(summary="Safe removal of stale relation REL-1")
    tools["remove_from_packet_draft"].invoke({"claim": claim, "relationIds": ["REL-1"]})
    trace_pass = context.trace[-1]
    assert trace_pass["tool"] == "draft_remove"
    assert trace_pass["claimMediation"]["outcome"] == "PASSED"
    assert trace_pass["claimMediation"]["intentClass"] == "PACKET_DRAFT_REPAIR"
    assert trace_pass["claimMediation"]["riskTier"] == "LOW"

    # Verify no raw private summary or unvetted text leaked to trace
    trace_str = json.dumps(trace_pass)
    assert "Safe removal of stale relation" not in trace_str

    # 2. Rejected mediation
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    bad_claim = _valid_repair_claim(risk_tier="CRITICAL")
    tools["remove_from_packet_draft"].invoke({"claim": bad_claim, "relationIds": ["REL-1"]})
    trace_fail = context.trace[-1]
    assert trace_fail["tool"] == "draft_remove"
    assert trace_fail["claimMediation"]["outcome"] == "REJECTED"
    assert trace_fail["claimMediation"]["code"] == "UNACCEPTABLE_RISK_TIER"


def test_s13_compatibility_with_valid_callers_and_revalidation():
    """S13 — Compatibility: valid caller removes item, invalidates validation authority, and requires revalidation."""
    context, tools = _draft_tools(FailedValidation())
    tools["add_to_packet_draft"].invoke(_packet())
    tools["validate_compliance_rule_set"].invoke({})
    claim = _valid_repair_claim()

    assert ("contextRelations", "REL-1") in context.removable
    assert context.removal_validation_packet is not None

    result = json.loads(tools["remove_from_packet_draft"].invoke({"claim": claim, "relationIds": ["REL-1"]}))
    assert result["removed"]["contextRelations"] == 1

    # Removal must clear validation authority: require re-validation
    assert context.validated_packet is None
    assert context.last_validation is None
    assert context.removal_validation_packet is None
    assert not context.removable
