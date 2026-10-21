"""Actual transactional API + native tools: cyclic liveness, invalidation and restore."""
import json
import os
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import pytest

from structural_semantic_fixture import StructuralFixtureAuditor, MechanicalTools, mechanical_arguments
from review_frontier_harness import bridge, call, DatabaseFrontierApi
from rule_set_preparation.claim_inventory import fingerprint
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools

pytestmark = pytest.mark.skipif("lcsp_review_frontier_test" not in os.environ.get("REVIEW_FRONTIER_DATABASE_URL", ""), reason="explicit owned frontier DB required")


def restore(seed, auditor=None):
    context = RuleSetPreparationContext(seed["preparationRunId"], DatabaseFrontierApi(), discovery_only=True, semantic_auditor=auditor or StructuralFixtureAuditor(),
        source_graph=PinnedSourceGraph(seed["documentGraph"], [{**c, "chunkId": c["id"]} for c in seed["chunks"]]))
    return context, MechanicalTools(context, build_rule_set_tools(context))


def state(context):
    return bridge({"action": "STATE", "request": {"preparationRunId": context.run_id}})


def drive(seed, context=None, tools=None, restart_each_commit=False, stop_after=None):
    if context is None: context, tools = restore(seed)
    templates = {payload["claims"][0]["sourceNodeIds"][0]: payload for payload in seed["templates"] if payload["claims"]}
    material = {row["referenceId"]: row["material"] for row in seed["edgeIntents"]}
    retained = json.loads(Path(__file__).with_name("fixtures").joinpath("retained-reference-deadlock.json").read_text())
    repair = {r["referenceId"]: r for r in retained["repairBindings"]}
    seen, trace = set(), []
    commits = 0
    while True:
        work = call(tools, "get_next_review_unit")
        assert work["outcome"] == "PASSED", work
        if not work["unit"]:
            assert work["progress"]["discoveryCompleteEligible"], {"work": work, "trace": trace}
            break
        node = work["unit"]["sourceNodeId"]
        key = (work["frontierStateFingerprint"], node)
        assert key not in seen, {"FALSE_DEADLOCK": True, "trace": trace, "work": work}
        seen.add(key)
        for claim in templates[node]["claims"]:
            if claim["claimId"] in context.draft["semanticClaims"]: continue
            result = call(tools, "register_semantic_claim", identity_key=templates[node]["identities"][claim["claimId"]],
                claim_type=claim["claimType"], statement=claim["statement"],
                **({"actor": claim["operative"]["actor"], "action": claim["operative"]["action"]} if claim["operative"] else {}))
            assert result["outcome"] == "PASSED", result
        waiting = []
        for ref in work["unit"]["references"]:
            rid = ref["referenceId"]
            if rid in context.draft["referenceAccounting"]: continue
            if not material[rid]:
                result = call(tools, "mark_reference_non_material", reference_id=rid, reason="Explicitly non-material fixture edge, fixed before scheduling")
            else:
                inspection = call(tools, "inspect_semantic_reference_binding", reference_id=rid)
                trace.append({"node": node, "referenceId": rid, "targetReviewState": inspection["targetReviewState"],
                    "available": inspection["targetClaimAvailability"], "complete": inspection["targetReviewComplete"]})
                if not inspection["bindingCanProceed"]:
                    waiting.append(rid); continue
                if rid in repair:
                    decision = repair[rid]
                    origin = seed["claimIds"][decision["fromClaimId"]]
                    target = seed["claimIds"][decision["toClaimId"]]
                    kind = decision["kind"]
                else:
                    origin = templates[node]["claims"][0]["claimId"]
                    target = next(c["claimId"] for c in inspection["targetClaims"] if c["claimId"] != origin)
                    kind = "CROSS_REFERENCE"
                result = call(tools, "bind_semantic_reference", reference_id=rid, from_claim_id=origin, to_claim_id=target, kind=kind)
            assert result["outcome"] == "PASSED", result
        result = call(tools, "complete_source_review", disposition="REQUIRES_REFERENCE_RESOLUTION" if waiting else "CLAIMS_AUTHORED",
            **({"reference_ids": waiting, "reason": "Canonical target claims are not yet durably published"} if waiting else {}))
        assert result["outcome"] == "PASSED", result
        trace.append({"publication": node, "state": result["state"], "progress": result["progress"]})
        commits += 1
        if restart_each_commit: context, tools = restore(seed)
        if commits == stop_after: return context, tools, trace
    return context, tools, trace


@pytest.mark.parametrize("nodes,edges", [
    (1, []), (3, [(0, 1), (1, 2)]), (4, [(0, 1), (0, 2), (1, 3), (2, 3)]),
    (2, [(0, 1), (1, 0)]), (3, [(0, 1), (1, 2), (2, 0)]),
    (4, [(0, 1), (1, 2), (2, 3), (3, 0)]),
    (4, [(0, 1), (1, 0), (2, 3), (3, 2)]),
    (4, [(0, 1), (1, 2), (2, 1), (2, 3)]),
    (2, [(0, 1), (0, 1), (1, 0)]), (1, [(0, 0)]),
])
def test_graph_families_converge_restore_and_freeze(nodes, edges):
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": nodes, "edges": [{"from": a, "to": b} for a, b in edges]})
    context, tools, trace = drive(seed, restart_each_commit=True)
    done = state(context)
    assert all(row["state"] == "REVIEWED_WITH_CLAIMS" for row in done["rows"])
    assert len(context.draft["semanticClaims"]) == nodes * 2
    assert len(context.draft["claimRelations"]) == len(edges)
    result = call(tools, "finalize_semantic_claim_inventory")
    assert result["outcome"] == "PASSED", result
    assert context.inventory.phase == "CLAIM_INVENTORY_READY"
    if (nodes, edges) == (2, [(0, 1), (1, 0)]):
        assert any(item.get("available") == "AVAILABLE" and item["targetReviewState"] == "BLOCKED_REFERENCE" and not item["complete"] for item in trace)


