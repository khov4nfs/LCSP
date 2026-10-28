"""Deterministic graph/artifact invariants. Committed fixtures exercise structural invariants."""
from copy import deepcopy

import pytest
from claim_protocol_harness import call
from rule_set_preparation.authoring_rejections import draft_fingerprint
from rule_set_preparation.semantic_closure import semantic_closure
from semantic_pipeline_harness import pipeline_context, author_all


@pytest.fixture(scope="module")
def verified():
    return pipeline_context()


def test_every_anchor_has_identical_python_api_closure_and_no_unrelated_role_pool_binding(verified):
    import json
    import subprocess
    from pathlib import Path
    ctx, _, _, _ = verified
    graph = ctx.inventory.frozen
    anchors = [c['claimId'] for c in graph['claims'] if c['operative'] and c['semanticAuthority'] == 'LEGAL_NORMATIVE']
    script = """import {readFileSync} from 'node:fs';
import {semanticClosure} from './apps/api/src/modules/compliance-rule-set/domain/source-completeness.ts';
const {graph, anchors} = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(anchors.map(id => semanticClosure(graph, id))));"""
    result = subprocess.run(['pnpm', 'exec', 'tsx', '-e', script], cwd=Path(__file__).resolve().parents[2],
        input=json.dumps({'graph': graph, 'anchors': anchors}), capture_output=True, text=True, check=True)
    assert json.loads(result.stdout) == [semantic_closure(graph, anchor) for anchor in anchors]


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
        "STRUCTURAL_HIERARCHY": len(graph["sourceAccounting"]) == 14 and all(r["claimIds"] or r["nonSemanticReason"] for r in graph["sourceAccounting"]),
        "REFERENCE_RESOLUTION": len(graph["referenceAccounting"]) == 11 and any(edge("portability.prohibition", "exception.transfer", "INCORPORATES") for _ in [0]),
        "CLAIM_ACCOUNTING": bound == {c["claimId"] for c in graph["claims"] if c["state"] == "RELEVANT"},
        "LEGITIMATE_NARROWING": bool(parents("safeguards")) and all(set(a["legalRequirementIds"]) <= assessable for a in packet["assessmentRules"]),
        "SEMANTIC_AGGREGATION": parents("audit.authorization") == parents("audit.outcome") and len(parents("audit.authorization")) == 1,
    }


def test_corrected_same_source_graph_reaches_real_validator_submission_and_nineteen_artifact_invariants():
    ctx, tools, api, keys = pipeline_context()
    author_all(ctx, tools, keys)
    validation = call(tools, "validate_compliance_rule_set")
    assert validation["outcome"] == "PASSED", validation
    result = call(tools, "submit_compliance_rule_set")
    assert result["preparationState"] == "SUCCEEDED" and api.submitted
    review = artifact_review(api.submitted, keys)
    assert len(review) == 19 and all(review.values()), review
    assert len(ctx.draft["legalRequirements"]) == 16 and len(ctx.draft["assessmentRules"]) == 13
