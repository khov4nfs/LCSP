"""Single-pass independent review and deterministic integrity validation tests."""
from copy import deepcopy
from uuid import UUID
import pytest
from langchain_core.messages import AIMessage
from middleware import usage_metering
from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
from rule_set_preparation.semantic_audit import (
    SemanticAuditor,
    audit_input,
    audit_identity,
    receipt_current,
    receipt_passed,
    digest,
    ASSERTION_CHECKS,
    RELATION_CHECKS,
)
from test_semantic_auditor import example, model_response


def test_single_pass_review_positive_vertical_slice(monkeypatch):
    source, graph, node_id = example()
    value = audit_input(source, graph, node_id, 1)

    # 1 model call returning supported claims and relations
    result = {
        "verdict": "SUPPORTED",
        "gaps": [],
        "omissions": [],
        "assertions": [
            {
                "id": "claim-one",
                "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS},
                "verdict": "SUPPORTED",
                "gapCodes": [],
            }
        ],
        "relations": [],
    }
    model = RuleSetPreparationScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "SourceSemanticAuditVerdict",
                        "args": model_response(result),
                        "id": "audit-single-pass-1",
                    }
                ],
            )
        ]
    )

    original = usage_metering.assert_model_identity
    monkeypatch.setattr(
        usage_metering,
        "assert_model_identity",
        lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response),
    )

    auditor = SemanticAuditor(model, single_pass=True)
    receipt = auditor.audit(value)

    # Integrity verification
    UUID(receipt["verifierOperationId"])
    assert receipt["verifierRole"] == "legal-semantic-auditor"
    assert receipt["verdict"] == "SUPPORTED"
    assert not receipt["gaps"]
    assert receipt["sourceCatalog"] is None
    assert receipt["completenessAudit"] is None
    assert receipt["relationAudits"] == []
    assert receipt["assertions"][0]["fingerprint"] == digest(graph["claims"][0])
    assert receipt_current(value, receipt)
    assert receipt_passed(value, receipt)

    # Exactly 1 model invocation
    assert len(model.prompts) == 1
    assert model.bound_tool_names == [["SourceSemanticAuditVerdict"]]


def test_single_pass_review_negative_control_rejects_with_gap(monkeypatch):
    source, graph, node_id = example()
    value = audit_input(source, graph, node_id, 1)

    # 1 model call returning rejection with concrete gap details
    checks = {k: "SUPPORTED" for k in ASSERTION_CHECKS}
    checks["actor"] = "WRONG_ACTOR"
    result = {
        "verdict": "WRONG_ACTOR",
        "gaps": [
            {"code": "WRONG_ACTOR", "detail": "claim-one/actor: Scripted factual repair target"}
        ],
        "omissions": [],
        "assertions": [
            {
                "id": "claim-one",
                "checks": checks,
                "verdict": "WRONG_ACTOR",
                "gapCodes": ["WRONG_ACTOR"],
            }
        ],
        "relations": [],
    }
    model = RuleSetPreparationScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "SourceSemanticAuditVerdict",
                        "args": model_response(result),
                        "id": "audit-single-pass-neg",
                    }
                ],
            )
        ]
    )

    original = usage_metering.assert_model_identity
    monkeypatch.setattr(
        usage_metering,
        "assert_model_identity",
        lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response),
    )

    auditor = SemanticAuditor(model, single_pass=True)
    receipt = auditor.audit(value)

    UUID(receipt["verifierOperationId"])
    assert receipt["verdict"] == "WRONG_ACTOR"
    assert len(receipt["gaps"]) >= 1
    assert any(g["code"] == "WRONG_ACTOR" for g in receipt["gaps"])
    assert not receipt_passed(value, receipt)

    # Exactly 1 model invocation, no cascading second review
    assert len(model.prompts) == 1


def test_single_pass_review_handles_relations(monkeypatch):
    source, graph, node_id = example()
    # Add a relation
    rel = {
        "relationId": "rel-1",
        "kind": "DEFINED_BY",
        "fromClaimId": "claim-one",
        "toClaimId": "claim-one",
    }
    graph["relations"] = [rel]
    value = audit_input(source, graph, node_id, 1)

    result = {
        "verdict": "SUPPORTED",
        "gaps": [],
        "omissions": [],
        "assertions": [
            {
                "id": "claim-one",
                "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS},
                "verdict": "SUPPORTED",
                "gapCodes": [],
            }
        ],
        "relations": [
            {
                "id": "rel-1",
                "targetScopeReading": "EXACT_SOURCE_TARGET",
                "checks": {k: "SUPPORTED" for k in RELATION_CHECKS},
                "verdict": "SUPPORTED",
                "gapCodes": [],
            }
        ],
    }
    model = RuleSetPreparationScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "SourceSemanticAuditVerdict",
                        "args": model_response(result),
                        "id": "audit-single-pass-rel",
                    }
                ],
            )
        ]
    )

    original = usage_metering.assert_model_identity
    monkeypatch.setattr(
        usage_metering,
        "assert_model_identity",
        lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response),
    )

    auditor = SemanticAuditor(model, single_pass=True)
    receipt = auditor.audit(value)

    assert receipt["verdict"] == "SUPPORTED"
    assert len(receipt["relations"]) == 1
    assert receipt["relations"][0]["fingerprint"] == digest(rel)
    assert receipt_passed(value, receipt)
    assert len(model.prompts) == 1


