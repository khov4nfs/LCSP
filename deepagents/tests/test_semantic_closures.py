"""Deterministic graph/artifact invariants. Scripted receipts prove mechanics, never verifier quality."""
from copy import deepcopy

import pytest
from claim_protocol_harness import call
from rule_set_preparation.authoring_rejections import draft_fingerprint
from rule_set_preparation.semantic_audit import audit_input, receipt_current
from rule_set_preparation.semantic_closure import semantic_closure
from semantic_fidelity_harness import bridge
from semantic_pipeline_harness import pipeline_context, author_all
from structural_semantic_fixture import StructuralFixtureAuditor


@pytest.fixture(scope="module")
def verified():
    return pipeline_context(StructuralFixtureAuditor())


def test_every_anchor_has_identical_python_api_closure_and_no_unrelated_role_pool_binding(verified):
    ctx, _, _, keys = verified
    graph = ctx.inventory.frozen
    for c in graph["claims"]:
        if c["operative"] and c["semanticAuthority"] == "LEGAL_NORMATIVE":
            assert bridge("CLOSURE", ctx.source_graph, graph, anchorId=c["claimId"]) == semantic_closure(graph, c["claimId"])


def test_global_role_compatible_temporal_binding_is_refused_without_draft_mutation(verified):
    ctx, tools, _, keys = verified
    before = draft_fingerprint(ctx.draft)
    anchor = keys["configuration.service"]["claimId"]
    view = call(tools, "get_semantic_closure", operative_claim_ids=[anchor])
    bad = {**view["authoringArguments"], "qualifier_claim_ids": [keys["temporal.new"]["claimId"]]}
    result = call(tools, "author_legal_requirement", requirement_key="R-wrong-temporal", title="Incorrect temporal target", **bad)
    assert result["outcome"] == "FAILED" and "SEMANTIC_CLOSURE_INVALID" in result["gaps"]
    assert draft_fingerprint(ctx.draft) == before
    assert ctx.rejection_log[-1]["draftUnchanged"]


@pytest.mark.parametrize("field,value", [("statement", "Different assertion"), ("assessability", "MIXED"), ("semanticAuthority", "CONTEXT")])
def test_semantic_mutation_invalidates_independent_receipt(verified, field, value):
    ctx, _, _, keys = verified
    graph = deepcopy(ctx.inventory.frozen)
    target = next(c for c in graph["claims"] if c["claimId"] == keys["export.software"]["claimId"])
    unit = target["sourceNodeIds"][0]
    receipt = next(r for r in graph["semanticAudits"] if r["sourceNodeId"] == unit)
    target[field] = value
    assert not receipt_current(audit_input(ctx.source_graph, graph, unit, 1), receipt)
    assert any(f["code"] == "SEMANTIC_AUDIT_REQUIRED" for f in bridge("GATE", ctx.source_graph, graph))


def test_review_history_is_bound_to_current_question_and_final_operation_in_python_and_api(verified):
    """Synthetic provenance trace, not an independent source-law verdict."""
    from uuid import uuid4
    from rule_set_preparation.semantic_audit import assertion_input, digest, receipt_passed
    ctx, _, _, _ = verified
    graph = deepcopy(ctx.inventory.frozen)
    receipt = graph["semanticAudits"][0]
    value = audit_input(ctx.source_graph, graph, receipt["sourceNodeId"], 1)
    receipt["reviewHistory"] = [{"inputFingerprint": digest(assertion_input(value, receipt["sourceCatalog"])), "initialOperationId": str(uuid4()),
        "initialVerdict": "WRONG_ACTOR", "initialGaps": [{"code": "WRONG_ACTOR", "detail": "Scripted provenance-only finding"}],
        "reviewOperationId": receipt["verifierOperationId"], "reviewVerdict": "SUPPORTED", "reviewGaps": []}]
    assert receipt_passed(value, receipt)
    assert not bridge("GATE", ctx.source_graph, graph)
    receipt["reviewHistory"][0]["reviewOperationId"] = str(uuid4())
    assert not receipt_passed(value, receipt)
    assert any(f["code"] == "SEMANTIC_AUDIT_REQUIRED" for f in bridge("GATE", ctx.source_graph, graph))