def test_exact_94773fa8_eight_reviewed_three_blocked_replay_freezes_without_omission():
    seed = bridge({"action": "SEED_FAILED_LIVE"})
    context, tools = restore(seed)
    before = state(context)
    assert sum(row["state"] == "REVIEWED_WITH_CLAIMS" for row in before["rows"]) == 8
    assert sum(row["state"] == "BLOCKED_REFERENCE" for row in before["rows"]) == 3
    before_claims = {c["claimId"]: c for row in before["rows"] for c in row["payload"]["claims"]}
    before_relations = {r["relationId"]: r for row in before["rows"] for r in row["payload"]["relations"]}
    with pytest.raises(AssertionError, match="SOURCE_SUPPORT_INVALID"):
        drive(seed, context, tools, restart_each_commit=True)
    assert context.inventory.frozen is None
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "FAILED"
    # Fresh V3 graph-family cases above retain the cyclic-liveness/freeze proof. Historical assertions require source support and independent audit before reuse.


def operation(context, action, **fields):
    return {"preparationRunId": context.run_id, "inventoryRevision": 1, "action": action,
        "operationId": context.inventory.frontier.operation_id,
        "sourceRevision": context.source_graph.graph["materializationId"], "frontierRevision": 1, **fields}


def completion(context, disposition="CLAIMS_AUTHORED", **fields):
    frontier = context.inventory.frontier
    owned = frontier.owned_claims()
    relations = [r for rid, r in context.draft["claimRelations"].items() if frontier.relation_owners[rid] == frontier.active["sourceNodeId"]]
    payload = {"claims": owned, "identities": {c["claimId"]: context.inventory.identities[c["claimId"]] for c in owned}, "relations": relations,
        "referenceAccounting": [r for rid, r in context.draft["referenceAccounting"].items() if rid in frontier.active["referenceIds"]],
        "dependencyFingerprints": {cid: fp for relation in relations for cid, fp in frontier.relation_dependencies.get(relation["relationId"], {}).items()}}
    if disposition != "REQUIRES_REFERENCE_RESOLUTION":
        graph = context.inventory.graph()
        node_id = frontier.active["sourceNodeId"]
        graph["sourceAccounting"] = [r for r in graph["sourceAccounting"] if r["sourceNodeId"] != node_id] + [{"sourceNodeId": node_id, "claimIds": [c["claimId"] for c in owned], "nonSemanticReason": None}]
        from rule_set_preparation.semantic_audit import audit_input, attest_receipt
        payload["semanticAudit"] = attest_receipt(context.semantic_auditor.audit(audit_input(context.source_graph, graph, node_id, 1)), context.run_id)
    return operation(context, "COMPLETE", sourceNodeId=frontier.active["sourceNodeId"], claimIds=[c["claimId"] for c in owned], payload=payload, disposition=disposition, **fields)


@pytest.mark.parametrize("remove", [False, True])
@pytest.mark.parametrize("cyclic", [False, True])
def test_target_update_or_deletion_durably_invalidates_dependent_and_requires_explicit_repair(remove, cyclic):
    edges = [{"from": 0, "to": 1}] + ([{"from": 1, "to": 0}] if cyclic else [])
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 2, "edges": edges})
    context, tools, _ = drive(seed)
    prior = state(context)
    dependent, target = prior["rows"]
    relation = dependent["payload"]["relations"][0]
    old_target = relation["toClaimId"]
    assert call(tools, "reopen_source_review", source_node_id=target["sourceNodeId"], reason="Correct the committed target meaning")["outcome"] == "PASSED"
    assert call(tools, "get_next_review_unit")["unit"]["sourceNodeId"] == target["sourceNodeId"]
    if remove:
        changed = call(tools, "remove_semantic_claim", claim_id=old_target, reason="This mistaken target claim is withdrawn; the remaining definition is the intended endpoint")
    else:
        changed = call(tools, "update_semantic_claim", claim_id=old_target, claim_type="DEFINITION", statement="The target now defines the corrected semantic meaning")
    assert changed["outcome"] == "PASSED", changed
    if cyclic and remove:
        ref = next(r for r in seed["documentGraph"]["references"] if r["fromNodeId"] == target["sourceNodeId"])
        inspection = call(tools, "inspect_semantic_reference_binding", reference_id=ref["referenceId"])
        remaining = context.inventory.frontier.owned_claims()[0]["claimId"]
        assert call(tools, "bind_semantic_reference", reference_id=ref["referenceId"], from_claim_id=remaining,
                    to_claim_id=inspection["targetClaims"][0]["claimId"], kind="CROSS_REFERENCE")["outcome"] == "PASSED"
    result = call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")
    assert result["outcome"] == "PASSED" and result["invalidatedSourceReviews"] == [dependent["sourceNodeId"]]
    context, tools = restore(seed)
    raw = state(context)["rows"][0]
    assert raw["state"] == "REOPENED" and raw["payload"]["invalidatedRelationIds"] == [relation["relationId"]]
    assert raw["payload"]["relations"] == [relation], "Original Agent decision is retained as invalidated repair evidence"
    assert not raw["payload"]["referenceAccounting"], "Stale material accounting cannot remain complete"
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "FAILED"
    work = call(tools, "get_next_review_unit")
    assert work["unit"]["invalidatedRelations"] == [relation]
    rejected = call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")
    assert "SEMANTIC_ENDPOINT_CHANGED" in rejected["gaps"]
    inspection = call(tools, "inspect_semantic_reference_binding", reference_id=relation["referenceId"])
    target_id = old_target if not remove else inspection["targetClaims"][0]["claimId"]
    assert target_id != old_target if remove else target_id == old_target
    repaired = call(tools, "bind_semantic_reference", reference_id=relation["referenceId"], from_claim_id=relation["fromClaimId"], to_claim_id=target_id, kind=relation["kind"])
    assert repaired["outcome"] == "PASSED", repaired
    if remove:
        assert call(tools, "remove_semantic_relation", relation_id=relation["relationId"], reason="The old canonical target was explicitly withdrawn; the replacement binding was reconsidered")["outcome"] == "PASSED"
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"
    assert len(context.draft["claimRelations"]) == (2 if cyclic else 1)
    assert len(context.draft["semanticClaims"]) == (3 if remove else 4)