def test_single_pass_review_article_8_defined_by_vertical_slice(monkeypatch):
    """Authoritative Article 8 positive case: cessation duty connected via DEFINED_BY to operator definition."""
    from corrected_semantic_fixture import corrected_graph
    from structural_semantic_fixture import StructuralFixtureAuditor

    _, source, graph, _, keys = corrected_graph()
    unit = keys["access.end"]["sourceNodeIds"][0]
    value = audit_input(source, graph, unit, 1)

    golden_receipt = StructuralFixtureAuditor().audit(value)
    wire_args = model_response(golden_receipt, value=value)
    wire_args["omissions"] = []

    model = RuleSetPreparationScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "SourceSemanticAuditVerdict",
                        "args": wire_args,
                        "id": "audit-single-pass-art8-authoritative",
                    }
                ],
            )
        ]
    )

    original = usage_metering.assert_model_identity
    monkeypatch.setattr(
        usage_metering,
        "assert_model_identity",
        lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response),
    )

    auditor = SemanticAuditor(model, single_pass=True)
    receipt = auditor.audit(value)

    assert receipt["verdict"] == "SUPPORTED"
    assert not receipt["gaps"]
    assert len(receipt["assertions"]) == 6
    assert len(receipt["relations"]) == 10
    rel_art8 = next(r for r in receipt["relations"] if r["id"] == "83d4a978a41c7dcbfcb17aa2e73b785c9a5a3d33c817f863e4fc0134f6aec7cc")
    assert rel_art8["checks"]["target"] == "SUPPORTED"
    assert rel_art8["checks"]["kind"] == "SUPPORTED"
    assert rel_art8["checks"]["direction"] == "SUPPORTED"
    assert receipt_passed(value, receipt)
    # Exactly 1 model call replaces legacy 35-call cascade
    assert len(model.prompts) == 1


def test_single_pass_review_detects_omission(monkeypatch):
    """When an operative obligation is missing from the candidate inventory, single-pass auditor returns MISSING_ASSERTION."""
    from corrected_semantic_fixture import corrected_graph
    from structural_semantic_fixture import StructuralFixtureAuditor

    _, source, graph, _, keys = corrected_graph()
    unit = keys["access.end"]["sourceNodeIds"][0]
    cessation_id = keys["access.end"]["claimId"]
    omitted_graph = deepcopy(graph)
    omitted_graph["claims"] = [c for c in omitted_graph["claims"] if c["claimId"] != cessation_id]
    omitted_graph["relations"] = [r for r in omitted_graph["relations"] if r["fromClaimId"] != cessation_id and r["toClaimId"] != cessation_id]
    for sa in omitted_graph["sourceAccounting"]:
        if sa["sourceNodeId"] == unit:
            sa["claimIds"] = [cid for cid in sa["claimIds"] if cid != cessation_id]

    value = audit_input(source, omitted_graph, unit, 1)

    golden_receipt = StructuralFixtureAuditor().audit(value)
    wire_args = model_response(golden_receipt, value=value)
    # Model detects that Article 8 cessation obligation was completely omitted from claims:
    wire_args["omissions"] = [{"finding": "Article 8 cessation duty ('The restriction must end when that condition ceases') is completely omitted.",
                               "quote": "The restriction must end when that condition ceases"}]

    model = RuleSetPreparationScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "SourceSemanticAuditVerdict",
                        "args": wire_args,
                        "id": "audit-single-pass-omission",
                    }
                ],
            )
        ]
    )

    original = usage_metering.assert_model_identity
    monkeypatch.setattr(
        usage_metering,
        "assert_model_identity",
        lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response),
    )

    auditor = SemanticAuditor(model, single_pass=True)
    receipt = auditor.audit(value)

    assert receipt["verdict"] == "MISSING_ASSERTION"
    assert any(g["code"] == "MISSING_ASSERTION" and "cessation" in g["detail"].lower() for g in receipt["gaps"])
    assert not receipt_passed(value, receipt)
    assert len(model.prompts) == 1


