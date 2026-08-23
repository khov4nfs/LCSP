"""Deterministic orchestration policy layered over the code-context investigator."""
from __future__ import annotations

import hashlib
import json
from contextvars import ContextVar
from dataclasses import replace
from typing import Any

from lcsp_workers.llm import LLMToolCall, LLMToolResponse
from lcsp_workers.platform.logging import get_logger

from .code_context import CodeContextSession
from .code_context_investigator import (
    CODE_CONTEXT_TOOL_NAMES,
    CodeContextLawGuidedInvestigator,
)
from .evidence_ledger import EvidenceLedger
from .investigator import FINISH_TOOL_NAME, GRAPH_TOOL_NAMES
from .models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
    InvestigationPacket,
)


logger = get_logger(__name__)
_TERMINATION_MODE: ContextVar[str | None] = ContextVar(
    "engineering_investigation_termination_mode",
    default=None,
)
_REPEAT_LIMIT_INSPECT_OBSERVATION = 2
_REPEAT_LIMIT_OTHER_TOOL = 1


class _ProgressBoundLLMClient:
    """Drop repeated native actions before they can burn the investigator turn budget.

    The EvidenceLedger already retains every prior result. Repeating the same graph/code
    action cannot create new repository evidence, while repeated ``inspect_observation``
    calls receive one compatibility retry because the base investigator can auto-advance
    an omitted offset. If a model turn contains only stale actions, the orchestrator
    deterministically finishes the rule as unresolved instead of waiting for step eight.
    """

    def __init__(self, delegate, packet: InvestigationPacket) -> None:
        self._delegate = delegate
        self._packet = packet
        self._seen: dict[str, int] = {}

    def complete(
        self,
        prompt: str,
        workflow_run_id: str,
        node_name: str,
        max_tokens: int | None = None,
        correlationId: str | None = None,
    ):
        return self._delegate.complete(
            prompt,
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            max_tokens=max_tokens,
            correlationId=correlationId,
        )

    def complete_with_tools(self, prompt: str, **kwargs) -> LLMToolResponse:
        response = self._delegate.complete_with_tools(prompt=prompt, **kwargs)
        if kwargs.get("node_name") == "investigate_engineering_rule_finish":
            return response
        if not response.tool_calls:
            return response

        retained: list[LLMToolCall] = []
        dropped: list[dict[str, Any]] = []
        for call in response.tool_calls:
            if call.name == FINISH_TOOL_NAME:
                retained.append(call)
                continue

            signature = self._signature(call)
            prior_count = self._seen.get(signature, 0)
            repeat_limit = (
                _REPEAT_LIMIT_INSPECT_OBSERVATION
                if call.name == "inspect_observation"
                else _REPEAT_LIMIT_OTHER_TOOL
            )
            if prior_count >= repeat_limit:
                dropped.append(
                    {
                        "tool": call.name,
                        "call_id": call.call_id,
                        "repeat_count": prior_count + 1,
                    }
                )
                continue

            self._seen[signature] = prior_count + 1
            retained.append(call)

        if dropped:
            logger.info(
                "ENGINEERING_INVESTIGATION_STALE_TOOL_CALLS_DROPPED",
                engineering_rule_id=self._packet.engineering_rule_id,
                dropped_count=len(dropped),
                dropped=dropped[:12],
                retained_count=len(retained),
                workflow_run_id=kwargs.get("workflow_run_id"),
                correlationId=kwargs.get("correlationId"),
            )

        if retained:
            return replace(response, tool_calls=tuple(retained))

        _TERMINATION_MODE.set("NO_PROGRESS_FINISH")
        logger.info(
            "ENGINEERING_INVESTIGATION_NO_PROGRESS_GATE",
            engineering_rule_id=self._packet.engineering_rule_id,
            stale_tool_call_count=len(dropped),
            workflow_run_id=kwargs.get("workflow_run_id"),
            correlationId=kwargs.get("correlationId"),
        )
        return replace(
            response,
            tool_calls=(
                LLMToolCall(
                    name=FINISH_TOOL_NAME,
                    arguments={
                        "claims": [
                            {
                                "criterion": criterion,
                                "claimType": ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
                                "observationRefs": [],
                                "confidence": 0.0,
                                "limitations": [
                                    ENGINEERING_LIMITATION_CODES[
                                        "engineering_evidence_insufficient"
                                    ],
                                    ENGINEERING_LIMITATION_CODES[
                                        "search_coverage_incomplete"
                                    ],
                                ],
                            }
                            for criterion in self._packet.required_evidence
                        ]
                        or [
                            {
                                "criterion": "UNRESOLVED_REQUIRED_EVIDENCE",
                                "claimType": ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
                                "observationRefs": [],
                                "confidence": 0.0,
                                "limitations": [
                                    ENGINEERING_LIMITATION_CODES[
                                        "engineering_evidence_insufficient"
                                    ],
                                    ENGINEERING_LIMITATION_CODES[
                                        "search_coverage_incomplete"
                                    ],
                                ],
                            }
                        ]
                    },
                    call_id="orchestrator:no-progress-finish",
                ),
            ),
        )

    def complete_structured(self, prompt: str, **kwargs):
        return self._delegate.complete_structured(prompt=prompt, **kwargs)

    @staticmethod
    def _signature(call: LLMToolCall) -> str:
        arguments = json.dumps(
            call.arguments,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )
        return f"{call.name}:{arguments}"