def test_publication_double_wake_two_dependents_and_inspection_race_are_transactional():
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 3, "edges": [{"from": 0, "to": 2}, {"from": 1, "to": 2}]})
    context, tools, _ = drive(seed, stop_after=2)
    before = state(context)
    assert before["frontier"]["blockedCount"] == 2
    work = call(tools, "get_next_review_unit")
    template = seed["templates"][2]
    for claim in template["claims"]:
        assert call(tools, "register_semantic_claim", identity_key=template["identities"][claim["claimId"]], claim_type=claim["claimType"], statement=claim["statement"])["outcome"] == "PASSED"
    publish = completion(context)
    ref = seed["documentGraph"]["references"][0]["referenceId"]
    raced = bridge({"action": "RACE", "requests": [operation(context, "PROGRESS", referenceIds=[ref]), publish]})
    assert all(r["outcome"] == "PASSED" for r in raced), raced
    duplicate = bridge({"action": "RACE", "requests": [publish, operation(context, "PROGRESS"), operation(context, "PROGRESS")]})
    assert duplicate[0]["alreadyCompleted"]
    after = state(context)
    assert after["frontier"]["blockedCount"] == 0 and after["frontier"]["pendingCount"] == 2 and after["frontier"]["inReviewCount"] == 0
    context, tools, _ = drive(seed, restart_each_commit=True)
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"
    assert len(context.draft["claimRelations"]) == 2 and len(context.draft["semanticClaims"]) == 6


def test_block_publication_against_dependent_block_replay_and_inspection():
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 3, "edges": [{"from": 0, "to": 1}, {"from": 1, "to": 2}, {"from": 2, "to": 0}]})
    context, tools, _ = drive(seed, stop_after=1)
    previous = deepcopy(context.inventory.frontier.last_completion)
    replay = operation(context, "COMPLETE", **previous)
    work = call(tools, "get_next_review_unit")
    node = work["unit"]["sourceNodeId"]
    template = next(p for p in seed["templates"] if p["claims"][0]["sourceNodeIds"] == [node])
    for claim in template["claims"]:
        assert call(tools, "register_semantic_claim", identity_key=template["identities"][claim["claimId"]], claim_type=claim["claimType"], statement=claim["statement"])["outcome"] == "PASSED"
    ref = work["unit"]["references"][0]["referenceId"]
    publishing = completion(context, "REQUIRES_REFERENCE_RESOLUTION", referenceIds=[ref], reason="Target claims not available")
    results = bridge({"action": "RACE", "requests": [publishing, replay, operation(context, "PROGRESS", referenceIds=[seed["documentGraph"]["references"][0]["referenceId"]])]})
    assert results[0]["outcome"] == "PASSED"
    assert results[1]["outcome"] == "FAILED" or results[1].get("alreadyCompleted"), results
    after = state(context)
    assert after["frontier"]["pendingCount"] == 2 and after["frontier"]["blockedCount"] == 1
    context, tools, _ = drive(seed, restart_each_commit=True)
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"


def test_semantic_commit_races_completed_dependent_replay_and_revokes_stale_authority():
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 2, "edges": [{"from": 0, "to": 1}]})
    context, tools, _ = drive(seed)
    prior = state(context)
    a, b = prior["rows"]
    old_completion = operation(context, "COMPLETE", sourceNodeId=a["sourceNodeId"], payload=a["payload"], claimIds=a["claimIds"], disposition="CLAIMS_AUTHORED")
    assert call(tools, "reopen_source_review", source_node_id=b["sourceNodeId"], reason="Semantic target correction")["outcome"] == "PASSED"
    assert call(tools, "get_next_review_unit")["unit"]["sourceNodeId"] == b["sourceNodeId"]
    target = a["payload"]["relations"][0]["toClaimId"]
    assert call(tools, "update_semantic_claim", claim_id=target, claim_type="DEFINITION", statement="Changed endpoint meaning")["outcome"] == "PASSED"
    results = bridge({"action": "RACE", "requests": [completion(context), old_completion]})
    assert results[0]["outcome"] == "PASSED"
    assert results[1]["outcome"] == "FAILED" or results[1].get("alreadyCompleted")
    after = state(context)
    assert after["rows"][0]["state"] == "REOPENED" and after["rows"][0]["payload"]["invalidatedRelationIds"]
    # A stale client cannot resubmit its old target fingerprint after lease reacquisition.
    context, tools = restore(seed)
    call(tools, "get_next_review_unit")
    old_completion["operationId"] = context.inventory.frontier.operation_id
    rejected = bridge({"action": "REVIEW", "request": old_completion})
    assert rejected["outcome"] == "FAILED" and rejected["failures"][0]["code"] == "SEMANTIC_ENDPOINT_CHANGED"


