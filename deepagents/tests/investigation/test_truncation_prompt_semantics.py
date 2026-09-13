from __future__ import annotations

import json

from tools.common.capabilities.assessment.claims.evidence_claim.evidence_ledger import EvidenceLedger
from tools.common.capabilities.assessment.investigation.engineering_rule.investigator import LawGuidedInvestigator
from tools.common.capabilities.assessment.claims.evidence_claim.models import InvestigationPacket


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


def test_investigation_prompt_requires_seeded_traces_before_closing_claims() -> None:
    payload = json.loads(LawGuidedInvestigator._prompt(_packet(), EvidenceLedger(), [], 0))
    claim_rules = " ".join(payload["claimRules"])

    assert "SUBSTRING candidate discovery only" in claim_rules
    assert "Never close MET or NOT_MET solely from search_nodes/search_program_graph" in claim_rules
    assert "trace_static_flow or inspect_data_path starts from concrete seed refs" in claim_rules
    assert "pre-executed seed observations" in claim_rules


def test_forced_finish_does_not_equate_truncation_with_unknown() -> None:
    ledger = EvidenceLedger()
    payload = json.loads(
        LawGuidedInvestigator._finish_prompt(_packet(), ledger, [])
    )
    claim_rules = " ".join(payload["claimRules"])

    assert "truncated=true" in claim_rules
    assert "already proven" in claim_rules
    assert "absenceProven=false" in claim_rules
