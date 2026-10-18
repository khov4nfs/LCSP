"""Immutable pre-V3 authoring failures are evidence, never fabricated source-audit acceptance.

The former applicability-only positive repairs could freeze unsupported semantics. V3 positive convergence,
19 semantic invariants, rejection recovery and cyclic liveness now use the corrected same-source graph.
The original fixtures and their historical observations remain byte-identical.
"""
from copy import deepcopy
import retained_rule_authoring_harness as H
from claim_protocol_harness import bridge, call
from rule_set_preparation.semantic_audit import audit_input
from structural_semantic_fixture import StructuralFixtureAuditor
from semantic_pipeline_harness import pipeline_context
from semantic_fidelity_harness import bridge as semantic_bridge

FX = H.load()
FROZEN = FX["frozenInventory"]["graph"]
CLAIMS = {c["claimId"]: c for c in FROZEN["claims"]}


def test_retained_inventory_has_normative_claims_but_no_assertion_that_can_ground_applicability():
    assert len(CLAIMS) == 38 and len(FROZEN["relations"]) == 14
    assert sum(c["operative"] is not None for c in CLAIMS.values()) == 17
    assert not any(c["claimType"] in {"SCOPE", "CONDITION"} for c in CLAIMS.values())


def test_exact_historical_inventory_is_rejected_before_freeze_for_missing_source_support_and_audit():
    _, ctx, _, _ = H.restore()
    failures = semantic_bridge("GATE", ctx.source_graph, FROZEN)
    assert {"SOURCE_SUPPORT_INVALID", "SEMANTIC_AUDIT_REQUIRED"} <= {f["code"] for f in failures}
    assert len([f for f in failures if f["code"] == "SOURCE_SUPPORT_INVALID"]) == 38


def test_historical_frozen_inventory_has_actionable_read_only_feedback_and_cannot_mutate_or_validate():
    _, ctx, tools, _ = H.restore()
    before = deepcopy(ctx.draft)
    result = call(tools, "author_legal_requirement", requirement_key="R", title="t", operative_claim_ids=[next(c for c in CLAIMS if CLAIMS[c]["operative"])], applicability_claim_ids=[])
    assert result["outcome"] == "FAILED" and "SEMANTIC_AUDIT_REQUIRED" in result["gaps"]
    assert result["requiredAction"] == "reopen_semantic_claim_inventory"
    assert ctx.draft == before and ctx.validation_calls == 0


def test_v3_applicability_readiness_still_refuses_a_structurally_complete_but_unusable_inventory():
    ctx, _, _, _ = pipeline_context(StructuralFixtureAuditor())
    graph = deepcopy(ctx.inventory.frozen)
    removed = {c["claimId"] for c in graph["claims"] if c["claimType"] in {"SCOPE", "CONDITION"}}
    graph["claims"] = [c for c in graph["claims"] if c["claimId"] not in removed]
    graph["relations"] = [r for r in graph["relations"] if not {r["fromClaimId"], r["toClaimId"]} & removed]
    for review in graph["sourceAccounting"]:
        review["claimIds"] = [cid for cid in review["claimIds"] if cid not in removed]
    graph["semanticAudits"] = [StructuralFixtureAuditor().audit(audit_input(ctx.source_graph, graph, r["sourceNodeId"], 1)) for r in graph["sourceAccounting"]]
    result = bridge({"action": "INVENTORY", "source": ctx.api.source, "runId": ctx.run_id, "revision": 1, "graph": graph,
                     "identities": {k:v for k,v in ctx.inventory.identities.items() if k not in removed}})
    assert result["outcome"] == "FAILED"
    assert any(f["code"] == "APPLICABILITY_AUTHORITY_MISSING" for f in result["failures"])


def test_model_facing_surface_states_the_applicability_requirement_where_the_model_reads_it():
    """The live model must write SCOPE/CONDITION claims unprompted; the requirement is stated in instructions AND in the tool schemas."""
    from rule_set_preparation.agent import INSTRUCTIONS
    _, _, tools, _ = H.restore()
    text = " ".join(INSTRUCTIONS.split())
    for phrase in ("Only SCOPE and CONDITION claims can ground a Requirement's applicability", "never leave the trigger only inside the DUTY text", "APPLICABILITY_AUTHORITY_MISSING",
                   "reopen_source_review each owning unit", "no later phase can add a missing one", "A DEFINITION, CONTEXT, TEMPORAL_RULE or any normative claim never counts as applicability"):
        assert phrase in text, phrase
    register = tools["register_semantic_claim"].args_schema["properties"]["claim_type"]["description"]
    assert "SCOPE = whom or what" in register and "CONDITION = a trigger" in register and "cannot be finalized without one" in register
    assert "APPLICABILITY_AUTHORITY_MISSING" in tools["finalize_semantic_claim_inventory"].description and "reopen_source_review" in tools["finalize_semantic_claim_inventory"].description