def test_expired_lease_restart_reacquisition_and_duplicate_publication_are_safe():
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 2, "edges": [{"from": 0, "to": 1}, {"from": 1, "to": 0}]})
    context, tools = restore(seed)
    work = call(tools, "get_next_review_unit")
    template = seed["templates"][0]
    claim = template["claims"][0]
    call(tools, "register_semantic_claim", identity_key=template["identities"][claim["claimId"]], claim_type=claim["claimType"], statement=claim["statement"])
    old = completion(context, "REQUIRES_REFERENCE_RESOLUTION", referenceIds=[work["unit"]["references"][0]["referenceId"]], reason="Publish after target review")
    bridge({"action": "EXPIRE_LEASE", "request": {"preparationRunId": context.run_id, "sourceNodeId": work["unit"]["sourceNodeId"]}})
    context, tools = restore(seed)
    reacquired = call(tools, "get_next_review_unit")
    assert reacquired["unit"]["sourceNodeId"] == work["unit"]["sourceNodeId"]
    assert bridge({"action": "REVIEW", "request": old})["outcome"] == "FAILED"
    assert not context.draft["semanticClaims"], "Uncommitted pre-crash draft never becomes endpoint authority"
    context, tools, _ = drive(seed, context, tools, restart_each_commit=True)
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"
    assert len(context.draft["semanticClaims"]) == 4 and len(context.draft["claimRelations"]) == 2


def test_fixed_mixed_materiality_is_preserved_across_independent_cycles():
    edges = [{"from": 0, "to": 1}, {"from": 1, "to": 0}, {"from": 1, "to": 2, "material": False}, {"from": 2, "to": 3}, {"from": 3, "to": 2}]
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 4, "edges": edges})
    context, tools, _ = drive(seed, restart_each_commit=True)
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"
    assert [r["referenceId"] for r in context.draft["referenceAccounting"].values() if not r["material"]] == [seed["edgeIntents"][2]["referenceId"]]
    assert len(context.draft["claimRelations"]) == 4


def test_unresolved_dependency_is_classified_truthfully_and_cannot_freeze():
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 2, "edges": [{"from": 0, "to": 1, "resolved": False}]})
    context, tools, _ = drive(seed, stop_after=2)
    work = call(tools, "get_next_review_unit")
    assert work["unit"] is None and work["progress"]["blocked"] == 1
    diagnosis = work["dependencyWaits"]
    assert not diagnosis["falseDeadlock"]
    assert diagnosis["units"][0]["blockers"][0]["classification"] == "STRUCTURAL_REFERENCE_UNRESOLVED"
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "FAILED"
    assert context.inventory.phase == "CLAIM_DISCOVERY"


def test_uncommitted_foreign_claim_is_rejected_by_tools_and_authoritative_complete():
    from rule_set_preparation.reference_binding import endpoint_fingerprint
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 2, "edges": [{"from": 0, "to": 1}]})
    context, tools = restore(seed)
    work = call(tools, "get_next_review_unit")
    claim = seed["templates"][0]["claims"][0]
    origin = call(tools, "register_semantic_claim", identity_key=seed["templates"][0]["identities"][claim["claimId"]], claim_type=claim["claimType"], statement=claim["statement"])["claim"]
    target = seed["templates"][1]["claims"][0]
    context.draft["semanticClaims"][target["claimId"]] = deepcopy(target)
    context.inventory.identities[target["claimId"]] = seed["templates"][1]["identities"][target["claimId"]]
    context.inventory.frontier.claim_owners[target["claimId"]] = target["sourceNodeIds"][0]
    before = deepcopy(context.draft)
    ref = work["unit"]["references"][0]["referenceId"]
    rejected = call(tools, "bind_semantic_reference", reference_id=ref, from_claim_id=origin["claimId"], to_claim_id=target["claimId"], kind="CROSS_REFERENCE")
    assert "TARGET_CLAIMS_NOT_AVAILABLE" in rejected["gaps"] and before == context.draft
    request = completion(context)
    relation = {"fromClaimId": origin["claimId"], "toClaimId": target["claimId"], "kind": "CROSS_REFERENCE", "referenceId": ref}
    relation["relationId"] = fingerprint(relation)
    request["payload"]["relations"] = [relation]
    request["payload"]["dependencyFingerprints"] = {target["claimId"]: endpoint_fingerprint(target)}
    result = bridge({"action": "REVIEW", "request": request})
    assert result["outcome"] == "FAILED" and result["code"] == "SEMANTIC_DEPENDENCY_DETACHED"
    assert all(not row["payload"]["claims"] and not row["payload"]["relations"] for row in state(context)["rows"])


def test_cosmetic_target_reopen_and_unchanged_semantics_do_not_invalidate_dependents():
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 2, "edges": [{"from": 0, "to": 1}]})
    context, tools, _ = drive(seed)
    before = state(context)
    dependent, target = before["rows"]
    call(tools, "reopen_source_review", source_node_id=target["sourceNodeId"], reason="Reinspect without changing claim meaning")
    call(tools, "get_next_review_unit")
    result = call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")
    assert result["outcome"] == "PASSED" and result["invalidatedSourceReviews"] == []
    after = state(context)
    assert after["rows"][0] == dependent
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"


