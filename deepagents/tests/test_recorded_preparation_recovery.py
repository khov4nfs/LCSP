"""Provider-free recovery mechanics over authored unit fixtures, never acceptance evidence."""
import json
from copy import deepcopy
import pytest

from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools


@pytest.mark.parametrize("completed_count", [1, 5])
def test_frontier_rehydrates_committed_evidence_and_counts_without_inference(completed_count):
    from semantic_pipeline_harness import authoring_fixture

    fixture = authoring_fixture()
    graph = fixture["frozenInventory"]["graph"]
    claims = {c["claimId"]: c for c in graph["claims"]}
    audits = {a["sourceNodeId"]: a for a in graph["semanticAudits"]}
    reviews = [{"sourceNodeId": r["sourceNodeId"], "state": "REVIEWED_WITH_CLAIMS", "claimIds": r["claimIds"], "reason": None,
                "payload": {"claims": [claims[cid] for cid in r["claimIds"]],
                            "identities": fixture["frozenInventory"]["identities"], "relations": [], "referenceAccounting": [],
                            "semanticAudit": audits[r["sourceNodeId"]]}}
               for r in graph["sourceAccounting"][:completed_count]]
    reviews.append({"sourceNodeId": graph["sourceAccounting"][completed_count]["sourceNodeId"], "state": "IN_REVIEW", "claimIds": [],
                    "payload": {"claims": [], "identities": {}, "relations": [], "referenceAccounting": []}})

    class ReadOnlyReplay:
        def source_review_operation(self, run_id, revision, action, **fields):
            assert run_id == fixture["preparationId"] and revision == 1
            assert action in {"INIT", "LOAD"}, "A recovery read cannot mutate retained state"
            return {"outcome": "PASSED", "sourceRevision": graph["materializationId"],
                    "frontierRevision": 1, "frontierFingerprint": "a" * 64, "frontierStateFingerprint": "b" * 64,
                    "progress": {"total": len(graph["sourceAccounting"]), "reviewedWithClaims": completed_count, "reviewedNoClaims": 0},
                    "records": deepcopy(reviews) if action == "LOAD" else [], "nextOffset": None}

    class NoInference:
        def audit(self, *_args, **_kwargs):
            raise AssertionError("Committed-evidence recovery must not dispatch an Auditor")

    source = PinnedSourceGraph(fixture["graph"], fixture["chunks"])
    for _ in range(2):  # Fresh process-equivalent context, not a conversation checkpoint.
        context = RuleSetPreparationContext(fixture["preparationId"], ReadOnlyReplay(),
                                           source_graph=source, semantic_auditor=NoInference())
        tools = {tool.name: tool for tool in build_rule_set_tools(context)}
        frontier = context.inventory.frontier
        assert frontier.restore(force=True) is None
        completed = [r for r in reviews if r["state"] == "REVIEWED_WITH_CLAIMS"]
        expected_claims = {c["claimId"]: c for r in completed for c in r["payload"]["claims"]}
        assert context.draft["semanticClaims"] == expected_claims
        assert set(context.draft["sourceAccounting"]) == {r["sourceNodeId"] for r in completed}
        assert context.semantic_audits == {r["sourceNodeId"]: r["payload"]["semanticAudit"] for r in completed}
        assert len(context.semantic_audits) == len(completed)
        inventory = json.loads(tools["get_claim_inventory"].invoke({"kind": "CLAIMS"}))
        assert (inventory["sourceNodesReviewed"], inventory["sourceNodesRemaining"]) == (
            len(completed), len(graph["sourceAccounting"]) - len(completed))
        assert frontier.active is None and context.submission is None
    active = next(r for r in reviews if r["state"] == "IN_REVIEW")
    assert not active["payload"]["claims"]