class DeterministicCodeContextLawGuidedInvestigator(CodeContextLawGuidedInvestigator):
    """Prefer orchestrator-owned seed traces and natural finish over exploratory paging.

    The base investigator remains responsible for tool execution/provenance. This policy
    adds a deterministic progress gate around native model actions and fail-closes any
    orchestrator-forced finish to unresolved claims. It does not move compliance authority
    into the LLM.
    """

    def investigate(
        self,
        *,
        packet: InvestigationPacket,
        graph,
        workflow_run_id: str,
        correlation_id: str | None = None,
        code_context: CodeContextSession | None = None,
    ) -> list[EvidenceClaim]:
        token = _TERMINATION_MODE.set(None)
        try:
            guarded = type(self)(_ProgressBoundLLMClient(self.llm, packet))
            return CodeContextLawGuidedInvestigator.investigate(
                guarded,
                packet=packet,
                graph=graph,
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
                code_context=code_context,
            )
        finally:
            _TERMINATION_MODE.reset(token)

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
                "LCSP deterministically drops repeated native actions and will fail closed to UNRESOLVED when a turn contains only stale work.",
            ],
        }
        return cls._render_prompt(payload)

    @staticmethod
    def _forced_unresolved_claims(
        packet: InvestigationPacket,
        claims: list[EvidenceClaim],
    ) -> list[EvidenceClaim]:
        """Prevent step/no-progress forced finish from closing a compliance criterion."""
        required = tuple(dict.fromkeys(packet.required_evidence))
        if not required:
            required = tuple(
                dict.fromkeys(
                    claim.criterion for claim in claims if claim.criterion
                )
            )
        if not required:
            required = ("UNRESOLVED_REQUIRED_EVIDENCE",)

        result: list[EvidenceClaim] = []
        for criterion in required:
            source = next(
                (claim for claim in claims if claim.criterion == criterion),
                None,
            )
            seed = f"{packet.engineering_rule_id}:{criterion}:forced-unresolved"
            result.append(
                EvidenceClaim(
                    claim_id=(
                        f"{source.claim_id}:forced-unresolved"
                        if source is not None
                        else "claim:"
                        + hashlib.sha256(seed.encode()).hexdigest()[:24]
                    ),
                    engineering_rule_id=packet.engineering_rule_id,
                    claim_type=ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
                    value=None,
                    evidence_refs=(source.evidence_refs if source is not None else ()),
                    graph_path_refs=(
                        source.graph_path_refs if source is not None else ()
                    ),
                    source_anchor_refs=(
                        source.source_anchor_refs if source is not None else ()
                    ),
                    confidence=0.0,
                    limitations=tuple(
                        dict.fromkeys(
                            (
                                *((source.limitations if source is not None else ())),
                                ENGINEERING_LIMITATION_CODES[
                                    "engineering_evidence_insufficient"
                                ],
                                ENGINEERING_LIMITATION_CODES[
                                    "search_coverage_incomplete"
                                ],
                            )
                        )
                    ),
                    criterion=(
                        criterion
                        if criterion in packet.required_evidence
                        else None
                    ),
                )
            )
        return result

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
        termination_mode = _TERMINATION_MODE.get()
        effective_forced = forced or termination_mode == "NO_PROGRESS_FINISH"
        if effective_forced:
            claims[:] = DeterministicCodeContextLawGuidedInvestigator._forced_unresolved_claims(
                packet,
                claims,
            )

        CodeContextLawGuidedInvestigator._log_finish(
            packet=packet,
            claims=claims,
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
            forced=effective_forced,
            ledger=ledger,
        )
        logger.info(
            "ENGINEERING_INVESTIGATION_TERMINATION",
            engineering_rule_id=packet.engineering_rule_id,
            termination_mode=(
                termination_mode
                or ("BUDGET_EXHAUSTED_FINISH" if forced else "NATURAL_FINISH")
            ),
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
