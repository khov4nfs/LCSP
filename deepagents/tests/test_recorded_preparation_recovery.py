"""Replay committed evidence only; never fabricate verdicts or resume an agent graph."""
import json
from copy import deepcopy
from pathlib import Path

from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools


def test_recorded_frontier_rehydrates_both_claims_and_independent_receipts_without_inference():
    file = Path(__file__).parents[2] / "reports/lcsp360-final-release-20261021/final-acceptance/run-forensics-20261023/postgres-read-only-snapshot.json"
    snapshot = json.loads(file.read_text())
    bundle = snapshot["bundle"]

    class ReadOnlyReplay:
        def source_review_operation(self, run_id, revision, action, **fields):
            assert run_id == snapshot["run"]["id"] and revision == 1
            assert action in {"INIT", "LOAD"}, "A recovery read cannot mutate retained state"
            frontier = snapshot["frontier"]
            return {"outcome": "PASSED", "sourceRevision": frontier["materializationId"],
                    "frontierRevision": frontier["revision"], "frontierFingerprint": frontier["fingerprint"],
                    "frontierStateFingerprint": frontier["stateFingerprint"],
                    "records": deepcopy(snapshot["reviews"]) if action == "LOAD" else [], "nextOffset": None}

    class NoInference:
        def audit(self, *_args, **_kwargs):
            raise AssertionError("Committed-evidence recovery must not dispatch an Auditor")

    source = PinnedSourceGraph(bundle["documentGraph"], [
        {**c, "chunkId": c["id"], "documentId": d["documentId"], "legalSourceVersionId": bundle["legalSourceVersionId"]}
        for d in bundle["documents"] for c in d["chunks"]
    ])
    for _ in range(2):  # Fresh process-equivalent context, not a conversation checkpoint.
        context = RuleSetPreparationContext(snapshot["run"]["id"], ReadOnlyReplay(),
                                           source_graph=source, semantic_auditor=NoInference())
        build_rule_set_tools(context)
        frontier = context.inventory.frontier
        assert frontier.restore(force=True) is None
        completed = [r for r in snapshot["reviews"] if r["state"] == "REVIEWED_WITH_CLAIMS"]
        expected_claims = {c["claimId"]: c for r in completed for c in r["payload"]["claims"]}
        assert context.draft["semanticClaims"] == expected_claims
        assert set(context.draft["sourceAccounting"]) == {r["sourceNodeId"] for r in completed}
        assert context.semantic_audits == {r["sourceNodeId"]: r["payload"]["semanticAudit"] for r in completed}
        assert len(expected_claims) == len(context.semantic_audits) == 2
        assert frontier.active is None and context.submission is None
    active = next(r for r in snapshot["reviews"] if r["state"] == "IN_REVIEW")
    assert not active["payload"]["claims"]
