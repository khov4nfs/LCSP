"""Deterministic policy for native code-context EngineeringRule investigation."""
from __future__ import annotations

import json
from typing import Any

from .code_context_investigator import CodeContextLawGuidedInvestigator
from tools.common.capabilities.assessment.claims.evidence_claim.evidence_ledger import EvidenceLedger
from tools.common.capabilities.assessment.claims.evidence_claim.models import InvestigationPacket


class DeterministicCodeContextLawGuidedInvestigator(
    CodeContextLawGuidedInvestigator
):
    """Prioritize orchestrator-selected traces before native agent exploration."""

    @classmethod
    def _code_prompt(
        cls,
        packet: InvestigationPacket,
        ledger: EvidenceLedger,
        working_results: list[dict[str, Any]],
        step: int,
    ) -> str:
        payload = json.loads(
            super()._code_prompt(packet, ledger, working_results, step)
        )
        payload["deterministicOrchestration"] = {
            "selectedRuleTraceCount": sum(
                1
                for row in packet.initial_results
                if isinstance(row, dict)
                and row.get("phase") == "DETERMINISTIC_SELECTED_RULE_TRACE"
            ),
            "policy": [
                "Evaluate deterministic selected-rule traces before additional retrieval.",
                "Use native tools only to resolve a named requiredEvidence criterion.",
                "Do not repeat materially equivalent tool calls.",
                "Return UNRESOLVED when bounded evidence cannot resolve a criterion.",
            ],
        }
        return cls._render_prompt(payload)
