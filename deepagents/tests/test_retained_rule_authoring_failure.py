"""Immutable pre-V3 authoring failures are evidence, never fabricated source-audit acceptance.

The former applicability-only positive repairs could freeze unsupported semantics. V3 positive convergence,
19 semantic invariants, rejection recovery and cyclic liveness now use the corrected same-source graph.
Source evidence and recorded authoring observations are preserved.
"""
from copy import deepcopy
import retained_rule_authoring_harness as H
from claim_protocol_harness import bridge, call
from semantic_pipeline_harness import pipeline_context

FX = H.load()
FROZEN = FX["frozenInventory"]["graph"]
CLAIMS = {c["claimId"]: c for c in FROZEN["claims"]}


def test_retained_inventory_has_normative_claims_but_no_assertion_that_can_ground_applicability():
    assert len(CLAIMS) == 38 and len(FROZEN["relations"]) == 14
    assert sum(c["operative"] is not None for c in CLAIMS.values()) == 17
    assert not any(c["claimType"] in {"SCOPE", "CONDITION"} for c in CLAIMS.values())


def test_exact_historical_inventory_is_rejected_before_freeze_for_missing_source_support():
    _, ctx, _, _ = H.restore()
    result = bridge({'action': 'INVENTORY', 'runId': ctx.run_id, 'source': ctx.api.source,
        'revision': 1, 'graph': FROZEN, 'identities': ctx.inventory.identities})
    assert result['outcome'] == 'FAILED'
    assert any(f['code'] == 'SOURCE_SUPPORT_INVALID' for f in result['failures'])


def test_historical_frozen_inventory_has_actionable_read_only_feedback_and_cannot_mutate_or_validate():
    _, ctx, tools, _ = H.restore()
    before = deepcopy(ctx.draft)
    result = call(tools, "author_legal_requirement", requirement_key="R", title="t", operative_claim_ids=[next(c for c in CLAIMS if CLAIMS[c]["operative"])], applicability_claim_ids=[])
    assert result["outcome"] == "FAILED" and "CLAIM_PHASE_INVALID" in result["gaps"]
    assert result["requiredAction"] == "reopen_semantic_claim_inventory"
    assert ctx.draft == before and ctx.validation_calls == 0


def test_v3_applicability_readiness_still_refuses_a_structurally_complete_but_unusable_inventory():
    ctx, _, _, _ = pipeline_context()
    graph = deepcopy(ctx.inventory.frozen)
    removed = {c["claimId"] for c in graph["claims"] if c["claimType"] in {"SCOPE", "CONDITION"}}
    graph["claims"] = [c for c in graph["claims"] if c["claimId"] not in removed]
    graph["relations"] = [r for r in graph["relations"] if not {r["fromClaimId"], r["toClaimId"]} & removed]
    for review in graph["sourceAccounting"]:
        review["claimIds"] = [cid for cid in review["claimIds"] if cid not in removed]
    result = bridge({"action": "INVENTORY", "source": ctx.api.source, "runId": ctx.run_id, "revision": 1, "graph": graph,
                     "identities": {k:v for k,v in ctx.inventory.identities.items() if k not in removed}})
    assert result["outcome"] == "FAILED"
    assert any(f["code"] == "APPLICABILITY_AUTHORITY_MISSING" for f in result["failures"])


def test_model_facing_surface_states_the_applicability_requirement_where_the_model_reads_it():
    from test_rule_set_preparation_agent import INSTRUCTIONS
    _, _, tools, _ = H.restore()
    text = ' '.join(INSTRUCTIONS.split())
    for phrase in ('Only SCOPE and CONDITION claims', 'Applicability is its own claim', 'APPLICABILITY_AUTHORITY_MISSING'):
        assert phrase in text
    assert 'APPLICABILITY_AUTHORITY_MISSING' in tools['finalize_semantic_claim_inventory'].description