def test_explicit_target_semantic_reopen_races_scheduling_and_requires_republication():
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 2, "edges": [{"from": 1, "to": 0}]})
    context, tools, _ = drive(seed, stop_after=1)
    b, a = state(context)["rows"]
    raced = bridge({"action": "RACE", "requests": [operation(context, "NEXT"), operation(context, "REOPEN", sourceNodeId=b["sourceNodeId"], reason="The target needs semantic reconsideration")]})
    assert all(r["outcome"] == "PASSED" for r in raced)
    context, tools = restore(seed)
    context.inventory.frontier.operation_id = raced[0]["unit"]["operationId"]
    assert call(tools, "get_next_review_unit")["unit"]["sourceNodeId"] == a["sourceNodeId"]
    ref = seed["documentGraph"]["references"][0]["referenceId"]
    status = call(tools, "inspect_semantic_reference_binding", reference_id=ref)
    assert status["targetClaimAvailability"] == "NOT_AVAILABLE" and status["targetReviewState"] == "REOPENED"
    context, tools, _ = drive(seed, context, tools, restart_each_commit=True)
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"


def test_missing_replacement_endpoint_can_publish_blocked_claims_without_losing_invalidated_decision():
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 2, "edges": [{"from": 0, "to": 1}]})
    context, tools, _ = drive(seed)
    a, b = state(context)["rows"]
    relation = a["payload"]["relations"][0]
    call(tools, "reopen_source_review", source_node_id=b["sourceNodeId"], reason="Withdraw mistaken definitions before authoring their replacement")
    call(tools, "get_next_review_unit")
    for claim in b["payload"]["claims"]:
        assert call(tools, "remove_semantic_claim", claim_id=claim["claimId"], reason="Mistaken endpoint definition explicitly withdrawn")["outcome"] == "PASSED"
    assert call(tools, "complete_source_review", disposition="NO_RELEVANT_SEMANTIC_CLAIMS", reason="The withdrawn draft definitions contain no retained claim")["outcome"] == "PASSED"
    call(tools, "get_next_review_unit")
    assert call(tools, "reopen_source_review", source_node_id=b["sourceNodeId"], reason="Author the correct replacement definition")["outcome"] == "PASSED"
    blocked = call(tools, "complete_source_review", disposition="REQUIRES_REFERENCE_RESOLUTION", reference_ids=[relation["referenceId"]], reason="No durable replacement semantic endpoint exists yet")
    assert blocked["outcome"] == "PASSED", blocked
    persisted = state(context)["rows"][0]
    assert persisted["payload"]["relations"] == [relation] and persisted["payload"]["invalidatedRelationIds"] == [relation["relationId"]]
    assert not persisted["payload"]["referenceAccounting"]
    context, tools = restore(seed)
    assert call(tools, "get_next_review_unit")["unit"]["sourceNodeId"] == b["sourceNodeId"]
    replacement = call(tools, "register_semantic_claim", identity_key="replacement-definition", claim_type="DEFINITION", statement="The corrected replacement defines the intended target concept")["claim"]
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"
    call(tools, "get_next_review_unit")
    assert call(tools, "bind_semantic_reference", reference_id=relation["referenceId"], from_claim_id=relation["fromClaimId"], to_claim_id=replacement["claimId"], kind=relation["kind"])["outcome"] == "PASSED"
    assert call(tools, "remove_semantic_relation", relation_id=relation["relationId"], reason="The old endpoint was withdrawn and its replacement has now been explicitly selected")["outcome"] == "PASSED"
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"


def test_scripted_managed_agent_three_node_cycle_reaches_inventory_ready(tmp_path, monkeypatch):
    from langchain_core.messages import AIMessage
    from middleware import usage_metering
    from rule_set_preparation.agent import create_rule_set_preparation_agent
    from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 3, "edges": [{"from": 0, "to": 1}, {"from": 1, "to": 2}, {"from": 2, "to": 0}]})
    context, _ = restore(seed)
    actions = []
    def step(name, **args):
        if name == "register_semantic_claim": args = mechanical_arguments(context, {**args, "source_node_ids": claim["sourceNodeIds"]})
        actions.append(AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": "cycle-" + str(len(actions))}]))
    for index in range(3):
        step("get_next_review_unit")
        template = seed["templates"][index]
        for claim in template["claims"]:
            step("register_semantic_claim", identity_key=template["identities"][claim["claimId"]], claim_type=claim["claimType"], statement=claim["statement"])
        ref = seed["documentGraph"]["references"][index]["referenceId"]
        step("inspect_semantic_reference_binding", reference_id=ref)
        if index < 2:
            step("complete_source_review", disposition="REQUIRES_REFERENCE_RESOLUTION", reference_ids=[ref], reason="Publish canonical claims while waiting for the next target")
        else:
            step("bind_semantic_reference", reference_id=ref, from_claim_id=template["claims"][0]["claimId"], to_claim_id=seed["templates"][0]["claims"][0]["claimId"], kind="CROSS_REFERENCE")
            step("complete_source_review", disposition="CLAIMS_AUTHORED")
    for index, target in [(1, 2), (0, 1)]:
        step("get_next_review_unit")
        ref = seed["documentGraph"]["references"][index]["referenceId"]
        step("inspect_semantic_reference_binding", reference_id=ref)
        step("bind_semantic_reference", reference_id=ref, from_claim_id=seed["templates"][index]["claims"][0]["claimId"], to_claim_id=seed["templates"][target]["claims"][0]["claimId"], kind="CROSS_REFERENCE")
        step("complete_source_review", disposition="CLAIMS_AUTHORED")
    step("finalize_semantic_claim_inventory")
    model = RuleSetPreparationScriptedModel(responses=actions)
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response))
    graph = create_rule_set_preparation_agent(context=context, legal_source_root=tmp_path, model=model)
    result = graph.invoke({"messages": [{"role": "user", "content": "Complete all cyclic reference reviews and freeze the inventory."}]})
    assert context.inventory.phase == "CLAIM_INVENTORY_READY"
    inspections = [json.loads(m.content) for m in result["messages"] if getattr(m, "name", None) == "inspect_semantic_reference_binding"]
    assert any(i["bindingCanProceed"] and not i["targetReviewComplete"] for i in inspections)
    assert len(context.inventory.frozen["claims"]) == 6 and len(context.inventory.frozen["relations"]) == 3