def test_single_pass_review_incorporates_target_content_use(monkeypatch):
    """Single-pass audit enforces explicit targetContentUse classification on INCORPORATES relations without code heuristics."""
    from corrected_semantic_fixture import corrected_graph
    from structural_semantic_fixture import StructuralFixtureAuditor

    _, source, graph, _, keys = corrected_graph()
    inc_edge = next(r for r in graph["relations"] if r["kind"] == "INCORPORATES")
    unit = next(c["sourceNodeIds"][0] for c in graph["claims"] if c["claimId"] == inc_edge["fromClaimId"])
    value = audit_input(source, graph, unit, 1)

    golden_receipt = StructuralFixtureAuditor().audit(value)
    wire_args = model_response(golden_receipt, value=value)
    wire_args["omissions"] = []

    # 1. Positive control: ADOPTED_PERFORMANCE -> SUPPORTED
    model = RuleSetPreparationScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "SourceSemanticAuditVerdict",
                        "args": wire_args,
                        "id": "audit-single-pass-inc-pos",
                    }
                ],
            )
        ]
    )
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(
        usage_metering,
        "assert_model_identity",
        lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response),
    )
    auditor = SemanticAuditor(model, single_pass=True)
    receipt = auditor.audit(value)
    assert receipt["verdict"] == "SUPPORTED"
    inc_row = next(r for r in receipt["relations"] if r["id"] == inc_edge["relationId"])
    assert inc_row["sourceContentReading"] == "ADOPTED_PERFORMANCE"
    assert inc_row["checks"]["kind"] == "SUPPORTED"
    assert receipt_passed(value, receipt)

    # 2. Negative control: REFERENCE_ONLY -> WRONG_RELATION
    neg_wire_args = deepcopy(wire_args)
    sorted_rels = sorted(value["relations"], key=lambda r: r["relationId"])
    slot_idx = next(i for i, r in enumerate(sorted_rels, 1) if r["relationId"] == inc_edge["relationId"])
    slot_key = f"relation_{slot_idx}"
    neg_wire_args["relations"][slot_key]["sourceReading"]["targetContentUse"] = "REFERENCE_ONLY"

    model_neg = RuleSetPreparationScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "SourceSemanticAuditVerdict",
                        "args": neg_wire_args,
                        "id": "audit-single-pass-inc-neg",
                    }
                ],
            )
        ]
    )
    auditor_neg = SemanticAuditor(model_neg, single_pass=True)
    receipt_neg = auditor_neg.audit(value)
    assert receipt_neg["verdict"] == "WRONG_RELATION"
    inc_neg_row = next(r for r in receipt_neg["relations"] if r["id"] == inc_edge["relationId"])
    assert inc_neg_row["sourceContentReading"] == "REFERENCE_ONLY"
    assert inc_neg_row["checks"]["kind"] == "WRONG_RELATION"
    assert not receipt_passed(value, receipt_neg)



def test_single_pass_system_prompt_describes_the_slot_answer_with_omissions_and_independent_reading(monkeypatch):
    """The instruction the model reads must match the slot-keyed wire schema it is given (it once said relations stay empty)."""
    source, graph, node_id = example()
    value = audit_input(source, graph, node_id, 1)
    result = {"verdict": "SUPPORTED", "gaps": [], "omissions": [], "relations": [],
              "assertions": [{"id": "claim-one", "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS}, "verdict": "SUPPORTED", "gapCodes": []}]}
    model = RuleSetPreparationScriptedModel(responses=[AIMessage(content="", tool_calls=[{"name": "SourceSemanticAuditVerdict", "args": model_response(result), "id": "audit-prompt"}])])
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response))
    SemanticAuditor(model, single_pass=True).audit(value)
    system = model.prompts[0][0].content
    assert "omissions lists any operative legal obligations" in system
    assert "never from the candidate's label or wording" in system
    assert "relations stays an empty list" not in system


def test_cascade_receipt_without_optional_relation_audits_is_still_judged_not_crashed():
    from structural_semantic_fixture import StructuralFixtureAuditor
    source, graph, node_id = example()
    value = audit_input(source, graph, node_id, 1)
    receipt = StructuralFixtureAuditor().audit(value)
    assert receipt_passed(value, receipt)
    receipt.pop("relationAudits")
    assert receipt_passed(value, receipt)


def test_omission_must_quote_the_unit_under_review_not_a_context_source():
    import pytest
    from rule_set_preparation.semantic_audit import ground_omissions

    value = {"sourceNodeId": "unit", "sources": [{"nodeId": "unit", "content": "Operators shall  retain\neach record."}, {"nodeId": "other", "content": "Private household use is outside this scope."}]}
    ground_omissions(value, {"omissions": []})
    ground_omissions(value, {"omissions": [{"finding": "Retention is not represented.", "quote": "shall retain each record"}]})
    for bad in [{"finding": "Another unit's exclusion is not represented.", "quote": "Private household use is outside this scope."},
                {"finding": "No quote is given."}, {"finding": "Empty quote.", "quote": "  "}, {"finding": "Paraphrase.", "quote": "operators must keep records"}]:
        with pytest.raises(ValueError, match="exact passage of the unit under review"):
            ground_omissions(value, {"omissions": [bad]})