def artifact_review(packet, keys):
    """Independent assertions on resulting artifacts and typed graph; no prose golden Rule Set."""
    graph = packet["semanticGraph"]
    reqs = packet["legalRequirements"]
    by_claim = {c["claimId"]: c for c in graph["claims"]}
    cid = lambda k: keys[k]["claimId"]
    parents = lambda key: [r for r in reqs if any(b["claimId"] == cid(key) and b["role"] == "OPERATIVE_PROPOSITION" for b in r["claimBindings"])]
    edge = lambda origin, target, kind: any(r["fromClaimId"] == cid(origin) and r["toClaimId"] == cid(target) and r["kind"] == kind for r in graph["relations"])
    bound = {b["claimId"] for r in reqs for b in r["claimBindings"]}
    assessable = {r["legalRequirementId"] for r in reqs if r["coverage"]["state"] == "COVERED_BY_ASSESSMENT_RULES"}
    return {
        "DEFINITIONS": all(c["claimId"] in bound for c in graph["claims"] if c["claimType"] == "DEFINITION"),
        "DIRECT_DUTY": bool(parents("export.software") and parents("export.delivery")) and parents("export.software") != parents("export.delivery"),
        "PROHIBITION": bool(parents("portability.prohibition")),
        "QUALIFIER": edge("qualifier.purpose", "portability.prohibition", "QUALIFIES") and bool(keys["qualifier.purpose"]["semanticFrame"]["qualifier"]),
        "CONDITION": edge("condition.request", "export.delivery", "CONDITION_OF") and edge("condition.incident-ended", "access.end", "CONDITION_OF") and bool(parents("access.end")),
        "COMPENSATION": all(r["nonRepositoryDuty"] and r["legalRequirementId"] not in assessable and r["coverage"]["state"] == "NON_ASSESSABLE" for r in parents("compensation.payment")),
        "EXCEPTION": edge("exception.transfer", "portability.prohibition", "EXCEPTION_TO") and all(edge("exception.transfer", k, "PRESERVES") for k in ["export.software", "export.delivery"]),
        "TEMPORAL_TRANSITION": all(edge(t, k, "TEMPORALLY_APPLIES_TO") for t in ["temporal.existing", "temporal.new"] for k in ["export.software", "export.delivery", "portability.prohibition"]) and not edge("temporal.new", "configuration.service", "TEMPORALLY_APPLIES_TO") and all(keys[t]["semanticFrame"]["scope"] and keys[t]["semanticFrame"]["temporalApplicability"] for t in ["temporal.existing", "temporal.new"]),
        "CROSS_REFERENCE": all(r["material"] and r["relationIds"] for r in graph["referenceAccounting"]),
        "CONTEXT_VS_NORMATIVE": not parents("guidance.encryption") and all(not parents(k) for k in ["context.no-automatic-control", "context.beneficiary"]),
        "ACTOR_DIRECTION": keys["delegation.configuration"]["operative"]["actor"] == "Actor A" and keys["delegation.path"]["operative"]["actor"] == "Actor B" and edge("condition.direction", "delegation.path", "CONDITION_OF"),
        "DELEGATED_FULFILLMENT": edge("provider.delivery", "export.delivery", "INCORPORATES") and edge("preserves.operator", "export.delivery", "PRESERVES") and bool(parents("provider.delivery")),
        "EVIDENCE_NO_SHADOW_LAW": keys["guidance.encryption"]["semanticAuthority"] == "EVIDENCE_GUIDANCE" and edge("guidance.encryption", "safeguards", "EVIDENCE_SLICE_OF") and not parents("guidance.encryption"),
        "PROVENANCE": all(c["sourceSupport"] for c in graph["claims"]) and all(r["sourceRefs"] for r in reqs),
        "STRUCTURAL_HIERARCHY": len(graph["sourceAccounting"]) == 11 and all(r["claimIds"] for r in graph["sourceAccounting"]),
        "REFERENCE_RESOLUTION": len(graph["referenceAccounting"]) == 11 and any(edge("portability.prohibition", "exception.transfer", "INCORPORATES") for _ in [0]),
        "CLAIM_ACCOUNTING": bound == {c["claimId"] for c in graph["claims"] if c["state"] == "RELEVANT"},
        "LEGITIMATE_NARROWING": bool(parents("safeguards")) and all(set(a["legalRequirementIds"]) <= assessable for a in packet["assessmentRules"]),
        "SEMANTIC_AGGREGATION": parents("audit.authorization") == parents("audit.outcome") and len(parents("audit.authorization")) == 1,
    }


def test_corrected_same_source_graph_reaches_real_validator_submission_and_nineteen_artifact_invariants():
    ctx, tools, api, keys = pipeline_context(StructuralFixtureAuditor())
    author_all(ctx, tools, keys)
    validation = call(tools, "validate_compliance_rule_set")
    assert validation["outcome"] == "PASSED", validation
    result = call(tools, "submit_compliance_rule_set")
    assert result["preparationState"] == "SUCCEEDED" and api.submitted
    review = artifact_review(api.submitted, keys)
    assert len(review) == 19 and all(review.values()), review
    assert len(ctx.draft["legalRequirements"]) == 16 and len(ctx.draft["assessmentRules"]) == 13
