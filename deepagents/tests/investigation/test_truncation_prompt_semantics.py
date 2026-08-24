from __future__ import annotations

import json

from tools.planner.investigation.evidence_ledger import EvidenceLedger
from tools.planner.investigation.investigator import LawGuidedInvestigator
from tools.planner.investigation.models import InvestigationPacket


def _packet() -> InvestigationPacket:
    return InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="HUMAN_OVERSIGHT",
        investigation_goals=("Find the relevant control",),
        initial_results=(),
        required_evidence=("CONTROL_STATE",),
    )


def test_investigation_prompt_treats_truncated_as_search_state_only() -> None:
    ledger = EvidenceLedger()
    ledger.add(
        source="graph_tool",
        result={
            "nodes": [{"node_id": "node-1", "evidence_refs": ["evidence:1"]}],
            "truncated": True,
            "continuationFrontiers": ["node-2"],
            "unresolvedFrontiers": [],
            "evidenceRefs": ["evidence:1"],
        },
    )

    payload = json.loads(LawGuidedInvestigator._prompt(_packet(), ledger, [], 0))
    claim_rules = " ".join(payload["claimRules"])

    assert "result.truncated" in claim_rules
    assert "not an unresolved engineering fact by itself" in claim_rules
    assert "continuationFrontiers" in claim_rules
    assert "max_hops" in claim_rules
    assert "max_results" in claim_rules


def test_forced_finish_does_not_equate_truncation_with_unknown() -> None:
    ledger = EvidenceLedger()
    payload = json.loads(
        LawGuidedInvestigator._finish_prompt(_packet(), ledger, [])
    )
    claim_rules = " ".join(payload["claimRules"])

    assert "truncated=true" in claim_rules
    assert "already proven" in claim_rules