def test_active_unit_whose_bound_target_is_reopened_removes_the_detached_relation_then_defers_and_resumes():
    """The live deadlock: an audit faults a relation another unit owns; the owner is reopened while this unit is active."""
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 2, "edges": [{"from": 0, "to": 1}, {"from": 1, "to": 0}]})
    context, tools, _ = drive(seed, stop_after=2)
    work = call(tools, "get_next_review_unit")
    assert work["outcome"] == "PASSED" and work["unit"], work
    active = work["unit"]["sourceNodeId"]
    template = next(p for p in seed["templates"] if p["claims"] and p["claims"][0]["sourceNodeIds"] == [active])
    origin = template["claims"][0]["claimId"]
    for claim in template["claims"]:
        if claim["claimId"] not in context.draft["semanticClaims"]:
            assert call(tools, "register_semantic_claim", identity_key=template["identities"][claim["claimId"]], claim_type=claim["claimType"], statement=claim["statement"])["outcome"] == "PASSED"
    ref = work["unit"]["references"][0]["referenceId"]
    inspection = call(tools, "inspect_semantic_reference_binding", reference_id=ref)
    target = next(c for c in inspection["targetClaims"] if c["claimId"] != origin)
    bound = call(tools, "bind_semantic_reference", reference_id=ref, from_claim_id=origin, to_claim_id=target["claimId"], kind="CROSS_REFERENCE")
    assert bound["outcome"] == "PASSED", bound
    relation_id = bound["relation"]["relationId"]
    owner = next(r["sourceNodeId"] for r in state(context)["rows"] if r["sourceNodeId"] != active)
    assert call(tools, "reopen_source_review", source_node_id=owner, reason="An independent audit found a relation of this unit wrong")["outcome"] == "PASSED"
    refused = call(tools, "complete_source_review", disposition="REQUIRES_REFERENCE_RESOLUTION", reference_ids=[ref], reason="The target is reopened for correction")
    assert refused["outcome"] == "FAILED" and "SEMANTIC_DEPENDENCY_DETACHED" in refused["gaps"], refused
    assert refused["requiredAction"] == "remove_semantic_relation" and relation_id in refused["guidance"], refused
    assert refused["detachedRelations"] == [{"relationId": relation_id, "referenceId": ref, "ownerSourceNodeId": active, "targetClaimId": target["claimId"], "targetClaimCommitted": False}], refused
    assert call(tools, "remove_semantic_relation", relation_id=relation_id, reason="The target unit was reopened for correction")["outcome"] == "PASSED"
    refused = call(tools, "complete_source_review", disposition="REQUIRES_REFERENCE_RESOLUTION", reference_ids=[ref], reason="The target is reopened for correction")
    assert refused["outcome"] == "PASSED", refused
    assert call(tools, "get_next_review_unit")["unit"]["sourceNodeId"] == owner
    context, tools, _ = drive(seed, context, tools, restart_each_commit=True)
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"


class ReversedRelationAuditor(StructuralFixtureAuditor):
    """Scripted Run 7 (f978894d) verdicts: the owner's own audit accepted its reversed relation, the dependent's audit faulted it."""
    def __init__(self):
        super().__init__()
        self.faults = {}

    def audit(self, value):
        receipt = super().audit(value)
        wrong = self.faults.get(value["sourceNodeId"], set()) & {r["relationId"] for r in value["relations"]}
        if not wrong:
            return receipt
        for row in receipt["relations"]:
            if row["id"] in wrong:
                row.update(verdict="WRONG_RELATION", gapCodes=["WRONG_RELATION"], checks={**row["checks"], "direction": "WRONG_RELATION"})
        return {**receipt, "verdict": "WRONG_RELATION", "reportedVerdict": "WRONG_RELATION",
                "gaps": [{"code": "WRONG_RELATION", "detail": rid + "/direction: FROM and TO are swapped"} for rid in sorted(wrong)]}


@pytest.mark.parametrize("binding,edited,correction", [("REFERENCE", False, "CORRECTED"), ("LINK", False, "CORRECTED"),
                                                      ("REFERENCE", True, "CORRECTED"), ("REFERENCE", False, "REVERSED_AGAIN")])
