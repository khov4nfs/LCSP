"""Gate accepted PGE evidence through Initial Interview before EngineeringRule work."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from orchestration.dispatcher import RootSubagentDispatcher
from orchestration.result_validation import SpecialistHandoffValidationError
from subagents.interview.customer_safe_projection import MAX_LISTED_ALLOWED_REFS
from decision.shadow import InterviewRoutingPacket, observer_from_api_client
from tools.common.capabilities.platform.api_client import InterviewCoverageCallbackError

from .engineering_assessment_boundary import EngineeringAssessmentBoundary
from tools.common.capabilities.assessment.planning.engineering_rule.confirmed_business_context import (
    ConfirmedStructuredBusinessContext,
    normalize_confirmed_structured_business_context,
)


_LOGGER = logging.getLogger(__name__)

_TERMINAL_WAITING_OUTCOMES = {
    "WAITING_FOR_CUSTOMER",
    "BLOCKED_OR_UNRESOLVED",
    "FAILED",
}

# Typed runtime activities for a technical gap. Recovery is an explicit rescan through the
# scan rerun API (customer/operator action), never a model decision.
AI_DISCOVERY_UNRESOLVED = "AI_DISCOVERY_UNRESOLVED"
TECHNICAL_COVERAGE_RECOVERY_REQUIRED = "TECHNICAL_COVERAGE_RECOVERY_REQUIRED"

_CANONICAL_COVERAGE_STATES = {
    "READY": "READY",
    "SUFFICIENT": "READY",
    "PARTIAL": "PARTIAL",
    "LIMITED": "PARTIAL",
    "UNAVAILABLE": "UNAVAILABLE",
}


class InterviewGatedEngineeringAssessmentBoundary(EngineeringAssessmentBoundary):
    """Production accepted-evidence boundary with decision-before-downstream Interview gating."""

    def __init__(
        self,
        *args: Any,
        interview_dispatcher: Any | None = None,
        **kwargs: Any,
    ) -> None:
        # One dispatcher serves both the Interview gate and the per-rule analyst tasks.
        kwargs.setdefault("dispatcher", interview_dispatcher)
        super().__init__(*args, **kwargs)
        self._interview_dispatcher = interview_dispatcher

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        evidence_report_id = self._evidence_report_id(message)
        evidence_report = self._get_accepted_evidence_report(evidence_report_id)
        assessment_id = str(
            evidence_report.get("assessment_id")
            or evidence_report.get("assessmentId")
            or message.get("assessmentId")
            or message.get("assessment_id")
            or ""
        )
        if not assessment_id:
            raise ValueError("accepted evidence report is missing assessment_id")

        workflow_run_id = self._workflow_run_id(
            message,
            evidence_report,
            evidence_report_id,
        )
        confirmed_context = self._prepare_interview(
            evidence_report=evidence_report,
            evidence_report_id=evidence_report_id,
            assessment_id=assessment_id,
            correlation_id=correlationId,
            workflow_run_id=workflow_run_id,
        )
        if confirmed_context is None:
            return
        rule_scope = message.get("ruleScope")
        self.run_assessment(
            message,
            correlationId,
            confirmed_context=confirmed_context,
            rule_scope=tuple(str(item) for item in rule_scope) if isinstance(rule_scope, list) else None,
        )

    def _prepare_interview(
        self,
        *,
        evidence_report: dict[str, Any],
        evidence_report_id: str,
        assessment_id: str,
        correlation_id: str,
        workflow_run_id: str | None = None,
    ) -> ConfirmedStructuredBusinessContext | None:
        coverage_state, coverage_notes = _technical_coverage(evidence_report)
        ai_discovery = _ai_discovery(evidence_report)

        # Customer authority is part of the absence closure. Load persisted Interview
        # state before evaluating the Scanner/PGE no-AI gate so a later repository-only
        # scan cannot erase already confirmed external/off-repository AI context.
        state = self._api_client.get_interview_worker_state(assessment_id)
        outcome = str(state.get("outcome") or "")
        context_revision = int(state.get("contextRevision") or 0)
        active_question = state.get("activeQuestion")
        authoritative_customer_ai = _has_authoritative_customer_ai_context(state)

        # The no-AI fast path is governed Scanner/PGE truth, not an Interview/LLM
        # conclusion. It is valid only when technical coverage is READY and there is no
        # authoritative Customer confirmation of AI usage outside repository evidence.
        if ai_discovery and ai_discovery.get("gate") == "AI_ABSENT_CONFIRMED":
            if coverage_state == "READY" and ai_discovery.get("coverage_state") == "READY":
                if not authoritative_customer_ai:
                    # Terminal outcome: without it the assessment waits forever for an
                    # Initial Interview question that is never asked.
                    self._api_client.post_assessment_ai_not_detected(
                        assessment_id,
                        {"technicalEvidenceReportId": evidence_report_id},
                    )
                    return None

        if not _can_start_initial_interview(coverage_state, coverage_notes, evidence_report):
            self._emit_technical_limitation(
                evidence_report, TECHNICAL_COVERAGE_RECOVERY_REQUIRED, coverageState=coverage_state
            )
            return None

        # Scanner/PGE-owned AI uncertainty is an independent upstream fact: the gate stays
        # UNKNOWN, aiDetected stays pending (deterministic applicability marks gated rules
        # UPSTREAM_FACT_PENDING) and ungated rules still run. No model decides recovery.
        if ai_discovery and ai_discovery.get("gate") == "AI_UNKNOWN" and _has_technical_ai_uncertainty(ai_discovery):
            self._emit_technical_limitation(evidence_report, AI_DISCOVERY_UNRESOLVED, coverageState=coverage_state)

        if outcome == "CONTEXT_READY":
            return normalize_confirmed_structured_business_context(
                state,
                assessment_id=assessment_id,
            )

        # UC-M04-01 A1: existing Customer context can be evaluated without a
        # synthetic first question/answer. Never interrupt a pending Customer or Agent turn.
        existing_context = state.get("confirmedContext")
        reviewing_existing_context = (
            outcome == "WAITING_FOR_CUSTOMER"
            and active_question is None
            and state.get("orchestrationRequested") is not True
            and isinstance(existing_context, dict)
            and bool(existing_context.get("statements"))
        )
        if not reviewing_existing_context and outcome in _TERMINAL_WAITING_OUTCOMES and (
            active_question is not None
            or context_revision > 0
            or outcome != "WAITING_FOR_CUSTOMER"
        ):
            return None

        if outcome != "WAITING_FOR_CUSTOMER" or (context_revision != 0 and not reviewing_existing_context):
            return None

        from uuid import UUID
        from orchestration.context import LCSPRunContext
        from subagents.interview.customer_safe_projection import (
            TurnEvidenceLedger,
            build_why_are_we_asking_explanation,
            evaluate_question_eligibility,
            evidence_ref_correction_reason,
            extract_governed_evidence_refs,
            reset_active_turn_evidence_ledger,
            sanitize_customer_facing_text,
            set_active_turn_evidence_ledger,
            unauthorized_candidate_refs,
            validate_evidence_refs,
        )

        if not workflow_run_id or not str(workflow_run_id).strip():
            raise ValueError(
                "Initial Interview requires a valid workflowRunId from orchestration"
            )
        valid_wf_id = str(workflow_run_id).strip()
        if correlation_id and valid_wf_id == correlation_id:
            raise ValueError(
                "workflowRunId cannot be identical to correlationId"
            )


        authenticated_actor_id = (
            str(state.get("authenticatedActorId") or "").strip()
            or str(state.get("actorId") or "").strip()
            or str(state.get("userId") or "").strip()
            or str(evidence_report.get("user_id") or "").strip()
            or str(evidence_report.get("userId") or "").strip()
            or str(evidence_report.get("ownerId") or "").strip()
            or str(evidence_report.get("owner_id") or "").strip()
        )
        if not authenticated_actor_id:
            raise ValueError("Initial Interview requires a trusted authenticated principal / user_id")

        snapshot_id = str(
            evidence_report.get("snapshotId")
            or evidence_report.get("snapshot_id")
            or ""
        )

        initial_decision_key = f"assessment-interview-initial:{assessment_id}:{evidence_report_id}"
        if reviewing_existing_context:
            # Do not replay the first (revision-0) question when evaluating existing
            # context that has since been confirmed. Same revision still deduplicates.
            initial_decision_key += f":context:{context_revision}"

        run_context = LCSPRunContext(
            assessment_id=assessment_id,
            user_id=authenticated_actor_id,
            workflow_run_id=valid_wf_id,
            artifact_versions={
                "technicalEvidenceReportId": evidence_report_id,
                "repositorySnapshotId": snapshot_id,
                "sourceVersion": str(
                    evidence_report.get("sourceVersion")
                    or evidence_report.get("source_version")
                    or "1.0.0"
                ),
                "pgeVersion": str(
                    evidence_report.get("pgeVersion")
                    or evidence_report.get("pge_version")
                    or "2.0.0"
                ),
                "guidanceVersion": str(
                    evidence_report.get("guidanceVersion")
                    or evidence_report.get("guidance_version")
                    or "1.0.0"
                ),
            },
            idempotency_key=initial_decision_key,
        )

        initial_refs = {
            f"technicalEvidenceReport:{evidence_report_id}",
            f"repositorySnapshot:{snapshot_id}",
            "interviewRuntime:assessment-interview-runtime-v1",
        }
        initial_refs.update(extract_governed_evidence_refs(evidence_report))
        ledger = TurnEvidenceLedger(
            initial_authorized_refs=initial_refs,
            initial_coverage_state=coverage_state,
            initial_coverage_limitations=coverage_notes,
        )
        handoff = (
            _ai_discovery_handoff(
                assessment_id=assessment_id,
                evidence_report_id=evidence_report_id,
                evidence_report=evidence_report,
                ai_discovery=ai_discovery,
            )
            if ai_discovery and not reviewing_existing_context
            else None
        )
        # The exact set the API persists and accepts (AssessmentProvenanceSnapshot
        # .governedEvidenceRefs). Question refs must be copied verbatim from it.
        persistable_refs = _persistable_evidence_refs(evidence_report, evidence_report_id)

        def _require_persistable_initial_decision(candidate: Any) -> dict[str, Any]:
            if not isinstance(candidate, dict):
                raise ValueError("Initial Interview specialist did not return a validated handoff")
            if candidate.get("outcome") == "CONTEXT_READY":
                if candidate.get("activeQuestion") is not None:
                    raise SpecialistHandoffValidationError("CONTEXT_READY cannot contain an activeQuestion")
                if not reviewing_existing_context:
                    raise SpecialistHandoffValidationError(
                        "CONTEXT_READY requires existing Customer-confirmed context; technical evidence is not Customer authority"
                    )
                if any(candidate.get(key) for key in ("contextUpdates", "unresolved", "flags")):
                    raise SpecialistHandoffValidationError(
                        "Zero-question completion must reuse existing context without new facts or unresolved business assumptions"
                    )
                proposed_context = candidate.get("confirmedContext")
                if proposed_context not in (None, {}, {"statements": []}) and proposed_context != existing_context:
                    raise SpecialistHandoffValidationError(
                        "Zero-question completion cannot replace existing Customer-confirmed statements"
                    )
                return candidate
            if candidate.get("outcome") != "WAITING_FOR_CUSTOMER" or not isinstance(
                candidate.get("activeQuestion"), dict
            ):
                raise ValueError(
                    "Initial Interview requires either CONTEXT_READY or a focused Customer question"
                )
            if not isinstance(candidate["activeQuestion"].get("frontier"), dict):
                raise ValueError("Initial Interview question candidate requires frontier metadata")
            rejected = unauthorized_candidate_refs(candidate["activeQuestion"], persistable_refs)
            if rejected:
                raise SpecialistHandoffValidationError(
                    evidence_ref_correction_reason(rejected, persistable_refs)
                )
            return candidate

        if handoff is None:
            instruction = _initial_interview_instruction(
                assessment_id=assessment_id,
                evidence_report_id=evidence_report_id,
                evidence_report=evidence_report,
                allowed_evidence_refs=persistable_refs,
                current_confirmed_context=existing_context if reviewing_existing_context else None,
            )
            idempotency_key = initial_decision_key
            dispatcher = self._interview_dispatcher or RootSubagentDispatcher()

            def _dispatch_initial(instruction: str, idempotency_key: str) -> dict[str, Any]:
                ledger_token = set_active_turn_evidence_ledger(ledger)
                try:
                    result = dispatcher.dispatch(
                        subagent_type="interview",
                        instruction=instruction,
                        idempotency_key=idempotency_key,
                        trigger="TECHNICAL_EVIDENCE_ACCEPTED",
                        metadata={
                            "assessment_id": assessment_id,
                            "technical_evidence_report_id": evidence_report_id,
                            "correlationId": correlation_id,
                        },
                        thread_id=f"interview:{assessment_id}",
                        context=run_context,
                    )
                finally:
                    reset_active_turn_evidence_ledger(ledger_token)
                return _require_persistable_initial_decision(
                    result.get("handoff") if isinstance(result, dict) else None
                )

            try:
                handoff = _dispatch_initial(instruction, idempotency_key)
            except SpecialistHandoffValidationError as exc:
                # A missing/malformed handoff or an inexact evidence ref is a
                # candidate-shape failure. Give the specialist one bounded correction
                # naming the exact rule it broke (as the resume boundary does); a
                # second failure propagates. Refs are never dropped or substituted.
                _LOGGER.warning(
                    "INTERVIEW_INITIAL_HANDOFF_VALIDATION_REPAIRED assessment_id=%s reason=%s",
                    assessment_id,
                    str(exc)[:300],
                )
                handoff = _dispatch_initial(
                    _initial_schema_correction_instruction(instruction, exc),
                    f"{idempotency_key}:schema-correction:1",
                )
        else:
            handoff = _require_persistable_initial_decision(handoff)

        if handoff.get("outcome") == "CONTEXT_READY":
            # Persist the outcome before allowing EngineeringRule work. Only the API's
            # guarded stored context is authoritative, not the model's proposed payload.
            try:
                persisted = self._api_client.post_interview_initial_question(
                    assessment_id,
                    {
                        "mode": "INITIAL_INTERVIEW",
                        "outcome": "CONTEXT_READY",
                        "expectedContextRevision": context_revision,
                        "technicalEvidenceReportId": evidence_report_id,
                        "workflowRunId": valid_wf_id,
                    },
                )
            except InterviewCoverageCallbackError:
                self._emit_technical_limitation(
                    evidence_report, TECHNICAL_COVERAGE_RECOVERY_REQUIRED, coverageState=coverage_state
                )
                return None
            if not isinstance(persisted, dict) or persisted.get("outcome") != "CONTEXT_READY":
                raise ValueError("Initial CONTEXT_READY was not confirmed by the persistence boundary")
            if persisted.get("contextRevision") != context_revision:
                raise ValueError("Initial CONTEXT_READY response has a different context revision")
            return normalize_confirmed_structured_business_context(persisted, assessment_id=assessment_id)

        question = handoff["activeQuestion"]
        frontier = question["frontier"]
        eligible, reason = evaluate_question_eligibility(frontier, ledger)
        if not eligible:
            raise ValueError(f"Initial Interview question candidate is not eligible: {reason}")

        frontier_refs = frontier.get("evidenceRefs") or []
        topic = str(frontier.get("description") or question.get("prompt") or "business clarification")
        obs = str(frontier.get("description") or "")
        question["whyAreWeAsking"] = build_why_are_we_asking_explanation(
            topic=topic,
            evidence_observation=obs,
            coverage_state=coverage_state,
            coverage_limitations=coverage_notes,
            ledger=ledger,
            evidence_refs=frontier_refs,
        )

        if "prompt" in question and question["prompt"]:
            question["prompt"] = sanitize_customer_facing_text(str(question["prompt"]))
        if "whyAreWeAsking" in question and question["whyAreWeAsking"]:
            question["whyAreWeAsking"] = sanitize_customer_facing_text(str(question["whyAreWeAsking"]))

        question_refs = (
            question.get("whyEvidenceRefs")
            or question.get("governedEvidenceRefs")
            or []
        )
        frontier_refs = frontier.get("evidenceRefs") or []
        validate_evidence_refs([*question_refs, *frontier_refs], ledger.authorized_refs)

        try:
            server_topic = _server_owned_topic(frontier, question)
            observer_from_api_client(self._api_client).observe_interview_routing(
                InterviewRoutingPacket(
                    assessment_id=assessment_id,
                    review_run_id=valid_wf_id,
                    authoritative_topic=server_topic,
                    active_question_id=str(question.get("id") or question.get("questionId") or ""),
                    active_topic_key=server_topic,
                    context_revision=context_revision,
                    customer_safe_topic_keys=(server_topic,),
                    unresolved_topic_keys=(server_topic,),
                    resolution_criteria_keys=tuple(
                        str(item)
                        for item in (
                            frontier.get("resolutionCriteria")
                            or question.get("resolutionCriteria")
                            or ()
                        )
                        if str(item).strip()
                    ),
                )
            )
        except Exception:
            pass

        handoff["expectedContextRevision"] = context_revision
        handoff["technicalEvidenceReportId"] = evidence_report_id
        handoff["workflowRunId"] = valid_wf_id
        try:
            self._api_client.post_interview_initial_question(assessment_id, handoff)
        except InterviewCoverageCallbackError:
            self._emit_technical_limitation(
                evidence_report, TECHNICAL_COVERAGE_RECOVERY_REQUIRED, coverageState=coverage_state
            )
        return None

    def _emit_technical_limitation(
        self, evidence_report: dict[str, Any], code: str, **details: Any
    ) -> None:
        """Best-effort typed runtime activity for a technical gap (no root/model prompt)."""
        scan_job_id = self._scan_job_id(evidence_report)
        post = getattr(self._api_client, "post_scan_runtime_event", None)
        if not scan_job_id or post is None:
            return
        try:
            post(
                scan_job_id,
                {
                    "event_type": "TOOL_WAITING_INPUT",
                    "run_status": "WAITING",
                    "stage": "TECHNICAL_EVIDENCE",
                    "tool_name": f"technical_limitation:{code}",
                    "summary": code,
                    "waiting_reason": code,
                    "output_summary": {"activity": code, **details},
                },
            )
        except Exception:  # noqa: BLE001 - progress must never fail an assessment
            _LOGGER.warning("technical limitation activity not delivered: %s", code)


def _technical_coverage(evidence_report: dict[str, Any]) -> tuple[str, list[str]]:
    payload = evidence_report.get("evidence_payload") or evidence_report.get(
        "evidencePayload"
    )
    payload = payload if isinstance(payload, dict) else {}
    graph = next((payload[key] for key in (
        "evidence_graph", "evidenceGraph", "programEvidenceGraph", "program_evidence_graph"
    ) if payload.get(key) is not None), {})
    coverage_state = "UNAVAILABLE"
    coverage_notes: list[str] = []
    if isinstance(graph, dict):
        raw_coverage_state = str(
            graph.get("coverage_state") or graph.get("coverageState")
            or payload.get("technicalCoverageState") or payload.get("coverageState") or ""
        ).strip().upper()
        coverage_state = _CANONICAL_COVERAGE_STATES.get(
            raw_coverage_state,
            "UNAVAILABLE",
        )
        raw_notes = graph.get("coverage_notes") or graph.get("coverageNotes") or []
        if isinstance(raw_notes, list):
            coverage_notes = [item[:240] for item in raw_notes[:8] if isinstance(item, str)]
    policy = _coverage_policy(evidence_report)
    if coverage_state == "PARTIAL" and isinstance(policy, dict):
        limitations = policy.get("limitations")
        if isinstance(limitations, list):
            coverage_notes = [item.strip()[:240] for item in limitations
                              if isinstance(item, str) and item.strip()][:8]
    return coverage_state, coverage_notes


def _can_start_initial_interview(
    coverage_state: str, coverage_notes: list[str], evidence_report: dict[str, Any]
) -> bool:
    if coverage_state == "READY":
        return True
    policy = _coverage_policy(evidence_report)
    return (
        coverage_state == "PARTIAL"
        and isinstance(policy, dict)
        and policy.get("permittedForInterview") is True
        and all(isinstance(policy.get(key), str) and policy[key].strip()
                for key in ("policyDecisionRef", "policyVersion"))
        and isinstance(policy.get("limitations"), list)
        and any(isinstance(item, str) and item.strip() for item in policy["limitations"])
    )


def _coverage_policy(evidence_report: dict[str, Any]) -> Any:
    payload = evidence_report.get("evidence_payload", evidence_report.get("evidencePayload"))
    if not isinstance(payload, dict):
        return None
    graph = next((payload[key] for key in (
        "evidence_graph", "evidenceGraph", "programEvidenceGraph", "program_evidence_graph"
    ) if payload.get(key) is not None), {})
    if not isinstance(graph, dict):
        graph = {}
    for source, keys in (
        (graph, ("partialCoveragePolicyDecision", "partial_coverage_policy_decision")),
        (payload, ("partialCoveragePolicyDecision", "partial_coverage_policy_decision",
                   "coveragePolicyDecision", "coverage_policy_decision")),
    ):
        for key in keys:
            if source.get(key) is not None:
                return source[key]
    return None


def _ai_discovery(evidence_report: dict[str, Any]) -> dict[str, Any] | None:
    payload = evidence_report.get("evidence_payload", evidence_report.get("evidencePayload"))
    if not isinstance(payload, dict):
        return None
    value = payload.get("ai_discovery", payload.get("aiDiscovery"))
    if not isinstance(value, dict):
        return None
    gate = str(value.get("gate") or "")
    if gate not in {"AI_CONFIRMED", "AI_ABSENT_CONFIRMED", "AI_UNKNOWN"}:
        return None
    coverage_state = str(value.get("coverage_state") or value.get("coverageState") or "UNAVAILABLE")
    if gate == "AI_ABSENT_CONFIRMED" and (
        coverage_state != "READY" or _technical_coverage(evidence_report)[0] != "READY"
    ):
        gate = "AI_UNKNOWN"  # absence is governed only with READY coverage; otherwise unknown
    findings = value.get("findings")
    return {
        "schema_version": str(value.get("schema_version") or value.get("schemaVersion") or "1.0.0"),
        "gate": gate,
        "coverage_state": coverage_state,
        "findings": [item for item in findings if isinstance(item, dict)][:64]
        if isinstance(findings, list)
        else [],
        "material_unresolved_frontiers": list(
            value.get("material_unresolved_frontiers")
            or value.get("materialUnresolvedFrontiers")
            or []
        )[:64],
    }



def _has_technical_ai_uncertainty(ai_discovery: dict[str, Any]) -> bool:
    if ai_discovery.get("material_unresolved_frontiers"):
        return True
    return any(
        isinstance(item, dict)
        and (
            item.get("clarification_owner") == "TECHNICAL"
            or str(item.get("resolution_state") or "").upper() not in {"OBSERVED", "CORROBORATED"}
            and item.get("state") in {"AI_PROVIDER_REFERENCE", "UNRESOLVED_DYNAMIC"}
        )
        for item in ai_discovery.get("findings", [])
    )


def _has_authoritative_customer_ai_context(state: dict[str, Any]) -> bool:
    confirmed = state.get("confirmedContext")
    if not isinstance(confirmed, dict):
        return False
    statements = confirmed.get("statements")
    if not isinstance(statements, list):
        return False
    negative = re.compile(
        r"(?:\b(?:no|not|without|never)\b|\b(?:does|do|we|our)\s+n['’]?t\b)"
        r"(?:\s+currently)?\s+(?:use|uses|using|usage(?:\s+of)?)?\s*"
        r"(?:external\s+|off[- ]repository\s+|generative\s+)?"
        r"(?:ai|artificial intelligence|llm|large language model|openai|anthropic|claude|gemini|genai|bedrock|copilot)",
        re.I,
    )
    positive_text = re.compile(
        r"\b(?:external|off[- ]repository|third[- ]party|hosted)\b.{0,80}\b"
        r"(?:ai|artificial intelligence|llm|large language model|openai|anthropic|"
        r"claude|gemini|genai|bedrock|copilot)\b|\b(?:ai|artificial intelligence|"
        r"llm|large language model|openai|anthropic|claude|gemini|genai|bedrock|"
        r"copilot)\b.{0,80}\b(?:external|off[- ]repository|third[- ]party|hosted)\b",
        re.I,
    )
    positive_topics = {
        "ai_usage",
        "ai_use",
        "external_ai_usage",
        "off_repository_ai_usage",
    }
    negative_values = {
        "false",
        "no",
        "none",
        "absent",
        "not_used",
        "no_ai",
        "ai_absent",
    }
    for item in statements:
        if not isinstance(item, dict):
            continue
        if str(item.get("source") or "").upper() != "CUSTOMER_CONFIRMED":
            continue
        if str(item.get("resolutionState") or "").upper() != "CONFIRMED":
            continue
        text = " ".join(
            str(item.get(key) or "")
            for key in ("topic", "statement", "normalizedValue")
        ).strip()
        topic = str(item.get("topic") or "").strip().lower()
        if negative.search(text):
            continue
        normalized = item.get("normalizedValue")
        if isinstance(normalized, bool) and not normalized:
            continue
        if isinstance(normalized, str) and normalized.strip().lower() in negative_values:
            continue
        if topic in positive_topics or positive_text.search(text):
            return True
    return False

def _select_customer_ai_finding(ai_discovery: dict[str, Any]) -> dict[str, Any] | None:
    findings = [
        item
        for item in ai_discovery.get("findings", [])
        if isinstance(item, dict) and item.get("clarification_owner") == "CUSTOMER"
    ]
    priority = {
        "AI_RUNTIME_REACHABILITY": 0,
        "OUTBOUND_AI_CONFIRMATION": 1,
        "AI_PURPOSE_FEATURE_MAPPING": 2,
    }
    findings.sort(key=lambda item: (priority.get(str(item.get("clarification_kind") or ""), 99),
                                    str(item.get("evidence_id") or "")))
    return findings[0] if findings else None


def _ai_discovery_handoff(
    *,
    assessment_id: str,
    evidence_report_id: str,
    evidence_report: dict[str, Any],
    ai_discovery: dict[str, Any],
) -> dict[str, Any] | None:
    finding = _select_customer_ai_finding(ai_discovery)
    if finding is None:
        return None
    kind = str(finding.get("clarification_kind") or "")
    snippet = finding.get("snippet_ref") if isinstance(finding.get("snippet_ref"), dict) else {}
    location = str(snippet.get("file_path") or "repository evidence")
    if snippet.get("start_line"):
        location = f"{location}:{snippet['start_line']}"
    provider = str(finding.get("provider") or "").strip()
    runtime_guard = str(finding.get("runtime_guard") or "").strip()

    if kind == "AI_RUNTIME_REACHABILITY":
        prompt = (
            f"Source evidence contains an AI model invocation guarded by {runtime_guard or 'runtime configuration'} "
            "in the assessed system. Is this AI path enabled in the assessed production environment?"
        )
        control = "SINGLE_SELECT"
        choices = [
            {"id": "YES", "label": "Yes"},
            {"id": "NO", "label": "No"},
            {"id": "UNSURE", "label": "Unsure"},
        ]
        description = f"Runtime reachability of the AI path evidenced at {location}"
    elif kind == "OUTBOUND_AI_CONFIRMATION" and finding.get("kind") == "PROVIDER_REFERENCE":
        provider_text = f"the {provider} AI SDK" if provider else "an AI SDK"
        prompt = (
            f"LCSP found {provider_text} declared or imported at {location}, but could not "
            "trace a model call from the assessed product code. Does the assessed product use "
            "it to call an AI/LLM service in production? If Yes, name the feature or workflow "
            "that uses it."
        )
        control = "SINGLE_SELECT"
        choices = [
            {"id": "YES", "label": "Yes", "requiresFreeText": True},
            {"id": "NO", "label": "No"},
            {"id": "UNSURE", "label": "Unsure"},
        ]
        description = f"Production use of the AI SDK referenced at {location}"
    elif kind == "OUTBOUND_AI_CONFIRMATION":
        prompt = (
            f"LCSP found an outbound API call at {location} with AI-compatible request evidence, "
            "but the endpoint's role is unresolved. Does this endpoint invoke an AI/LLM service "
            "in the assessed production environment? If Yes, name the provider, service, or "
            "customer-hosted gateway when known."
        )
        control = "SINGLE_SELECT"
        choices = [
            {"id": "YES", "label": "Yes", "requiresFreeText": True},
            {"id": "NO", "label": "No"},
            {"id": "UNSURE", "label": "Unsure"},
        ]
        description = f"Operational role of the unresolved outbound endpoint at {location}"
    else:
        provider_text = f" for {provider}" if provider else ""
        prompt = (
            f"LCSP found a confirmed AI model invocation{provider_text} at {location}. "
            "For the unresolved Customer context, what is this AI call used for, which Web/Mobile/API "
            "feature or module uses it, which business workflow does it support, and is its output "
            "advisory/assistive, ranking/recommendation, content generation, or connected to a "
            "downstream action?"
        )
        control = "FREE_TEXT"
        choices = None
        description = f"Business purpose and feature/module context for confirmed AI usage at {location}"

    snapshot_id = str(
        evidence_report.get("snapshot_id")
        or evidence_report.get("snapshotId")
        or snippet.get("snapshot_id")
        or "UNKNOWN"
    )
    evidence_id = str(finding.get("evidence_id") or evidence_report_id)
    question_id = "ai-question:" + hashlib.sha256(
        f"{assessment_id}|{snapshot_id}|{evidence_id}|{kind}".encode()
    ).hexdigest()[:24]
    evidence_ref = f"technicalEvidenceReport:{evidence_report_id}"
    question: dict[str, Any] = {
        "id": question_id,
        "intent": "CLARIFY" if kind != "AI_PURPOSE_FEATURE_MAPPING" else "ASK",
        "control": control,
        "prompt": prompt,
        "whyEvidenceRefs": [evidence_ref],
        "frontier": {
            "owner": "CUSTOMER",
            "materiality": "MATERIAL",
            "description": description,
            "evidenceRefs": [evidence_ref],
        },
    }
    if choices is not None:
        question["choices"] = choices
    if snippet:
        # Persist only the governed pinned locator/hash. The API resolves source
        # transiently for display and never stores raw source in Interview/PGE state.
        question["snippetRef"] = dict(snippet)
    return {
        "mode": "INITIAL_INTERVIEW",
        "outcome": "WAITING_FOR_CUSTOMER",
        "activeQuestion": question,
        "flags": [],
        "blockedActions": [],
        "targetedResolution": {},
    }


_INTERVIEW_RUNTIME_EVIDENCE_REF = "interviewRuntime:assessment-interview-runtime-v1"
_EVIDENCE_GRAPH_KEYS = (
    "evidence_graph",
    "evidenceGraph",
    "programEvidenceGraph",
    "program_evidence_graph",
)


def _ref_strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _record_refs(record: Any) -> list[str]:
    if not isinstance(record, dict):
        return []
    refs = record.get("evidence_refs")
    return _ref_strings(refs if refs is not None else record.get("evidenceRefs"))


def _persistable_evidence_refs(
    evidence_report: dict[str, Any],
    evidence_report_id: str,
) -> set[str]:
    """Exact evidence refs the API accepts for this report's Interview question.

    Mirrors ``AssessmentProvenanceSnapshot.governedEvidenceRefs`` in
    ``assessment-interview-runtime.service.ts``: the report, its snapshot, the
    Interview runtime, and the evidence refs of the graph, its nodes and edges, and
    the payload. Refs are kept verbatim; a ref outside this set is rejected there.
    """
    refs = {f"technicalEvidenceReport:{evidence_report_id}", _INTERVIEW_RUNTIME_EVIDENCE_REF}
    snapshot_id = str(
        evidence_report.get("snapshot_id") or evidence_report.get("snapshotId") or ""
    ).strip()
    if snapshot_id:
        refs.add(f"repositorySnapshot:{snapshot_id}")
    payload = evidence_report.get("evidence_payload")
    if payload is None:
        payload = evidence_report.get("evidencePayload")
    if not isinstance(payload, dict):
        return refs
    graph = next((payload[key] for key in _EVIDENCE_GRAPH_KEYS if payload.get(key) is not None), None)
    if isinstance(graph, dict):
        refs.update(_record_refs(graph))
        for collection in ("nodes", "edges"):
            items = graph.get(collection)
            if isinstance(items, list):
                for item in items:
                    refs.update(_record_refs(item))
    refs.update(_record_refs(payload))
    return refs


def _initial_interview_instruction(
    *,
    assessment_id: str,
    evidence_report_id: str,
    evidence_report: dict[str, Any],
    allowed_evidence_refs: set[str] | None = None,
    current_confirmed_context: dict[str, Any] | None = None,
) -> str:
    coverage_state, coverage_notes = _technical_coverage(evidence_report)
    safe_context = {
        "hostPlatform": "LCSP",
        "subjectSystemIdentity": "repositorySnapshot:"
        + str(
            evidence_report.get("snapshot_id")
            or evidence_report.get("snapshotId")
            or "UNKNOWN"
        ),
        "assessmentId": assessment_id,
        "mode": "INITIAL_INTERVIEW",
        "technicalEvidenceReportId": evidence_report_id,
        "coverageState": coverage_state,
        "coverageNotes": coverage_notes,
        "snapshotId": evidence_report.get("snapshot_id")
        or evidence_report.get("snapshotId"),
        "schemaVersion": evidence_report.get("schema_version")
        or evidence_report.get("schemaVersion"),
        "aiDiscovery": _ai_discovery(evidence_report),
        "currentConfirmedBusinessContext": current_confirmed_context,
        "contextRevision": int((current_confirmed_context or {}).get("contextRevision") or 0),
        "allowedEvidenceRefs": sorted(
            allowed_evidence_refs
            if allowed_evidence_refs is not None
            else _persistable_evidence_refs(evidence_report, evidence_report_id)
        )[:MAX_LISTED_ALLOWED_REFS],
    }
    return (
        "Run INITIAL_INTERVIEW before any EngineeringRule analysis. "
        "Use this bounded technical coverage/provenance, governed AI-discovery summary and existing Customer-confirmed context to assess sufficiency first. "
        "Missing technical evidence is not proof that a business behavior does not exist. "
        "Do not infer Customer confirmation from PGE/documentary evidence. "
        "Never invent a provider, model, endpoint role, or technical edge. Technical/resolvable "
        "uncertainty belongs to Scanner/PGE reanalysis rather than a Customer question. When a "
        "confirmed AI invocation is already present, do not ask whether it is AI; ask only the "
        "unresolved purpose/feature/workflow/output-role context. For an unresolved custom outbound "
        "candidate, use Yes/No/Unsure and do not name a provider unless evidence or the Customer does. "
        "If existing Customer-confirmed context and Technical Evidence are sufficient and no material business uncertainty remains, "
        "return CONTEXT_READY with no activeQuestion or new context updates. There is no minimum question count; "
        "do not ask again for facts already established. For this no-new-answer decision, leave contextAuthority null "
        "and confirmedContext as an empty statements envelope; the API will preserve the existing confirmed context. "
        "Copy expectedContextRevision from contextRevision in the bounded input. "
        "Do not fabricate confirmations, respondents or answers. "
        "Otherwise return WAITING_FOR_CUSTOMER with exactly one bounded activeQuestion for the missing business fact. Every "
        "whyEvidenceRefs/frontier.evidenceRefs entry must be copied verbatim from "
        "allowedEvidenceRefs; never invent, shorten or rename a ref, and use [] when none applies.\n"
        f"Bounded initial context: {json.dumps(safe_context, ensure_ascii=False, sort_keys=True)}"
    )


def _initial_schema_correction_instruction(
    instruction: str,
    error: SpecialistHandoffValidationError,
) -> str:
    feedback = {
        "code": "INTERVIEW_HANDOFF_SCHEMA_VIOLATION",
        "rejectedReason": str(error)[:2000],
    }
    return (
        f"{instruction}\n"
        "Your previous candidate was rejected before persistence. Return the final answer "
        "as the structured InterviewResult handoff (not prose), fixing only the rule named "
        "in rejectedReason. Use CONTEXT_READY without a question only when existing Customer-confirmed context is sufficient; "
        "otherwise use WAITING_FOR_CUSTOMER with exactly one activeQuestion "
        "whose frontier has owner=CUSTOMER, materiality=MATERIAL, a non-empty description "
        "and evidenceRefs limited to governed refs from the bounded context ([] when none).\n"
        f"decisionValidationFeedback: {json.dumps(feedback, ensure_ascii=False, sort_keys=True)}"
    )


def _server_owned_topic(frontier: dict[str, Any], question: dict[str, Any]) -> str:
    text = " ".join(
        str(value)
        for value in (
            frontier.get("topic"),
            frontier.get("kind"),
            frontier.get("description"),
            question.get("topic"),
            question.get("prompt"),
        )
        if value
    ).lower()
    if any(token in text for token in ("deploy", "release", "production", "runtime")):
        return "DEPLOYMENT"
    if any(token in text for token in ("purpose", "use case", "objective", "why")):
        return "PURPOSE"
    if any(token in text for token in ("human", "review", "oversight", "approval")):
        return "HUMAN_REVIEW"
    if any(token in text for token in ("source", "input", "origin", "collection")):
        return "DATA_SOURCE"
    if any(token in text for token in ("reuse", "secondary", "retention")):
        return "DATA_REUSE"
    if any(token in text for token in ("feature", "workflow", "function", "capability")):
        return "FEATURE_OR_WORKFLOW"
    return "NONE"


__all__ = ["InterviewGatedEngineeringAssessmentBoundary"]
