"""Deterministic orchestration policy layered over the code-context investigator."""
from __future__ import annotations

import json
from typing import Any

from lcsp_workers.platform.logging import get_logger

from .code_context_investigator import CodeContextLawGuidedInvestigator
from .evidence_ledger import EvidenceLedger
from .models import EvidenceClaim, InvestigationPacket


logger = get_logger(__name__)


class DeterministicCodeContextLawGuidedInvestigator(CodeContextLawGuidedInvestigator):
    """Prefer orchestrator-owned seed traces and natural finish over exploratory paging.

    The base investigator remains responsible for tool execution/provenance. This policy
    changes only orchestration guidance and termination telemetry; it does not move any
    compliance authority into the LLM.
    """

    @classmethod
    def _code_prompt(
        cls,
        packet: InvestigationPacket,
        ledger: EvidenceLedger,
        working_results: list[dict[str, Any]],
        step: int,
    ) -> str:
        payload = json.loads(super()._code_prompt(packet, ledger, working_results, step))
        deterministic_trace_count = sum(
            1
            for row in packet.initial_results
            if isinstance(row, dict)
            and row.get("phase") == "DETERMINISTIC_SELECTED_RULE_TRACE"
        )
        payload["deterministicOrchestration"] = {
            "selectedRuleTraceCount": deterministic_trace_count,
            "policy": [
                "Treat DETERMINISTIC_SELECTED_RULE_TRACE observations as the first bounded path evidence to evaluate; do not rediscover the same start nodes.",
                "The native tool list is not a checklist. Use another tool only when it can resolve a named requiredEvidence criterion that current observations do not resolve.",
                "If current graph/source observations already resolve every requiredEvidence criterion, call finish on this turn instead of paging more observations.",
                "Do not repeat a tool with materially equivalent arguments after an error or after its observation has already been consumed.",
                "When a concrete unresolved frontier affects a criterion, finish that criterion as UNRESOLVED rather than repeatedly probing the same boundary.",
            ],
        }
        return cls._render_prompt(payload)

    @staticmethod
    def _log_finish(
        *,
        packet: InvestigationPacket,
        claims: list[EvidenceClaim],
        workflow_run_id: str,
        correlation_id: str | None,
        forced: bool,
        ledger: EvidenceLedger,
    ) -> None:
        CodeContextLawGuidedInvestigator._log_finish(
            packet=packet,
            claims=claims,
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
            forced=forced,
            ledger=ledger,
        )
        logger.info(
            "ENGINEERING_INVESTIGATION_TERMINATION",
            engineering_rule_id=packet.engineering_rule_id,
            termination_mode=("BUDGET_EXHAUSTED_FINISH" if forced else "NATURAL_FINISH"),
            deterministic_trace_count=sum(
                1
                for row in packet.initial_results
                if isinstance(row, dict)
                and row.get("phase") == "DETERMINISTIC_SELECTED_RULE_TRACE"
            ),
            ledger_observation_count=ledger.total,
            workflow_run_id=workflow_run_id,
            correlationId=correlation_id,
        )