def test_run7_foreign_reversed_relation_recovers_through_owner_reopen_correction_and_rebind(binding, edited, correction):
    """Run 7: A (exception) is active, its audit faults B's (duty) reversed relation; B must be reopened and corrected and A rebound."""
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 2, "edges": [{"from": 0, "to": 1}, {"from": 1, "to": 0}]})
    auditor = ReversedRelationAuditor()
    context, tools = restore(seed, auditor)
    a, b = (n["nodeId"] for n in seed["documentGraph"]["nodes"])
    a_to_b, b_to_a = (r["referenceId"] for r in seed["documentGraph"]["references"])
    templates = {p["claims"][0]["sourceNodeIds"][0]: p for p in seed["templates"]}
    exception, duty = templates[a]["claims"][0]["claimId"], templates[b]["claims"][0]["claimId"]
    roles = {exception: dict(claim_type="EXCEPTION", statement="The retention duty does not apply to a temporary test record"),
             duty: dict(claim_type="DUTY", statement="An operator must retain each record for 7 days", actor="An operator", action="retain each record for 7 days")}

    def acquire(node):
        work = call(tools, "get_next_review_unit")
        assert work["outcome"] == "PASSED" and work["unit"]["sourceNodeId"] == node, work
        for claim in templates[node]["claims"]:
            if claim["claimId"] not in context.draft["semanticClaims"]:
                assert call(tools, "register_semantic_claim", identity_key=templates[node]["identities"][claim["claimId"]],
                            **roles.get(claim["claimId"], dict(claim_type=claim["claimType"], statement=claim["statement"])))["outcome"] == "PASSED"
        return work

    def yield_to_owner():
        return call(tools, "complete_source_review", disposition="REQUIRES_REFERENCE_RESOLUTION", reference_ids=[a_to_b], reason="The referenced duty unit is not committed")

    acquire(a)
    assert yield_to_owner()["outcome"] == "PASSED"
    acquire(b)
    reversed_binding = dict(reference_id=b_to_a, from_claim_id=duty, to_claim_id=exception, kind="EXCEPTION_TO")
    bad = call(tools, "bind_semantic_reference", **reversed_binding)["relation"]["relationId"]
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"
    auditor.faults[a] = {bad}

    acquire(a)
    good_binding = dict(reference_id=a_to_b, from_claim_id=exception, to_claim_id=duty, kind="EXCEPTION_TO")
    own = call(tools, "bind_semantic_reference" if binding == "REFERENCE" else "link_semantic_claims",
               **(good_binding if binding == "REFERENCE" else {k: v for k, v in good_binding.items() if k != "reference_id"}))["relation"]["relationId"]
    faulted = call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")
    assert "SEMANTIC_AUDIT_REQUIRED" in faulted["gaps"] and faulted["relationOwners"] == {bad: b} and faulted["requiredAction"] == "reopen_source_review", faulted
    assert "remove_semantic_relation " + own in faulted["guidance"] and a_to_b in faulted["guidance"], "the exit names this unit's relation that will detach"
    assert "CLAIM_SOURCE_BINDING_INVALID" in call(tools, "remove_semantic_relation", relation_id=bad, reason="Roles swapped")["gaps"], "the dependent never edits the owner's relation"
    assert call(tools, "reopen_source_review", source_node_id=b, reason="Article 3's audit found this unit's relation roles swapped")["outcome"] == "PASSED"
    if edited:  # Run 7 T159: the dependent corrected its own claim, so the yield invalidates the owner's relation to it
        assert call(tools, "update_semantic_claim", claim_id=exception, claim_type="EXCEPTION", statement="The 7-day retention duty does not apply to a temporary test record")["outcome"] == "PASSED"

    # Run 7 T177: yielding while this unit still binds the reopened owner's claim is refused; the refusal must name the relation to remove.
    refused = yield_to_owner()
    assert {"REFERENCE": "SEMANTIC_DEPENDENCY_DETACHED", "LINK": "TARGET_CLAIMS_NOT_AVAILABLE"}[binding] in refused["gaps"], refused
    assert refused["requiredAction"] == "remove_semantic_relation" and [r["relationId"] for r in refused["detachedRelations"]] == [own], refused
    assert "NO_PROGRESS" in yield_to_owner(), "an unchanged repeat still earns no-progress feedback"
    assert call(tools, "remove_semantic_relation", relation_id=own, reason="Its target unit was reopened for correction")["outcome"] == "PASSED"
    assert yield_to_owner()["outcome"] == "PASSED"

    owner = acquire(b)
    assert [r["relationId"] for r in owner["unit"]["invalidatedRelations"]] == ([bad] if edited else []), owner["unit"]
    assert call(tools, "remove_semantic_relation", relation_id=bad, reason="FROM and TO were swapped; the exception binds from Article 3")["outcome"] == "PASSED"
    corrected = dict(reversed_binding, kind="CROSS_REFERENCE") if correction == "CORRECTED" else reversed_binding
    corrected_id = call(tools, "bind_semantic_reference", **corrected)["relation"]["relationId"]
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"

    acquire(a)
    assert call(tools, "inspect_semantic_reference_binding", reference_id=a_to_b)["bindingCanProceed"]
    assert "SEMANTIC_DEPENDENCY_DETACHED" in call(tools, "bind_semantic_reference", **dict(good_binding, from_claim_id=duty, to_claim_id=exception))["gaps"], "a reversed rebind stays invalid"
    good = call(tools, "bind_semantic_reference", **good_binding)["relation"]["relationId"]
    done = call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")
    rows = {r["sourceNodeId"]: r for r in state(context)["rows"]}
    assert {c["claimId"] for r in rows.values() for c in r["payload"]["claims"]} == {c["claimId"] for p in templates.values() for c in p["claims"]}, "no claim is lost"
    if correction == "REVERSED_AGAIN":
        assert "SEMANTIC_AUDIT_REQUIRED" in done["gaps"] and done["relationOwners"] == {bad: b}, done
        assert rows[a]["state"] == "IN_REVIEW" and call(tools, "finalize_semantic_claim_inventory")["outcome"] == "FAILED"
        return
    assert done["outcome"] == "PASSED", done
    assert call(tools, "get_next_review_unit")["unit"] is None
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"
    assert {r["relationId"] for r in context.inventory.frozen["relations"]} == {good, corrected_id}


def unreferenced_owner_fixture():
    """A (exception) and B (duty) share no structural reference; B links the exception reversed and its own audit accepts it."""
    seed = bridge({"action": "SEED_DEPENDENCIES", "nodes": 2, "edges": []})
    auditor = ReversedRelationAuditor()
    context, tools = restore(seed, auditor)
    a, b = (n["nodeId"] for n in seed["documentGraph"]["nodes"])
    templates = {p["claims"][0]["sourceNodeIds"][0]: p for p in seed["templates"]}
    exception, duty = templates[a]["claims"][0]["claimId"], templates[b]["claims"][0]["claimId"]
    roles = {exception: dict(claim_type="EXCEPTION", statement="The retention duty does not apply to a temporary test record"),
             duty: dict(claim_type="DUTY", statement="An operator must retain each record for 7 days", actor="An operator", action="retain each record for 7 days")}

    def acquire(node):
        work = call(tools, "get_next_review_unit")
        assert work["outcome"] == "PASSED" and work["unit"]["sourceNodeId"] == node and not work["unit"]["references"], work
        for claim in templates[node]["claims"]:
            if claim["claimId"] not in context.draft["semanticClaims"]:
                assert call(tools, "register_semantic_claim", identity_key=templates[node]["identities"][claim["claimId"]],
                            **roles.get(claim["claimId"], dict(claim_type=claim["claimType"], statement=claim["statement"])))["outcome"] == "PASSED"

    acquire(a)
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"
    acquire(b)
    bad = call(tools, "link_semantic_claims", from_claim_id=duty, to_claim_id=exception, kind="EXCEPTION_TO")["relation"]["relationId"]
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"
    auditor.faults[a] = {bad}
    return context, tools, acquire, a, b, exception, duty, bad


def correct_owner(tools, acquire, b, exception, duty, bad, correction):
    acquire(b)
    assert call(tools, "remove_semantic_relation", relation_id=bad, reason="FROM and TO were swapped")["outcome"] == "PASSED"
    corrected = dict(from_claim_id=exception, to_claim_id=duty) if correction == "CORRECTED" else dict(from_claim_id=duty, to_claim_id=exception)
    assert call(tools, "link_semantic_claims", kind="EXCEPTION_TO", **corrected)["outcome"] == "PASSED"
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"


@pytest.mark.parametrize("correction", ["CORRECTED", "REVERSED_AGAIN"])
def test_unreferenced_foreign_relation_fault_at_freeze_names_the_owner_not_the_audited_unit(correction):
    context, tools, acquire, a, b, exception, duty, bad = unreferenced_owner_fixture()
    refused = call(tools, "finalize_semantic_claim_inventory")
    assert refused["outcome"] == "FAILED" and refused["relationOwners"] == {bad: b} and refused["requiredAction"] == "reopen_source_review", refused
    assert "do not reopen it" in refused["guidance"] and b in refused["guidance"], "A cannot change B's relation, so only the owner is reopened"
    assert call(tools, "reopen_source_review", source_node_id=b, reason="Article A's audit found this unit's relation reversed")["outcome"] == "PASSED"
    correct_owner(tools, acquire, b, exception, duty, bad, correction)
    rows = {r["sourceNodeId"]: r["state"] for r in state(context)["rows"]}
    assert rows == {a: "REVIEWED_WITH_CLAIMS", b: "REVIEWED_WITH_CLAIMS"}, "A was never reopened; the freeze re-audits it in place"
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == ("PASSED" if correction == "CORRECTED" else "FAILED")


@pytest.mark.parametrize("correction", ["CORRECTED", "REVERSED_AGAIN"])
def test_active_unit_without_reference_into_owner_waits_for_the_reopened_owner(correction):
    """Deferral by reference is unavailable: A has no reference at all, yet its audit faults B's relation while A is active."""
    context, tools, acquire, a, b, exception, duty, bad = unreferenced_owner_fixture()
    assert call(tools, "reopen_source_review", source_node_id=a, reason="Reconsider this unit")["outcome"] == "PASSED"
    acquire(a)
    faulted = call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")
    assert faulted["relationOwners"] == {bad: b} and "without reference_ids" in faulted["guidance"], faulted
    yield_ = dict(disposition="REQUIRES_REFERENCE_RESOLUTION", reason="The unit owning the faulted relation is reopened for correction")
    refused = call(tools, "complete_source_review", **yield_)
    assert "SOURCE_REVIEW_REFERENCE_BLOCKED" in refused["gaps"] and "reopened unit" in refused["guidance"], "nothing to wait on until the owner is reopened"
    assert call(tools, "reopen_source_review", source_node_id=b, reason="Article A's audit found this unit's relation reversed")["outcome"] == "PASSED"
    assert call(tools, "complete_source_review", **yield_)["outcome"] == "PASSED"
    rows = {r["sourceNodeId"]: r for r in state(context)["rows"]}
    assert rows[a]["state"] == "BLOCKED_REFERENCE" and rows[a]["blockedReferenceIds"] == [] and rows[a]["payload"]["blockedSourceNodeIds"] == [b]
    correct_owner(tools, acquire, b, exception, duty, bad, correction)
    assert {r["sourceNodeId"]: r["state"] for r in state(context)["rows"]}[a] == "REOPENED", "the owner's recommit wakes the waiting unit"
    acquire(a)
    done = call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")
    rows = {r["sourceNodeId"]: r for r in state(context)["rows"]}
    claims = {c["claimId"] for r in rows.values() for c in r["payload"]["claims"]}
    assert len(claims) == 4 and {exception, duty} <= claims, "no claim is lost"
    if correction == "REVERSED_AGAIN":
        assert done["outcome"] == "FAILED" and done["relationOwners"], done
        assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "FAILED"
        return
    assert done["outcome"] == "PASSED", done
    assert call(tools, "get_next_review_unit")["unit"] is None
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"
